#!/usr/bin/env node
/**
 * Multi-agent typing soak/perf test.
 *
 * Runs the real thing: one conductor per agent on a shared local network, one
 * vite dev server per agent (the conductor ports are compiled into the bundle,
 * so agents cannot share a server), one headless Chrome tab per agent, and
 * genuine key events dispatched into CodeMirror. Nothing is stubbed — the
 * keystrokes go through the editor, the text-editor grammar, the syn session,
 * Automerge and the DHT exactly as they do for a human.
 *
 * Scenario (roughly a real editing session):
 *   1. Agent A opens a new note and types about half a page.
 *   2. Agent B jumps to the top of the document and types a few pages there
 *      while A keeps typing where it left off — genuinely concurrent editing
 *      at two different positions.
 *   3. Agent C sits in the session as a reader and has to converge too.
 *
 * Then it reports what an operator actually cares about: did every agent end
 * up with the same text, how long the typing took, and how many commits the
 * session wrote for that many keystrokes.
 *
 * Usage:  nix develop --command node tests/typing-perf.mjs
 * Env:    CPS=25 A_FIRST=600 B_CHARS=2500 A_CONT=600 HEADFUL=1 KEEP=1
 *         RUN_TIMEOUT_MS=900000   hard ceiling on a whole run
 */
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:net';
import { Page, delay, waitUntil } from './cdp.mjs';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const HAPP = `${REPO}/workdir/notebooks.happ`;

// Typing speed, per agent. The default is human-paced on purpose: this test
// exists to answer "does this work in practice", and speed changes the answer.
// Measured on this repo, 3 agents / 3700 keystrokes:
//   CPS=8  -> 0 of 7237 send_message calls fail, converges in 0.1s, 21 commits
//   CPS=25 -> 2030 of 2611 of the busiest agent's send_message calls time out,
//             live sync collapses and convergence falls back to the DHT (43s).
// So CPS>=25 is a stress mode, not a faster version of the same test.
const CPS      = Number(process.env.CPS      ?? 8);
const A_FIRST  = Number(process.env.A_FIRST  ?? 600);   // ~half a page
const B_CHARS  = Number(process.env.B_CHARS  ?? 2500);  // ~2-3 pages
const A_CONT   = Number(process.env.A_CONT   ?? 600);
const HEADFUL  = !!process.env.HEADFUL;
// Share of a typing agent's live-sync messages allowed to fail before we call
// real-time collaboration broken. Human-paced runs measure 0%.
const SYNC_FAIL_PCT = Number(process.env.SYNC_FAIL_PCT ?? 2);
const KEEP     = !!process.env.KEEP;
// Hard ceiling on a whole run. Without it a hang anywhere in main() leaves a
// conductor and three vite dev servers running until someone notices.
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS ?? 15 * 60_000);
const AGENTS   = 3;

const procs = [];
const pages = [];
let chromeProc = null;

function bg(name, cmd, args, env = {}) {
  const p = spawn(cmd, args, {
    cwd: REPO,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  p.__name = name;
  const log = [];
  p.stdout.on('data', d => log.push(d.toString()));
  p.stderr.on('data', d => log.push(d.toString()));
  p.__log = log;
  procs.push(p);
  return p;
}

async function freePort() {
  return new Promise(res => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  });
}

async function waitHttp(url, timeoutMs, label) {
  return waitUntil(async () => {
    try { const r = await fetch(url); return r.ok || r.status < 500; } catch { return false; }
  }, timeoutMs, 500, label);
}

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  // Each of these is guarded on its own: page.close() throws once the browser
  // is gone, and an unguarded throw here used to skip every kill below it.
  for (const p of pages) { try { p.close(); } catch {} }
  if (chromeProc) { try { process.kill(-chromeProc.pid, 'SIGKILL'); } catch {} }
  for (const p of procs) { try { process.kill(-p.pid, 'SIGKILL'); } catch {} }
  try { execSync('hc s clean', { cwd: REPO, stdio: 'ignore' }); } catch {}
}
process.on('exit', () => { if (!KEEP) cleanup(); });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(1); });

// ---------------------------------------------------------------- prose
const WORDS = `the quick brown fox jumps over a lazy dog while syn keeps every
replica of this note in step across the network as three people type into it at
once we care less about the words themselves than about how many keystrokes the
session has to absorb and how many commits it decides to write when it does`
  .split(/\s+/).filter(Boolean);

function prose(n, seed) {
  let out = '';
  let i = seed;
  while (out.length < n) {
    out += WORDS[i++ % WORDS.length] + ' ';
    if (i % 17 === 0) out += '\n';
  }
  return out.slice(0, n);
}

// ---------------------------------------------------------------- page glue
const HELPERS = `
window.__dq = function (pred, root = document) {
  const walk = r => { for (const el of r.querySelectorAll('*')) {
    if (pred(el)) return el;
    if (el.shadowRoot) { const f = walk(el.shadowRoot); if (f) return f; } } return null; };
  return walk(root); };
window.__app = () => document.querySelector('notebooks-app');
window.__cm  = () => window.__dq(el => el.tagName.toLowerCase() === 'wc-codemirror');
window.__text = () => { const c = window.__cm(); return c && c.editor ? c.editor.getDoc().getValue() : null; };
true`;

async function bootPage(page, uiPort, nickname) {
  await page.navigate(`http://localhost:${uiPort}/`);
  await page.eval(HELPERS);
  const ok = await waitUntil(
    () => page.eval(`!!(window.__app() && window.__app()._synStore && window.__app()._profilesStore)`),
    90000, 500, `${page.name} stores`);
  if (!ok) throw new Error(`${page.name}: app never connected to its conductor`);
  await page.eval(`(async () => { const a = window.__app();
    const me = await a._profilesStore.client.getAgentProfile(a._profilesStore.client.client.myPubKey);
    if (!me) await a._profilesStore.client.createProfile({ nickname: ${JSON.stringify(nickname)}, fields: {} });
    return true; })()`);
  await page.eval(`(() => {
    window.__zome = { calls: {}, fails: {} };
    const c = window.__app()._synStore.client.client;
    if (c.__wrapped) return true;
    const orig = c.callZome.bind(c);
    c.callZome = async (req, timeout) => {
      const fn = (req && req.fn_name) || 'unknown';
      window.__zome.calls[fn] = (window.__zome.calls[fn] || 0) + 1;
      try { return await orig(req, timeout); }
      catch (e) { window.__zome.fails[fn] = (window.__zome.fails[fn] || 0) + 1; throw e; }
    };
    c.__wrapped = true; return true; })()`);
  await delay(1500);
}

/** Put the caret where a person would click, then send real keystrokes. */
async function typeAt(page, where, text, cps, label) {
  await page.eval(`(() => { const cm = window.__cm(); const doc = cm.editor.getDoc();
    cm.editor.focus();
    ${where === 'start'
      ? `doc.setCursor({ line: 0, ch: 0 });`
      : `doc.setCursor({ line: doc.lastLine(), ch: doc.getLine(doc.lastLine()).length });`}
    return true; })()`);
  const gap = 1000 / cps;
  const started = Date.now();
  for (let i = 0; i < text.length; i++) {
    await page.typeChar(text[i]);
    const behind = started + (i + 1) * gap - Date.now();
    if (behind > 0) await delay(behind);
    if (label && i > 0 && i % 500 === 0) {
      process.stdout.write(`    ${label}: ${i}/${text.length} chars\n`);
    }
  }
  return Date.now() - started;
}

async function commitCount(page) {
  return page.eval(`(async () => { const a = window.__app();
    const h = a.view.noteHash;
    const links = await a._synStore.client.getCommitsForDocument(h);
    const seen = new Set(links.map(l => l.target.join(',')));
    return seen.size; })()`);
}

// ---------------------------------------------------------------- main
async function main() {
  console.log('=== notebooks multi-agent typing test ===');
  console.log(`agents=${AGENTS} cps=${CPS} A_FIRST=${A_FIRST} B_CHARS=${B_CHARS} A_CONT=${A_CONT}\n`);

  if (!(await fetch(`file://${HAPP}`).then(() => true).catch(() => true))) {}
  execSync(`test -f ${HAPP}`, { stdio: 'ignore' });

  console.log('1. starting local bootstrap + relay');
  try { execSync('hc s clean', { cwd: REPO, stdio: 'ignore' }); } catch {}
  const bootPort = await freePort();
  bg('bootstrap', 'kitsune2-bootstrap-srv', ['--listen', `127.0.0.1:${bootPort}`]);
  await delay(2500);

  console.log(`2. generating ${AGENTS} conductors on that network`);
  const adminPorts = [], appPorts = [], uiPorts = [];
  for (let i = 0; i < AGENTS; i++) {
    adminPorts.push(await freePort());
    appPorts.push(await freePort());
    uiPorts.push(await freePort());
  }
  const hc = bg('conductors', 'bash', ['-c',
    `echo pass | RUST_LOG=warn hc s -f=${adminPorts.join(',')} --piped generate ${HAPP} ` +
    `-n ${AGENTS} --run=${appPorts.join(',')} -a notebooks ` +
    `network -b "http://127.0.0.1:${bootPort}" quic "http://127.0.0.1:${bootPort}/relay"`]);
  const up = await waitUntil(
    () => hc.__log.join('').split('Conductor launched').length - 1 >= AGENTS, 180000, 1000, 'conductors');
  if (!up) { console.error(hc.__log.join('').slice(-2000)); throw new Error('conductors did not start'); }
  console.log(`   admin=${adminPorts.join(',')} app=${appPorts.join(',')}`);

  console.log(`3. starting ${AGENTS} UI servers (ports are compiled in, so one each)`);
  for (let i = 0; i < AGENTS; i++) {
    bg(`vite${i}`, 'npm', ['start', '-w', 'ui'], {
      UI_PORT: String(uiPorts[i]),
      VITE_ADMIN_PORT: String(adminPorts[i]),
      VITE_APP_PORT: String(appPorts[i]),
    });
  }
  for (let i = 0; i < AGENTS; i++) {
    if (!(await waitHttp(`http://localhost:${uiPorts[i]}/`, 120000, `vite ${i}`)))
      throw new Error(`vite ${i} never came up`);
  }

  console.log('4. launching browser tabs');
  const cdpPort = await freePort();
  chromeProc = bg('chrome', 'google-chrome', [
    HEADFUL ? '--noop' : '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    `--user-data-dir=/tmp/notebooks-perf-${process.pid}`,
    'about:blank',
  ].filter(a => a !== '--noop'));
  if (!(await waitHttp(`http://127.0.0.1:${cdpPort}/json/version`, 60000, 'chrome')))
    throw new Error('chrome devtools never came up');

  const names = ['A', 'B', 'C'];
  for (let i = 0; i < AGENTS; i++) {
    const r = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' });
    const t = await r.json();
    const page = await Page.attach(names[i], t.webSocketDebuggerUrl);
    pages.push(page);
  }
  for (let i = 0; i < AGENTS; i++) {
    await bootPage(pages[i], uiPorts[i], `agent-${names[i]}`);
    console.log(`   agent ${names[i]} connected`);
  }

  const [A, B, C] = pages;

  console.log('5. agent A creates the note');
  const noteBytes = await A.eval(`(async () => { const a = window.__app();
    await a.createNote('perf note', 'markdown'); return Array.from(a.view.noteHash); })()`);
  const arr = `new Uint8Array(${JSON.stringify(noteBytes)})`;
  if (!(await waitUntil(() => A.eval(`!!window.__cm()`), 60000, 500, 'A editor'))) throw new Error('A: no editor');
  await delay(3000);

  console.log('6. agents B and C join the same note');
  for (const p of [B, C]) {
    const found = await waitUntil(
      () => p.eval(`(async () => !!(await window.__app()._synStore.client.getDocument(${arr})))()`),
      120000, 1000, `${p.name} sees the document`);
    if (!found) throw new Error(`${p.name} never received the document`);
    await p.eval(`(() => { window.__app().view = { type: 'note', noteHash: ${arr} }; return true; })()`);
    if (!(await waitUntil(() => p.eval(`!!window.__cm()`), 90000, 500, `${p.name} editor`)))
      throw new Error(`${p.name}: editor never mounted`);
  }
  await delay(5000);

  // The note is created with a "# <title>" heading, so the keystroke count is
  // measured against what is already in the document.
  const baseline = (await A.eval(`window.__text()`) ?? '').length;

  const t0 = Date.now();
  console.log(`\n7. agent A types ~half a page (${A_FIRST} chars)`);
  const aFirstMs = await typeAt(A, 'end', prose(A_FIRST, 0), CPS, 'A');

  console.log(`\n8. agent B types ${B_CHARS} chars at the TOP while agent A continues (${A_CONT} chars)`);
  const bTask = typeAt(B, 'start', prose(B_CHARS, 7), CPS, 'B');
  const aTask = typeAt(A, 'end', prose(A_CONT, 3), CPS, 'A');
  const [bMs, aContMs] = await Promise.all([bTask, aTask]);
  const typingMs = Date.now() - t0;

  console.log('\n9. waiting for the three agents to converge');
  const converged = await waitUntil(async () => {
    const t = await Promise.all(pages.map(p => p.eval(`window.__text()`)));
    return t[0] != null && t.every(x => x === t[0]);
  }, 180000, 1000, 'convergence');
  const convergeMs = Date.now() - t0 - typingMs;

  const texts = await Promise.all(pages.map(p => p.eval(`window.__text()`)));
  const commits = await commitCount(A);
  const typed = A_FIRST + B_CHARS + A_CONT;

  console.log('\n=========== RESULT ===========');
  console.log(`keystrokes typed      ${typed}   (A ${A_FIRST}+${A_CONT}, B ${B_CHARS})`);
  console.log(`typing wall time      ${(typingMs / 1000).toFixed(1)}s   (A ${(aFirstMs/1000).toFixed(1)}s + ${(aContMs/1000).toFixed(1)}s, B ${(bMs/1000).toFixed(1)}s)`);
  console.log(`converged             ${converged ? 'yes' : 'NO'}${converged ? ` after ${(convergeMs / 1000).toFixed(1)}s` : ''}`);
  console.log(`final doc length      ${texts.map(t => (t ?? '').length).join(' / ')}  (A / B / C, from a ${baseline}-char start)`);
  console.log(`commits written       ${commits}`);
  console.log(`commits per 1k chars  ${(commits / (typed / 1000)).toFixed(1)}`);
  console.log(`commit triggers       every 200 deltas or 30s per typing agent (notebooks SYN_CONFIG)`);
  console.log('\nzome calls (per agent, fn: total/failed)');
  let syncSent = 0, syncFailed = 0, worst = { name: '-', pct: 0, sent: 0, failed: 0 };
  for (const p of pages) {
    const z = await p.eval(`JSON.stringify(window.__zome || {calls:{},fails:{}})`).then(JSON.parse).catch(() => null);
    if (!z) { console.log(`  ${p.name}: (not instrumented)`); continue; }
    const sent = z.calls.send_message ?? 0;
    const failed = z.fails.send_message ?? 0;
    syncSent += sent;
    syncFailed += failed;
    // The aggregate hides the case that actually matters: one agent's sync
    // collapsing while everyone else is fine is still a person who cannot
    // collaborate, so the worst agent is tracked separately.
    if (sent && (failed / sent) * 100 > worst.pct)
      worst = { name: p.name, pct: (failed / sent) * 100, sent, failed };
    const rows = Object.keys(z.calls).sort().map(fn => `${fn}: ${z.calls[fn]}/${z.fails[fn] ?? 0}`);
    console.log(`  ${p.name}: ${rows.join('   ') || '(none)'}`);
  }
  // send_message is syn's live-sync channel: Automerge sync, change notices and
  // heartbeats between session peers. Losing these does not corrupt the
  // document (commits and the DHT still converge it) but it is what makes
  // collaboration feel real-time, so it gets its own metric.
  const syncPct = syncSent ? (syncFailed / syncSent) * 100 : 0;
  console.log(`\nlive sync (send_message) ${syncSent} sent, ${syncFailed} timed out (${syncPct.toFixed(1)}%)` +
    (worst.failed ? `   worst agent ${worst.name}: ${worst.failed}/${worst.sent} (${worst.pct.toFixed(1)}%)` : ''));

  const errs = pages.flatMap(p => p.errors.map(e => `[${p.name}] ${e}`));
  // Timed-out zome calls are already accounted for by the sync metric above;
  // counting them twice would drown out anything else the page reported.
  const otherErrs = errs.filter(e => !/timed out in \d+ ms: call_zome/i.test(e));
  const grouped = new Map();
  for (const e of otherErrs) {
    const key = e.replace(/\d+/g, 'N').slice(0, 120);
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  console.log(`other page errors     ${otherErrs.length}`);
  [...grouped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .forEach(([k, n]) => console.log(`    ${String(n).padStart(5)} x ${k}`));

  // A commit carries up to CommitEveryNDeltas keystrokes (200 in notebooks'
  // SYN_CONFIG) or 30s of editing, whichever comes first, per typing agent.
  // Anything far above that is the commit-storm behaviour we care about.
  const budget = Math.ceil(typed / 200) + Math.ceil(typingMs / 30000) * 2 + 10;
  const problems = [];
  if (!converged) problems.push('agents did not converge on the same text');
  if (new Set(texts).size !== 1) problems.push('final text differs between agents');
  const expected = baseline + typed;
  if ((texts[0] ?? '').length < expected * 0.98)
    problems.push(`lost keystrokes: ${(texts[0] ?? '').length} chars, expected ~${expected}`);
  if (commits > budget) problems.push(`commit storm: ${commits} commits, budget ${budget}`);
  if (syncPct > SYNC_FAIL_PCT || worst.pct > SYNC_FAIL_PCT)
    problems.push(`live sync degraded: ${syncPct.toFixed(1)}% of send_message calls timed out overall, ` +
      `worst agent ${worst.name} at ${worst.pct.toFixed(1)}% (limit ${SYNC_FAIL_PCT}%) - ` +
      `that agent stops seeing peers' edits in real time`);
  if (otherErrs.length) problems.push(`${otherErrs.length} unexpected console/page errors`);

  console.log('==============================');
  if (problems.length) { problems.forEach(p => console.log('FAIL:', p)); process.exitCode = 1; }
  else console.log(`PASS: 3 agents, ${typed} real keystrokes, ${commits} commits (budget ${budget}), all converged`);
}

// The dev servers are spawned detached but with piped stdio, so their pipes keep
// this process's event loop alive. Relying on the 'exit' handler alone was the
// bug: when main() hung, node never exited, cleanup never ran, and every run
// left one conductor and three vite servers behind for good.
const watchdog = setTimeout(() => {
  console.error(`\nERROR: run exceeded RUN_TIMEOUT_MS (${RUN_TIMEOUT_MS} ms)`);
  process.exitCode = 1;
  finish();
}, RUN_TIMEOUT_MS);

function finish() {
  clearTimeout(watchdog);
  if (KEEP) console.log('KEEP=1: leaving conductors, dev servers and Chrome running');
  else cleanup();
  // Killing the children closes their pipes, so node normally drains and exits
  // here on its own, with stdout fully flushed. If anything is still holding the
  // loop open (KEEP=1 always does), force it rather than hanging.
  setTimeout(() => process.exit(process.exitCode ?? 0), 5000).unref();
}

main()
  .catch(e => { console.error('\nERROR:', e.message); process.exitCode = 1; })
  .finally(finish);

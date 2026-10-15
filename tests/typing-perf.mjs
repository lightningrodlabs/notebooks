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
import { execSync } from 'node:child_process';
import { delay, waitUntil } from './cdp.mjs';
import { REPO, pages, installCleanup, cleanup, startStack, openNote } from './harness.mjs';

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

installCleanup(KEEP);

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

  await startStack(['A', 'B', 'C'], { headful: HEADFUL });

  const [A, B, C] = pages;

  console.log('5. agent A creates the note');
  const noteBytes = await A.eval(`(async () => { const a = window.__app();
    await a.createNote('perf note', 'markdown'); return Array.from(a.view.noteHash); })()`);
  if (!(await waitUntil(() => A.eval(`!!window.__cm()`), 60000, 500, 'A editor'))) throw new Error('A: no editor');
  await delay(3000);

  console.log('6. agents B and C join the same note');
  for (const p of [B, C]) await openNote(p, noteBytes);
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

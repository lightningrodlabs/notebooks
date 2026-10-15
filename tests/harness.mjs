// Shared infrastructure for the browser-driven tests: a local bootstrap, one
// conductor per agent, one vite dev server per agent (the conductor ports are
// compiled into the bundle), headless Chrome tabs, and the page glue that
// connects each tab to its conductor. Nothing here is stubbed.
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:net';
import { Page, delay, waitUntil } from './cdp.mjs';

export const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
export const HAPP = `${REPO}/workdir/notebooks.happ`;

export const procs = [];
export const pages = [];
let chromeProc = null;

export function bg(name, cmd, args, env = {}) {
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

export async function freePort() {
  return new Promise(res => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  });
}

export async function waitHttp(url, timeoutMs, label) {
  return waitUntil(async () => {
    try { const r = await fetch(url); return r.ok || r.status < 500; } catch { return false; }
  }, timeoutMs, 500, label);
}

let cleanedUp = false;
export function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  // Each of these is guarded on its own: page.close() throws once the browser
  // is gone, and an unguarded throw here used to skip every kill below it.
  for (const p of pages) { try { p.close(); } catch {} }
  if (chromeProc) { try { process.kill(-chromeProc.pid, 'SIGKILL'); } catch {} }
  for (const p of procs) { try { process.kill(-p.pid, 'SIGKILL'); } catch {} }
  try { execSync('hc s clean', { cwd: REPO, stdio: 'ignore' }); } catch {}
}

/** Wire the exit paths: cleanup on exit unless `keep`, always on signals. */
export function installCleanup(keep) {
  process.on('exit', () => { if (!keep) cleanup(); });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(1); });
}

// ---------------------------------------------------------------- page glue
export const HELPERS = `
window.__dq = function (pred, root = document) {
  const walk = r => { for (const el of r.querySelectorAll('*')) {
    if (pred(el)) return el;
    if (el.shadowRoot) { const f = walk(el.shadowRoot); if (f) return f; } } return null; };
  return walk(root); };
window.__dqAll = function (pred, root = document) {
  const out = [];
  const walk = r => { for (const el of r.querySelectorAll('*')) {
    if (pred(el)) out.push(el);
    if (el.shadowRoot) walk(el.shadowRoot); } };
  walk(root); return out; };
window.__app = () => document.querySelector('notebooks-app');
window.__cm  = () => window.__dq(el => el.tagName.toLowerCase() === 'wc-codemirror');
window.__text = () => { const c = window.__cm(); return c && c.editor ? c.editor.getDoc().getValue() : null; };
true`;

export async function bootPage(page, uiPort, nickname) {
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

/**
 * Bring up the whole stack for `names.length` agents and return their pages,
 * each already connected to its own conductor with a profile.
 */
export async function startStack(names, { headful = false, log = console.log } = {}) {
  execSync(`test -f ${HAPP}`, { stdio: 'ignore' });
  const n = names.length;

  log('1. starting local bootstrap + relay');
  try { execSync('hc s clean', { cwd: REPO, stdio: 'ignore' }); } catch {}
  const bootPort = await freePort();
  bg('bootstrap', 'kitsune2-bootstrap-srv', ['--listen', `127.0.0.1:${bootPort}`]);
  await delay(2500);

  log(`2. generating ${n} conductors on that network`);
  const adminPorts = [], appPorts = [], uiPorts = [];
  for (let i = 0; i < n; i++) {
    adminPorts.push(await freePort());
    appPorts.push(await freePort());
    uiPorts.push(await freePort());
  }
  const hc = bg('conductors', 'bash', ['-c',
    `echo pass | RUST_LOG=warn hc s -f=${adminPorts.join(',')} --piped generate ${HAPP} ` +
    `-n ${n} --run=${appPorts.join(',')} -a notebooks ` +
    `network -b "http://127.0.0.1:${bootPort}" quic "http://127.0.0.1:${bootPort}/relay"`]);
  const up = await waitUntil(
    () => hc.__log.join('').split('Conductor launched').length - 1 >= n, 180000, 1000, 'conductors');
  if (!up) { console.error(hc.__log.join('').slice(-2000)); throw new Error('conductors did not start'); }
  log(`   admin=${adminPorts.join(',')} app=${appPorts.join(',')}`);

  log(`3. starting ${n} UI servers (ports are compiled in, so one each)`);
  for (let i = 0; i < n; i++) {
    bg(`vite${i}`, 'npm', ['start', '-w', 'ui'], {
      UI_PORT: String(uiPorts[i]),
      VITE_ADMIN_PORT: String(adminPorts[i]),
      VITE_APP_PORT: String(appPorts[i]),
    });
  }
  for (let i = 0; i < n; i++) {
    if (!(await waitHttp(`http://localhost:${uiPorts[i]}/`, 120000, `vite ${i}`)))
      throw new Error(`vite ${i} never came up`);
  }

  log('4. launching browser tabs');
  const cdpPort = await freePort();
  chromeProc = bg('chrome', 'google-chrome', [
    headful ? '--noop' : '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    `--user-data-dir=/tmp/notebooks-perf-${process.pid}`,
    'about:blank',
  ].filter(a => a !== '--noop'));
  if (!(await waitHttp(`http://127.0.0.1:${cdpPort}/json/version`, 60000, 'chrome')))
    throw new Error('chrome devtools never came up');

  for (let i = 0; i < n; i++) {
    const r = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' });
    const t = await r.json();
    const page = await Page.attach(names[i], t.webSocketDebuggerUrl);
    pages.push(page);
  }
  for (let i = 0; i < n; i++) {
    await bootPage(pages[i], uiPorts[i], `agent-${names[i]}`);
    log(`   agent ${names[i]} connected`);
  }
  return pages;
}

/** Open the note `noteBytes` (a Uint8Array as a plain array) in `page` and wait for the editor. */
export async function openNote(page, noteBytes, editorTag = 'wc-codemirror') {
  const arr = `new Uint8Array(${JSON.stringify(noteBytes)})`;
  const found = await waitUntil(
    () => page.eval(`(async () => !!(await window.__app()._synStore.client.getDocument(${arr})))()`),
    120000, 1000, `${page.name} sees the document`);
  if (!found) throw new Error(`${page.name} never received the document`);
  await page.eval(`(() => { window.__app().view = { type: 'note', noteHash: ${arr} }; return true; })()`);
  if (!(await waitUntil(() => page.eval(`!!window.__dq(el => el.tagName.toLowerCase() === ${JSON.stringify(editorTag)})`), 90000, 500, `${page.name} editor`)))
    throw new Error(`${page.name}: editor never mounted`);
}

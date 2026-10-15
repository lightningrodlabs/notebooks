#!/usr/bin/env node
/**
 * Two-agent end-to-end test of comments, on the real stack (see harness.mjs):
 * real conductors, real dev servers, headless Chrome, real key events.
 *
 *   1. A creates a markdown note and types two lines; B joins.
 *   2. A selects a span, presses "+ Comment", types a comment; B sees the
 *      highlight and the card.
 *   3. B comments on an overlapping span; both see the overlap depth.
 *   4. A types at the top of the note while both comments exist; the
 *      highlighted text does not move.
 *   5. B replies; A resolves B's comment; the resolved toggle brings it back.
 *   6. B deletes the text under A's comment; A's card becomes an orphan.
 *   7. A's export imports into B with text and comments intact, and export
 *      files from earlier releases (v0.0.11 and v0.6 shapes) import too.
 *   8. A rich-text note gets a comment through the ProseMirror editor and B
 *      sees it.
 *
 * Usage:  nix develop --command node tests/comments-e2e.mjs
 * Env:    HEADFUL=1 KEEP=1 RUN_TIMEOUT_MS=900000
 */
import { readFileSync } from 'node:fs';
import { delay, waitUntil } from './cdp.mjs';
import { pages, installCleanup, cleanup, startStack, openNote } from './harness.mjs';

const HEADFUL = !!process.env.HEADFUL;
const KEEP = !!process.env.KEEP;
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS ?? 15 * 60_000);
installCleanup(KEEP);

const CPS = 12;
const failures = [];
function check(cond, what) {
  console.log(`   ${cond ? 'ok  ' : 'FAIL'} ${what}`);
  if (!cond) failures.push(what);
}

// ---------------------------------------------------------------- page glue
const COMMENT_HELPERS = `
window.__md = () => window.__dq(el => el.tagName.toLowerCase() === 'syn-md-editor');
window.__pm = () => window.__dq(el => el.tagName.toLowerCase() === 'syn-pm-editor');
window.__margin = () => window.__dq(el => el.tagName.toLowerCase() === 'comment-margin');
window.__hlText = () => window.__dqAll(el => el.classList && el.classList.contains('nb-comment')).map(e => e.textContent).join('');
window.__depth2Text = () => window.__dqAll(el => el.classList && el.classList.contains('nb-depth-2')).map(e => e.textContent).join('');
window.__cards = () => { const m = window.__margin(); return m ? Array.from(m.shadowRoot.querySelectorAll('.card')) : []; };
window.__cardTexts = () => window.__cards().map(c => { const t = c.querySelector('textarea.body'); return t ? t.value : (c.querySelector('.text') || {}).textContent; });
window.__cardByText = (s) => window.__cards().find(c => (window.__cardTexts()[window.__cards().indexOf(c)] || '').includes(s));
window.__deepActive = () => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; };
window.__highlightPoint = () => { const el = window.__dqAll(e => e.classList && e.classList.contains('nb-comment')).find(e => e.getBoundingClientRect().width > 0); if (!el) return null;
  const r = el.getBoundingClientRect(); return { x: r.left + Math.min(4, r.width / 2), y: r.top + r.height / 2 }; };
window.__toggle = () => { const b = window.__dq(e => e.classList && e.classList.contains('nb-comments-toggle')); if (!b) return null; b.click(); return b.textContent.trim(); };
true`;

async function typeText(page, text) {
  const gap = 1000 / CPS;
  for (const ch of text) { await page.typeChar(ch); await delay(gap); }
}

/** Put the caret in CodeMirror and type like a person. */
async function typeAt(page, where, text) {
  await page.eval(`(() => { const cm = window.__cm(); const doc = cm.editor.getDoc(); cm.editor.focus();
    ${where === 'start' ? `doc.setCursor({ line: 0, ch: 0 });` : `doc.setCursor({ line: doc.lastLine(), ch: doc.getLine(doc.lastLine()).length });`}
    return true; })()`);
  await typeText(page, text);
}

/** Select `needle` in the markdown editor (as a mouse selection would), press "+ Comment", type the comment. */
async function commentOn(page, needle, comment) {
  const ok = await page.eval(`(() => { const cm = window.__cm(); const doc = cm.editor.getDoc();
    const text = doc.getValue(); const i = text.indexOf(${JSON.stringify(needle)}); if (i < 0) return false;
    cm.editor.focus();
    doc.setSelection(cm.editor.posFromIndex(i), cm.editor.posFromIndex(i + ${needle.length}), { origin: '*mouse' });
    return true; })()`);
  if (!ok) throw new Error(`${page.name}: "${needle}" not in the text`);
  const btn = await waitUntil(() => page.eval(`!!window.__dq(el => el.classList && el.classList.contains('nb-add-comment'))`), 10000, 200, `${page.name} + button`);
  if (!btn) throw new Error(`${page.name}: no + Comment button for "${needle}"`);
  await page.eval(`(() => { window.__dq(el => el.classList && el.classList.contains('nb-add-comment')).click(); return true; })()`);
  const focused = await waitUntil(() => page.eval(`(() => { const a = window.__deepActive(); return !!(a && a.tagName === 'TEXTAREA' && a.classList.contains('body')); })()`), 10000, 200, `${page.name} card focus`);
  if (!focused) throw new Error(`${page.name}: the new card did not take focus`);
  await typeText(page, comment);
  await delay(500);
}

// ---------------------------------------------------------------- main
async function main() {
  console.log('=== notebooks comments e2e ===');
  const [A, B] = await startStack(['A', 'B'], { headful: HEADFUL });
  for (const p of pages) await p.eval(COMMENT_HELPERS);

  console.log('5. A creates a markdown note and types two lines');
  const noteBytes = await A.eval(`(async () => { const a = window.__app();
    await a.createNote('comments note', 'markdown'); return Array.from(a.view.noteHash); })()`);
  if (!(await waitUntil(() => A.eval(`!!window.__cm()`), 60000, 500, 'A editor'))) throw new Error('A: no editor');
  await delay(2000);
  await typeAt(A, 'end', 'alpha beta gamma delta\nepsilon zeta eta theta\n');

  console.log('6. B joins the note');
  await openNote(B, noteBytes);
  await B.eval(COMMENT_HELPERS);
  const synced = await waitUntil(async () => (await A.eval(`window.__text()`)) === (await B.eval(`window.__text()`)) && (await B.eval(`window.__text()`)).includes('theta'), 60000, 500, 'B sees the text');
  check(synced, 'B converged on the typed text');

  console.log('7. A comments on "gamma delta"');
  await commentOn(A, 'gamma delta', 'Looks wrong');
  check((await A.eval(`window.__hlText()`)) === 'gamma delta', 'A highlights exactly the selected span');
  const bHl = await waitUntil(() => B.eval(`window.__hlText() === 'gamma delta'`), 30000, 500, 'B sees the highlight');
  check(bHl, 'B sees the highlight live');
  check((await B.eval(`window.__cards().length`)) === 0, 'B\'s comment panel starts closed');
  const point = await B.eval(`JSON.stringify(window.__highlightPoint())`).then(JSON.parse);
  check(!!point, 'B has a visible highlight to click');
  if (point) await B.click(point.x, point.y);
  const bSees = await waitUntil(() => B.eval(`window.__cardTexts().some(t => (t || '').includes('Looks wrong'))`), 15000, 300, 'B panel opens on click');
  check(bSees, 'clicking the highlight opens B\'s panel with the card text');
  check((await B.eval(`(window.__cards()[0].querySelector('.quote') || {}).textContent || ''`)).includes('gamma delta'), 'the card quotes the commented text');

  console.log('8. B comments on an overlapping span "delta\\nepsilon"');
  await commentOn(B, 'delta\nepsilon', 'Mine too');
  const overlap = await waitUntil(async () => (await A.eval(`window.__depth2Text()`)) === 'delta' && (await B.eval(`window.__depth2Text()`)) === 'delta', 30000, 500, 'overlap depth');
  check(overlap, 'both agents paint the overlap "delta" at depth 2');
  check((await A.eval(`window.__hlText()`)) === 'gamma deltaepsilon', 'A paints the union of both ranges');

  console.log('9. A types at the top while both comments exist');
  await typeAt(A, 'start', 'XYZ ');
  const stable = await waitUntil(async () =>
    (await A.eval(`window.__text()`)) === (await B.eval(`window.__text()`)) &&
    (await A.eval(`window.__hlText()`)) === 'gamma deltaepsilon' &&
    (await B.eval(`window.__hlText()`)) === 'gamma deltaepsilon', 30000, 500, 'ranges follow the text');
  check(stable, 'highlights stay on the same words after an insert before them');

  console.log('10. B replies to A\'s comment');
  await B.eval(`(() => { window.__cardByText('Looks wrong').click(); return true; })()`);
  const replyBox = await waitUntil(() => B.eval(`!!window.__cardByText('Looks wrong').querySelector('.reply-box textarea')`), 10000, 200, 'reply box');
  check(replyBox, 'activating a card shows its reply box');
  await B.eval(`(() => { window.__cardByText('Looks wrong').querySelector('.reply-box textarea').focus(); return true; })()`);
  await typeText(B, 'agreed');
  await B.typeChar('\n');
  const replied = await waitUntil(() => A.eval(`(() => { const c = window.__cardByText('Looks wrong'); return !!c && Array.from(c.querySelectorAll('.reply .text')).some(e => e.textContent === 'agreed'); })()`), 30000, 500, 'A sees reply');
  check(replied, 'A sees B\'s reply');

  console.log('11. A resolves B\'s comment, then shows resolved comments');
  await A.eval(`(() => { const c = window.__cardByText('Mine too'); c.querySelector('sl-icon-button[label="Resolve"]').click(); return true; })()`);
  const resolved = await waitUntil(async () => (await A.eval(`window.__cards().length`)) === 1 && (await B.eval(`window.__cards().length`)) === 1 && (await B.eval(`window.__depth2Text()`)) === '', 30000, 500, 'resolved hidden');
  check(resolved, 'a resolved comment leaves both margins and its highlight goes');
  const header = await A.eval(`window.__margin().shadowRoot.querySelector('.header span').textContent.trim()`);
  check(header === '1 open · 1 resolved', `the header counts open and resolved (got ${JSON.stringify(header)})`);
  await A.eval(`(() => { const m = window.__margin(); const sw = m.shadowRoot.querySelector('sl-switch'); sw.click(); return true; })()`);
  const shown = await waitUntil(() => A.eval(`window.__cards().some(c => c.classList.contains('resolved'))`), 10000, 300, 'resolved shown');
  check(shown, 'the Resolved toggle shows it again, greyed');

  console.log('12. B deletes the text under A\'s comment');
  await B.eval(`(() => { const cm = window.__cm(); const doc = cm.editor.getDoc(); const t = doc.getValue();
    const i = t.indexOf('gamma delta'); doc.replaceRange('', cm.editor.posFromIndex(i), cm.editor.posFromIndex(i + 'gamma delta'.length), '+delete'); return true; })()`);
  const orphan = await waitUntil(() => A.eval(`(() => { const c = window.__cardByText('Looks wrong'); return !!c && !!c.querySelector('.quote.orphan'); })()`), 30000, 500, 'orphan card');
  check(orphan, 'A\'s card survives as an orphan with its quote');
  check(!(await A.eval(`window.__hlText()`)).includes('gamma'), 'the deleted span is no longer highlighted');

  console.log('13. A exports; B imports that file and files from earlier releases');
  // Commit A's session first: an export reads each workspace's committed tip.
  await A.eval(`(async () => { const n = window.__dq(e => e.tagName.toLowerCase() === 'markdown-note'); await n._session.value.value[0].commitChanges(); return true; })()`);
  await delay(2000);
  const exportJson = await A.eval(`(async () => JSON.stringify({ version: '1', notes: await window.__app().collectNotebooks() }))()`);
  const exported = JSON.parse(exportJson).notes.find(n => n.meta.title === 'comments note');
  check(!!exported && exported.workspaces[0].comments.length === 2, 'A\'s export carries the note with both comments');
  // Import is done from the main view, as a person would from Settings.
  await B.eval(`(() => { window.__app().view = { type: 'main' }; return true; })()`);
  await delay(5000);
  const importedHashes = await B.eval(`(async () => (await window.__app().importNotebooks(${JSON.stringify(exportJson)})).map(h => Array.from(h)))()`);
  check(importedHashes.length === JSON.parse(exportJson).notes.length, `B imported every note in A's export (${importedHashes.length})`);
  const bNotes = JSON.parse(await B.eval(`(async () => JSON.stringify(await window.__app().collectNotebooks()))()`));
  const reimported = bNotes.find(n => n.meta.title === 'comments note' && n.workspaces[0].comments.length === 2 && n.meta.author !== exported.meta.author);
  const byId = cs => [...cs].sort((x, y) => x.id.localeCompare(y.id));
  check(!!reimported && reimported.workspaces[0].note === exported.workspaces[0].note, 'the imported note has the same text');
  check(!!reimported && JSON.stringify(byId(reimported.workspaces[0].comments)) === JSON.stringify(byId(exported.workspaces[0].comments)),
    'the imported note has the same comments, replies, resolution and ranges');
  const fixtures = new URL('../ui/src/fixtures/', import.meta.url);
  for (const [file, expect] of [
    ['export-v0.0.11.json', [['Old shopping list', '# Old shopping list\n\n- eggs\n- milk\n', 'markdown']]],
    ['export-v0.6.json', [['Meeting notes', '# Meeting notes\n\nAgreed to ship on Friday.\n', 'markdown'], ['Rich', '# Rich\n\n**bold** text\n', 'richtext']]],
  ]) {
    const json = readFileSync(new URL(file, fixtures), 'utf8');
    const made = await B.eval(`(async () => (await window.__app().importNotebooks(${JSON.stringify(json)})).length)()`);
    check(made === expect.length, `${file}: B created ${made} of ${expect.length} notes`);
  }
  const afterOld = JSON.parse(await B.eval(`(async () => JSON.stringify(await window.__app().collectNotebooks()))()`));
  for (const [title, text, type] of [['Old shopping list', '# Old shopping list\n\n- eggs\n- milk\n', 'markdown'], ['Meeting notes', '# Meeting notes\n\nAgreed to ship on Friday.\n', 'markdown'], ['Rich', '# Rich\n\n**bold** text\n', 'richtext']]) {
    const n = afterOld.find(x => x.meta.title === title);
    check(!!n && n.workspaces[0].note === text && (n.meta.editorType || 'markdown') === type, `old export "${title}" imported with its text as a ${type} note`);
  }
  // Open the re-imported comments note and check the panel shows what A had.
  const reHash = importedHashes[JSON.parse(exportJson).notes.findIndex(n => n.meta.title === 'comments note')];
  await openNote(B, reHash);
  await B.eval(COMMENT_HELPERS);
  await B.eval(`window.__toggle()`);
  const reHeader = await waitUntil(() => B.eval(`(() => { const m = window.__margin(); return !!m && m.shadowRoot.querySelector('.header span').textContent.trim() === '1 open · 1 resolved'; })()`), 30000, 500, 'imported panel');
  check(reHeader, 'the imported note opens with its comments: 1 open · 1 resolved');

  console.log('14. a rich-text note gets a comment through ProseMirror');
  // The app's createNote resets the new-note form, which only exists on the main view.
  await A.eval(`(() => { window.__app().view = { type: 'main' }; return true; })()`);
  if (!(await waitUntil(() => A.eval(`!!window.__dq(el => el.id === 'note-form')`), 30000, 500, 'A main view'))) throw new Error('A: main view never rendered');
  // Leaving the previous note commits in the background; a document written
  // meanwhile can hit a source-chain "head has moved" error that the app shows
  // as "Error creating the note". Give it a moment and retry once.
  await delay(5000);
  const rtBytes = await A.eval(`(async () => { const a = window.__app();
    for (let i = 0; i < 2; i++) { await a.createNote('rich note', 'richtext'); if (a.view.noteHash) return Array.from(a.view.noteHash); await new Promise(r => setTimeout(r, 3000)); }
    throw new Error('createNote failed twice'); })()`);
  if (!(await waitUntil(() => A.eval(`!!window.__pm() && !!window.__pm().view`), 60000, 500, 'A pm editor'))) throw new Error('A: no pm editor');
  await delay(2000);
  await A.eval(`(() => { const v = window.__pm().view; v.focus(); const end = v.state.doc.content.size - 1;
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, end))); return true; })()`);
  await typeText(A, 'one two three');
  await delay(1000);
  const selected = await A.eval(`(() => { const v = window.__pm().view; let from = -1;
    v.state.doc.descendants((n, pos) => { if (n.isText && from < 0) { const i = n.text.indexOf('two'); if (i >= 0) from = pos + i; } });
    if (from < 0) return false;
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, from, from + 3))); return true; })()`);
  check(selected, 'selected "two" in the rich-text editor');
  const rtBtn = await waitUntil(() => A.eval(`!!window.__dq(el => el.classList && el.classList.contains('nb-add-comment'))`), 10000, 200, '+ button (rich)');
  check(rtBtn, 'the + Comment button appears on a rich-text selection');
  await A.eval(`(() => { window.__dq(el => el.classList && el.classList.contains('nb-add-comment')).click(); return true; })()`);
  await waitUntil(() => A.eval(`(() => { const a = window.__deepActive(); return !!(a && a.tagName === 'TEXTAREA'); })()`), 10000, 200, 'rich card focus');
  await typeText(A, 'rich');
  check((await A.eval(`window.__hlText()`)) === 'two', 'A highlights "two" in rich text');
  await openNote(B, rtBytes, 'syn-pm-editor');
  await B.eval(COMMENT_HELPERS);
  const rtHl = await waitUntil(() => B.eval(`window.__hlText() === 'two'`), 60000, 500, 'B sees rich highlight');
  check(rtHl, 'B sees the rich-text highlight');
  const toggleLabel = await B.eval(`window.__toggle()`);
  check(toggleLabel === '1', `the toolbar toggle shows the comment count (got ${JSON.stringify(toggleLabel)})`);
  const rtSeen = await waitUntil(() => B.eval(`window.__cardTexts().some(t => (t || '').includes('rich'))`), 15000, 300, 'B toggles the panel');
  check(rtSeen, 'the toggle opens B\'s panel with the rich-text comment');
  await B.eval(`window.__toggle()`);
  const closed = await waitUntil(() => B.eval(`window.__cards().length === 0`), 10000, 300, 'B closes the panel');
  check(closed, 'the toggle closes the panel again');

  const errs = pages.flatMap(p => p.errors.map(e => `[${p.name}] ${e}`)).filter(e => !/timed out in \d+ ms: call_zome/i.test(e));
  console.log(`\npage errors: ${errs.length}`);
  errs.slice(0, 12).forEach(e => console.log('   ', e.slice(0, 160)));
  check(errs.length === 0, 'no unexpected page errors');

  console.log('\n==============================');
  if (failures.length) { failures.forEach(f => console.log('FAIL:', f)); process.exitCode = 1; }
  else console.log('PASS: comments e2e');
}

const watchdog = setTimeout(() => {
  console.error(`\nERROR: run exceeded RUN_TIMEOUT_MS (${RUN_TIMEOUT_MS} ms)`);
  process.exitCode = 1;
  finish();
}, RUN_TIMEOUT_MS);

function finish() {
  clearTimeout(watchdog);
  if (KEEP) console.log('KEEP=1: leaving conductors, dev servers and Chrome running');
  else cleanup();
  setTimeout(() => process.exit(process.exitCode ?? 0), 5000).unref();
}

main()
  .catch(e => { console.error('\nERROR:', e.message); process.exitCode = 1; })
  .finally(finish);

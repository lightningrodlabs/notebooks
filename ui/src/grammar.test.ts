import { describe, it, expect } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { encodeHashToBase64 } from '@holochain/client';
import { textEditorGrammar, TextEditorState, TextEditorEphemeralState } from './grammar';
import { cursorToPosition } from './utils';

const me = new Uint8Array(39);
const meB64 = encodeHashToBase64(me);

type Ops = ReturnType<typeof textEditorGrammar.changes>;
type Docs = { state: Automerge.Doc<TextEditorState>; eph: Automerge.Doc<TextEditorEphemeralState> };

function fresh(body = ''): Docs {
  return {
    state: Automerge.from<TextEditorState>({ ...textEditorGrammar.initialState(), body }),
    eph: Automerge.from<TextEditorEphemeralState>({}),
  };
}

/** Mirrors SessionStore.change: both docs change together, grammar sees the proxies. */
function apply(d: Docs, fn: (g: Ops) => void): Docs {
  let eph = d.eph;
  const state = Automerge.change(d.state, s => {
    eph = Automerge.change(eph, e => fn(textEditorGrammar.changes(me, s, e)));
  });
  return { state, eph };
}

describe('text grammar on an Automerge Text', () => {
  it('starts with an empty body and no comments', () => {
    expect(textEditorGrammar.initialState()).toEqual({ body: '' });
  });

  it('inserts at the start and at the end', () => {
    let d = fresh();
    d = apply(d, g => g.insert(0, 'world'));
    d = apply(d, g => g.insert(0, 'hello '));
    d = apply(d, g => g.insert(11, '!'));
    expect(d.state.body).toBe('hello world!');
  });

  it('deletes a middle range', () => {
    let d = fresh('hello world');
    d = apply(d, g => g.delete(5, 6));
    expect(d.state.body).toBe('hello');
  });

  it('clamps an insert past the end', () => {
    let d = fresh('ab');
    d = apply(d, g => g.insert(10, 'c'));
    expect(d.state.body).toBe('abc');
  });

  it('stores a selection as a cursor that follows the text', () => {
    let d = fresh('hello world');
    d = apply(d, g => g.changeSelection(3, 2));
    expect(d.eph[meB64].characterCount).toBe(2);
    expect(cursorToPosition(d.state, d.eph[meB64].cursor)).toBe(3);
    const remote = Automerge.change(d.state, s => Automerge.splice(s, ['body'], 0, 0, 'XX'));
    expect(cursorToPosition(remote, d.eph[meB64].cursor)).toBe(5);
  });

  it('a remote cursor survives deletion of the character it points at', () => {
    let d = fresh('hello world');
    d = apply(d, g => g.changeSelection(6, 0));
    const cursor = d.eph[meB64].cursor;
    const after = Automerge.change(d.state, s => Automerge.splice(s, ['body'], 5, 3));
    expect(cursorToPosition(after, cursor)).toBe(5);
  });

  it('places my cursor after inserted text and at the deletion point', () => {
    let d = fresh('abc');
    d = apply(d, g => g.insert(1, 'XY'));
    expect(cursorToPosition(d.state, d.eph[meB64].cursor)).toBe(3);
    d = apply(d, g => g.delete(0, 2));
    expect(cursorToPosition(d.state, d.eph[meB64].cursor)).toBe(0);
  });

  it('cursorToPosition returns undefined for garbage', () => {
    expect(cursorToPosition(fresh('a').state, 'nope')).toBeUndefined();
  });
});

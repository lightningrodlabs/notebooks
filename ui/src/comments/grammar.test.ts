import { describe, it, expect } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { encodeHashToBase64 } from '@holochain/client';
import { textEditorGrammar, TextEditorState, TextEditorEphemeralState } from '../grammar';
import { markName } from './types';

const me = new Uint8Array(39);
const meB64 = encodeHashToBase64(me);
const other = new Uint8Array(39).fill(1);

type Ops = ReturnType<typeof textEditorGrammar.changes>;
type Docs = { state: Automerge.Doc<TextEditorState>; eph: Automerge.Doc<TextEditorEphemeralState> };

function fresh(body = 'hello world'): Docs {
  return {
    state: Automerge.from<TextEditorState>({ ...textEditorGrammar.initialState(), body }),
    eph: Automerge.from<TextEditorEphemeralState>({}),
  };
}
function apply(d: Docs, fn: (g: Ops) => void, who: Uint8Array = me): Docs {
  let eph = d.eph;
  const state = Automerge.change(d.state, s => {
    eph = Automerge.change(eph, e => fn(textEditorGrammar.changes(who, s, e)));
  });
  return { state, eph };
}
const marks = (d: Docs) => Automerge.marks(d.state, ['body']);
const fork = (d: Docs): Docs => ({ state: Automerge.clone(d.state), eph: Automerge.clone(d.eph) });
const withComment = (body = 'hello world') =>
  apply(fresh(body), g => g.addComment({ id: 'a', from: 6, to: 11, text: 'nice', created: 1000 }));

describe('comment operations', () => {
  it('addComment stores the record and a mark over the range', () => {
    const d = withComment();
    expect(d.state.comments!.a).toEqual({
      id: 'a', author: meB64, created: 1000, text: 'nice', quote: 'world', resolved: false, replies: [],
    });
    expect(marks(d)).toEqual([{ name: markName('a'), value: true, start: 6, end: 11 }]);
  });

  it('works on a document without a comments map yet', () => {
    const bare = { state: Automerge.from<TextEditorState>({ body: 'hello world' }), eph: Automerge.from<TextEditorEphemeralState>({}) };
    const d = apply(bare, g => g.addComment({ id: 'a', from: 0, to: 5 }));
    expect(d.state.body).toBe('hello world');
    expect(d.state.comments!.a.quote).toBe('hello');
    expect(d.state.comments!.a.text).toBe('');
  });

  it('setCommentText, setResolved, replies', () => {
    let d = withComment();
    d = apply(d, g => g.setCommentText('a', 'edited'));
    d = apply(d, g => g.setResolved('a', true));
    d = apply(d, g => g.addReply('a', { id: 'r1', text: 'reply', created: 2000 }), other);
    d = apply(d, g => g.setReplyText('a', 'r1', 'reply!'));
    expect(d.state.comments!.a.text).toBe('edited');
    expect(d.state.comments!.a.resolved).toBe(true);
    expect(d.state.comments!.a.replies).toEqual([{ id: 'r1', author: encodeHashToBase64(other), created: 2000, text: 'reply!' }]);
    d = apply(d, g => g.deleteReply('a', 'r1'));
    expect(d.state.comments!.a.replies).toEqual([]);
  });

  it('deleteComment removes the record and the mark', () => {
    let d = withComment();
    d = apply(d, g => g.deleteComment('a'));
    expect(d.state.comments!.a).toBeUndefined();
    expect(marks(d)).toEqual([]);
  });

  it('typing at the edges does not grow the range, typing inside does', () => {
    let d = withComment();
    d = apply(d, g => g.insert(11, '!'));
    d = apply(d, g => g.insert(6, '>'));
    expect(marks(d)[0]).toMatchObject({ start: 7, end: 12 });
    d = apply(d, g => g.insert(8, 'XX'));
    expect(marks(d)[0]).toMatchObject({ start: 7, end: 14 });
  });

  it('deleting the whole range orphans the comment but keeps its record', () => {
    let d = withComment();
    d = apply(d, g => g.delete(5, 6));
    expect(d.state.body).toBe('hello');
    expect(d.state.comments!.a.quote).toBe('world');
    expect(marks(d)).toEqual([]);
  });

  it('two peers commenting on overlapping ranges both survive a merge', () => {
    const base = withComment();
    const mine = apply(fork(base), g => g.insert(0, 'XX'));
    const theirs = apply(fork(base), g => g.addComment({ id: 'b', from: 2, to: 8, text: 'also' }), other);
    const merged = Automerge.merge(mine.state, theirs.state);
    expect(Object.keys(merged.comments!).sort()).toEqual(['a', 'b']);
    expect(Automerge.marks(merged, ['body'])).toEqual([
      { name: markName('a'), value: true, start: 8, end: 13 },
      { name: markName('b'), value: true, start: 4, end: 10 },
    ]);
  });

  it('concurrent replies both survive a merge', () => {
    const base = withComment();
    const x = apply(fork(base), g => g.addReply('a', { id: 'r1', text: 'one' }));
    const y = apply(fork(base), g => g.addReply('a', { id: 'r2', text: 'two' }), other);
    const merged = Automerge.merge(x.state, y.state);
    expect(merged.comments!.a.replies.map(r => r.id).sort()).toEqual(['r1', 'r2']);
  });
});

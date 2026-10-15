import { describe, it, expect } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { exportComments, initialStateWithComments, ExportedComment } from './export';
import { commentRanges } from './ranges';
import { TextEditorState } from '../grammar';
import { markName } from './types';

const base = (): Automerge.Doc<TextEditorState> =>
  Automerge.change(Automerge.from<TextEditorState>({ body: 'hello world', comments: {} }), s => {
    s.comments!.a = { id: 'a', author: 'me', created: 1, text: 'A', quote: 'world', resolved: false, replies: [{ id: 'r', author: 'you', created: 2, text: 'R' }] };
    s.comments!.o = { id: 'o', author: 'me', created: 3, text: 'gone', quote: 'x', resolved: true, replies: [] };
    Automerge.mark(s, ['body'], { start: 6, end: 11, expand: 'none' }, markName('a'), true);
  });

describe('exportComments', () => {
  it('carries records with their current offsets, orphans without', () => {
    const out = exportComments(base()).sort((x, y) => x.id.localeCompare(y.id));
    expect(out).toEqual([
      { id: 'a', author: 'me', created: 1, text: 'A', quote: 'world', resolved: false, replies: [{ id: 'r', author: 'you', created: 2, text: 'R' }], start: 6, end: 11 },
      { id: 'o', author: 'me', created: 3, text: 'gone', quote: 'x', resolved: true, replies: [] },
    ]);
  });
  it('is empty for a doc without comments', () => {
    expect(exportComments(Automerge.from<TextEditorState>({ body: 'x' }))).toEqual([]);
  });
});

describe('initialStateWithComments', () => {
  it('round-trips: records and marks come back, orphans import without marks', () => {
    const exported: ExportedComment[] = exportComments(base());
    const doc = initialStateWithComments('hello world', exported);
    expect(doc.body).toBe('hello world');
    expect(Object.keys(doc.comments!).sort()).toEqual(['a', 'o']);
    expect(doc.comments!.a.replies).toEqual([{ id: 'r', author: 'you', created: 2, text: 'R' }]);
    expect(commentRanges(doc)).toEqual([{ id: 'a', start: 6, end: 11 }]);
  });
  it('clamps offsets that no longer fit the text', () => {
    const doc = initialStateWithComments('hi', [{ id: 'a', author: 'me', created: 1, text: '', quote: 'q', resolved: false, replies: [], start: 1, end: 50 }]);
    expect(commentRanges(doc)).toEqual([{ id: 'a', start: 1, end: 2 }]);
  });
  it('builds a plain doc when there are no comments', () => {
    const doc = initialStateWithComments('# T', undefined);
    expect(doc.body).toBe('# T');
    expect(commentRanges(doc)).toEqual([]);
  });
});

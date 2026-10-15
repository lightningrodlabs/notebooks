import { describe, it, expect } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { commentsView, commentAt, visibleRanges } from './model';
import { TextEditorState } from '../grammar';
import { Comment, markName } from './types';

const c = (id: string, created: number, resolved = false): Comment =>
  ({ id, author: 'x', created, text: id, quote: 'q', resolved, replies: [] });

function doc(): Automerge.Doc<TextEditorState> {
  return Automerge.change(Automerge.from<TextEditorState>({ body: 'hello world', comments: {} }), s => {
    s.comments!.late = c('late', 3);
    s.comments!.early = c('early', 1);
    s.comments!.orphanB = c('orphanB', 5);
    s.comments!.orphanA = c('orphanA', 4);
    s.comments!.done = c('done', 2, true);
    Automerge.mark(s, ['body'], { start: 6, end: 11, expand: 'none' }, markName('late'), true);
    Automerge.mark(s, ['body'], { start: 0, end: 5, expand: 'none' }, markName('early'), true);
    Automerge.mark(s, ['body'], { start: 2, end: 3, expand: 'none' }, markName('done'), true);
  });
}

describe('commentsView', () => {
  it('orders anchored comments by position, then orphans by creation, hiding resolved', () => {
    const v = commentsView(doc(), false);
    expect(v.map(x => x.id)).toEqual(['early', 'late', 'orphanA', 'orphanB']);
    expect(v[0].range).toEqual({ id: 'early', start: 0, end: 5 });
    expect(v[2].range).toBeNull();
  });
  it('includes resolved comments on request', () => {
    expect(commentsView(doc(), true).map(x => x.id)).toEqual(['early', 'done', 'late', 'orphanA', 'orphanB']);
  });
  it('is empty for a legacy doc', () => {
    expect(commentsView(Automerge.from({ text: ['a'] }) as any, true)).toEqual([]);
  });
});

describe('commentAt', () => {
  const ranges = [{ id: 'outer', start: 0, end: 10 }, { id: 'inner', start: 2, end: 4 }];
  it('picks the innermost range containing the offset', () => {
    expect(commentAt(ranges, 3)).toBe('inner');
    expect(commentAt(ranges, 7)).toBe('outer');
  });
  it('is null outside every range (end is exclusive)', () => {
    expect(commentAt(ranges, 10)).toBeNull();
  });
});

describe('visibleRanges', () => {
  it('drops the ranges of resolved comments when they are hidden', () => {
    expect(visibleRanges(doc(), false).map(r => r.id)).toEqual(['early', 'late']);
    expect(visibleRanges(doc(), true).map(r => r.id)).toEqual(['early', 'done', 'late']);
  });
});

describe('filters in the view model', () => {
  const filtered = (): Automerge.Doc<TextEditorState> =>
    Automerge.change(Automerge.from<TextEditorState>({ body: 'hello world', comments: {} }), s => {
      s.comments!.mine = { ...c('mine', 1), author: 'me' };
      s.comments!.theirs = { ...c('theirs', 2), assignee: { agent: 'me', by: 'x', at: 3 } };
      Automerge.mark(s, ['body'], { start: 0, end: 5, expand: 'none' }, markName('mine'), true);
      Automerge.mark(s, ['body'], { start: 6, end: 11, expand: 'none' }, markName('theirs'), true);
    });
  it('commentsView keeps only matching comments', () => {
    expect(commentsView(filtered(), false, { filter: 'assigned', me: 'me' }).map(x => x.id)).toEqual(['theirs']);
    expect(commentsView(filtered(), false, { filter: 'mine', me: 'me' }).map(x => x.id)).toEqual(['mine']);
    expect(commentsView(filtered(), false, { filter: 'all', me: 'me' }).map(x => x.id)).toEqual(['mine', 'theirs']);
  });
  it('visibleRanges hides the highlights of filtered-out comments', () => {
    expect(visibleRanges(filtered(), false, { filter: 'assigned', me: 'me' }).map(r => r.id)).toEqual(['theirs']);
  });
});

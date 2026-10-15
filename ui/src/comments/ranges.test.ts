import { describe, it, expect } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { commentRanges, segments } from './ranges';
import { markName } from './types';

describe('commentRanges', () => {
  it('reads comment marks sorted by start and ignores other marks', () => {
    let d = Automerge.from({ body: 'hello world' });
    d = Automerge.change(d, s => {
      Automerge.mark(s, ['body'], { start: 6, end: 11, expand: 'none' }, markName('b'), true);
      Automerge.mark(s, ['body'], { start: 0, end: 5, expand: 'none' }, markName('a'), true);
      Automerge.mark(s, ['body'], { start: 0, end: 2, expand: 'none' }, 'bold', true);
    });
    expect(commentRanges(d)).toEqual([{ id: 'a', start: 0, end: 5 }, { id: 'b', start: 6, end: 11 }]);
  });
  it('is empty for a legacy doc without a body', () => {
    expect(commentRanges(Automerge.from({ text: ['a'] }) as any)).toEqual([]);
  });
});

describe('segments', () => {
  it('splits overlapping ranges into pieces carrying every id', () => {
    expect(segments([{ id: 'a', start: 0, end: 5 }, { id: 'b', start: 3, end: 8 }])).toEqual([
      { start: 0, end: 3, ids: ['a'] },
      { start: 3, end: 5, ids: ['a', 'b'] },
      { start: 5, end: 8, ids: ['b'] },
    ]);
  });
  it('identical ranges give one piece with both ids', () => {
    expect(segments([{ id: 'a', start: 2, end: 4 }, { id: 'b', start: 2, end: 4 }])).toEqual([{ start: 2, end: 4, ids: ['a', 'b'] }]);
  });
  it('drops empty pieces and gaps', () => {
    expect(segments([{ id: 'a', start: 1, end: 1 }, { id: 'b', start: 4, end: 6 }])).toEqual([{ start: 4, end: 6, ids: ['b'] }]);
  });
  it('nested ranges', () => {
    expect(segments([{ id: 'a', start: 0, end: 10 }, { id: 'b', start: 2, end: 4 }])).toEqual([
      { start: 0, end: 2, ids: ['a'] },
      { start: 2, end: 4, ids: ['a', 'b'] },
      { start: 4, end: 10, ids: ['a'] },
    ]);
  });
});

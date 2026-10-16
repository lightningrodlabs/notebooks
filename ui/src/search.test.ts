import { describe, expect, it } from 'vitest';
import { findHits, nearestOccurrence } from './search';

describe('findHits', () => {
  it('finds every case-insensitive occurrence with its line as the snippet', () => {
    const { hits, total } = findHits('# Title\nApples and apples\nno match\nAPPLE pie', 'apple');
    expect(total).toBe(3);
    expect(hits.map(h => h.offset)).toEqual([8, 19, 35]);
    expect(hits[1]).toEqual({ offset: 19, before: 'Apples and ', match: 'apple', after: 's' });
    expect(hits[2]).toEqual({ offset: 35, before: '', match: 'APPLE', after: ' pie' });
  });

  it('trims long lines to a window and marks the cut', () => {
    const text = 'x'.repeat(100) + 'needle' + 'y'.repeat(100);
    const [hit] = findHits(text, 'needle').hits;
    expect(hit.before).toBe('…' + 'x'.repeat(60));
    expect(hit.after).toBe('y'.repeat(60) + '…');
  });

  it('caps the hits but counts them all', () => {
    const { hits, total } = findHits('a a a a a', 'a', 2);
    expect(hits).toHaveLength(2);
    expect(total).toBe(5);
  });

  it('finds nothing for an empty query', () => {
    expect(findHits('abc', '')).toEqual({ hits: [], total: 0 });
  });
});

describe('nearestOccurrence', () => {
  it('picks the occurrence closest to the offset', () => {
    const text = 'cat dog cat dog cat';
    expect(nearestOccurrence(text, 'CAT', 9)).toEqual([8, 11]);
    expect(nearestOccurrence(text, 'cat', 100)).toEqual([16, 19]);
  });

  it('follows the match when text was inserted before it', () => {
    expect(nearestOccurrence('new line\nhello world', 'world', 6)).toEqual([15, 20]);
  });

  it('is undefined when the query is gone', () => {
    expect(nearestOccurrence('abc', 'z', 0)).toBeUndefined();
  });
});

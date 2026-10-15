import { describe, it, expect } from 'vitest';
import { fitCards } from './layout';

describe('fitCards', () => {
  it('leaves non-colliding cards at their anchors', () => {
    const tops = fitCards([{ id: 'a', anchorTop: 0, height: 20 }, { id: 'b', anchorTop: 100, height: 20 }], null);
    expect(tops.get('a')).toBe(0);
    expect(tops.get('b')).toBe(100);
  });
  it('pushes cards below the active one down to keep the gap', () => {
    const tops = fitCards([{ id: 'a', anchorTop: 0, height: 50 }, { id: 'b', anchorTop: 10, height: 50 }], 'a', 30);
    expect(tops.get('a')).toBe(0);
    expect(tops.get('b')).toBe(80);
  });
  it('pushes cards above the active one up, possibly negative', () => {
    const tops = fitCards([{ id: 'a', anchorTop: 0, height: 50 }, { id: 'b', anchorTop: 10, height: 50 }], 'b', 30);
    expect(tops.get('b')).toBe(10);
    expect(tops.get('a')).toBe(-70);
  });
  it('returns an empty map for no cards', () => {
    expect(fitCards([], null).size).toBe(0);
  });
});

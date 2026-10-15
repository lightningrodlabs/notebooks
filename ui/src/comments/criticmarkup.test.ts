import { describe, it, expect } from 'vitest';
import { toCriticMarkup } from './criticmarkup';
import { Comment } from './types';

const c = (id: string, text: string, resolved = false): Comment =>
  ({ id, author: 'uhCAk' + id, created: 0, text, quote: 'q', resolved, replies: [] });

describe('toCriticMarkup', () => {
  it('wraps a commented span', () => {
    expect(toCriticMarkup('hello world', [c('a', 'nice')], [{ id: 'a', start: 6, end: 11 }]))
      .toBe('hello {==world==}{>>@uhCAka: nice<<}');
  });
  it('splits overlaps into adjacent pieces', () => {
    const out = toCriticMarkup('abcdef', [c('a', 'A'), c('b', 'B')], [{ id: 'a', start: 0, end: 4 }, { id: 'b', start: 2, end: 6 }]);
    expect(out).toBe('{==ab==}{>>@uhCAka: A<<}{==cd==}{>>@uhCAka: A<<}{>>@uhCAkb: B<<}{==ef==}{>>@uhCAkb: B<<}');
  });
  it('skips resolved comments and appends orphans', () => {
    const out = toCriticMarkup('abc', [c('a', 'A', true), c('o', 'gone')], [{ id: 'a', start: 0, end: 1 }]);
    expect(out).toBe('abc\n\n{>>@uhCAko (detached, was "q"): gone<<}');
  });
  it('includes replies after the comment text', () => {
    const withReply = { ...c('a', 'A'), replies: [{ id: 'r', author: 'uhCAkr', created: 0, text: 'R' }] };
    expect(toCriticMarkup('ab', [withReply], [{ id: 'a', start: 0, end: 1 }])).toBe('{==a==}{>>@uhCAka: A // @uhCAkr: R<<}b');
  });
});

describe('toCriticMarkup with display names', () => {
  it('uses the given name for an author and falls back to the key', () => {
    const names = new Map([['uhCAka', 'Ann']]);
    const out = toCriticMarkup('ab', [c('a', 'A'), c('b', 'B')], [{ id: 'a', start: 0, end: 1 }, { id: 'b', start: 1, end: 2 }], names);
    expect(out).toBe('{==a==}{>>@Ann: A<<}{==b==}{>>@uhCAkb: B<<}');
  });
});

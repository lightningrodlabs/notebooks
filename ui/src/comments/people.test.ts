import { describe, it, expect } from 'vitest';
import { mentionQuery, insertMention, pruneMentions, matchPeople } from './people';

const people = [
  { key: 'kA', name: 'Ann' },
  { key: 'kB', name: 'Bob' },
  { key: 'kC', name: 'annette' },
];

describe('mentionQuery', () => {
  it('finds the @ word the caret is in', () => {
    expect(mentionQuery('hi @an', 6)).toEqual({ start: 3, query: 'an' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
  });
  it('ignores an @ inside a word, like an email address', () => {
    expect(mentionQuery('me@an', 5)).toBeNull();
  });
  it('stops at whitespace', () => {
    expect(mentionQuery('@ann bob', 8)).toBeNull();
  });
});

describe('insertMention', () => {
  it('replaces the query with the name and a space, caret after it', () => {
    expect(insertMention('hi @an there', 3, 6, 'Ann')).toEqual({ text: 'hi @Ann  there', caret: 8 });
  });
});

describe('pruneMentions', () => {
  it('keeps only people whose @name is still in the text, without duplicates', () => {
    const names = new Map([['kA', 'Ann'], ['kB', 'Bob']]);
    expect(pruneMentions('ping @Ann and @Ann', ['kA', 'kB', 'kA'], names)).toEqual(['kA']);
  });
  it('drops people without a known name', () => {
    expect(pruneMentions('@Zed', ['kZ'], new Map())).toEqual([]);
  });
});

describe('matchPeople', () => {
  it('matches case-insensitively, prefixes first', () => {
    expect(matchPeople(people, 'an').map(p => p.key)).toEqual(['kA', 'kC']);
  });
  it('matches inside names too', () => {
    expect(matchPeople(people, 'ob').map(p => p.key)).toEqual(['kB']);
  });
  it('lists everyone for an empty query, capped', () => {
    expect(matchPeople(people, '', 2)).toHaveLength(2);
  });
  it('can leave someone out', () => {
    expect(matchPeople(people, '', 8, 'kB').map(p => p.key)).toEqual(['kA', 'kC']);
  });
});

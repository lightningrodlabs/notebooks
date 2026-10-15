import { describe, it, expect } from 'vitest';
import { matchesFilter } from './filters';
import { Comment } from './types';

const base: Comment = { id: 'c', author: 'other', created: 0, text: '', quote: '', resolved: false, replies: [] };

describe('matchesFilter', () => {
  it('all matches everything', () => {
    expect(matchesFilter(base, 'all', 'me')).toBe(true);
  });
  it('assigned matches only comments assigned to me', () => {
    expect(matchesFilter({ ...base, assignee: { agent: 'me', by: 'x', at: 1 } }, 'assigned', 'me')).toBe(true);
    expect(matchesFilter({ ...base, assignee: { agent: 'x', by: 'me', at: 1 } }, 'assigned', 'me')).toBe(false);
    expect(matchesFilter(base, 'assigned', 'me')).toBe(false);
  });
  it('mine matches what I wrote, replied to, or am mentioned in', () => {
    expect(matchesFilter({ ...base, author: 'me' }, 'mine', 'me')).toBe(true);
    expect(matchesFilter({ ...base, replies: [{ id: 'r', author: 'me', created: 0, text: '' }] }, 'mine', 'me')).toBe(true);
    expect(matchesFilter({ ...base, mentions: ['me'] }, 'mine', 'me')).toBe(true);
    expect(matchesFilter({ ...base, replies: [{ id: 'r', author: 'x', created: 0, text: '', mentions: ['me'] }] }, 'mine', 'me')).toBe(true);
    expect(matchesFilter(base, 'mine', 'me')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { countComments, headerLabel } from './counts';
import { Comment } from './types';

const c = (id: string, resolved: boolean): Comment =>
  ({ id, author: 'x', created: 0, text: '', quote: '', resolved, replies: [] });

describe('countComments', () => {
  it('splits open and resolved', () => {
    expect(countComments({ a: c('a', false), b: c('b', true), d: c('d', false) })).toEqual({ open: 2, resolved: 1 });
  });
  it('is zero for no comments', () => {
    expect(countComments(undefined)).toEqual({ open: 0, resolved: 0 });
  });
});

describe('headerLabel', () => {
  it('names only the total when nothing is resolved', () => {
    expect(headerLabel({ open: 1, resolved: 0 })).toBe('1 comment');
    expect(headerLabel({ open: 2, resolved: 0 })).toBe('2 comments');
  });
  it('shows both numbers once anything is resolved', () => {
    expect(headerLabel({ open: 2, resolved: 1 })).toBe('2 open · 1 resolved');
    expect(headerLabel({ open: 0, resolved: 3 })).toBe('0 open · 3 resolved');
  });
});

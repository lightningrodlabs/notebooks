import { describe, it, expect } from 'vitest';
import { textOf } from './text';

describe('textOf', () => {
  it('returns the body', () => {
    expect(textOf({ body: 'ab' })).toBe('ab');
  });
  it('is empty for a missing state or body', () => {
    expect(textOf(undefined)).toBe('');
    expect(textOf({})).toBe('');
  });
});

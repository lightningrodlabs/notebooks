import { describe, it, expect } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { textOf, isMigrated, migrateText, TextShapes } from './text';

const legacy = () => Automerge.from<TextShapes>({ text: '# T\n\nhi'.split('') });

describe('textOf', () => {
  it('joins the legacy character list', () => {
    expect(textOf({ text: ['a', 'b'] })).toBe('ab');
  });
  it('returns the body when present', () => {
    expect(textOf({ body: 'ab' })).toBe('ab');
  });
  it('is empty for an undefined state', () => {
    expect(textOf(undefined)).toBe('');
  });
});

describe('migrateText', () => {
  it('turns the character list into a body Text and drops the list', () => {
    const d = Automerge.change(legacy(), s => migrateText(s));
    expect(d.body).toBe('# T\n\nhi');
    expect('text' in d).toBe(false);
    expect(isMigrated(d)).toBe(true);
    expect(isMigrated(legacy())).toBe(false);
  });
  it('is a no-op on an already migrated doc', () => {
    let d = Automerge.change(legacy(), s => migrateText(s));
    const heads = Automerge.getHeads(d);
    d = Automerge.change(d, s => migrateText(s));
    expect(Automerge.getHeads(d)).toEqual(heads);
  });
  it('concurrent migration converges on the same text with no list left', () => {
    const base = legacy();
    const a = Automerge.change(Automerge.clone(base), s => migrateText(s));
    const b = Automerge.change(Automerge.clone(base), s => migrateText(s));
    const m = Automerge.merge(a, b);
    expect(textOf(m)).toBe('# T\n\nhi');
    expect(m.text).toBeUndefined();
    expect(Automerge.marks(m, ['body'])).toEqual([]);
  });
});

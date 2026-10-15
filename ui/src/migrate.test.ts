import { describe, it, expect } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { migrationChange } from './migrate';
import { TextShapes, textOf } from './text';

const legacy = () => Automerge.from<TextShapes>({ text: '# T\n\nhi'.split('') });

describe('migrationChange', () => {
  it('two peers migrating the same base produce the identical change, so a merge has one body', () => {
    const base = legacy();
    const a = Automerge.clone(base, 'aaaa');
    const b = Automerge.clone(base, 'bbbb');
    const changeA = migrationChange(a)!;
    const changeB = migrationChange(b)!;
    expect(Automerge.decodeChange(changeA).hash).toBe(Automerge.decodeChange(changeB).hash);
    const [a2] = Automerge.applyChanges(a, [changeA]);
    const [b2] = Automerge.applyChanges(b, [changeB]);
    expect(Automerge.getHeads(a2)).toEqual(Automerge.getHeads(b2));
    // each peer then types into its body; the merge keeps both edits
    const a3 = Automerge.change(a2, s => Automerge.splice(s, ['body'], 0, 0, 'A'));
    const b3 = Automerge.change(b2, s => Automerge.splice(s, ['body'], s.body!.length, 0, 'B'));
    const m = Automerge.merge(a3, b3);
    expect(textOf(m)).toBe('A# T\n\nhiB');
    expect(m.text).toBeUndefined();
    expect(Automerge.getConflicts(m, 'body')).toBeUndefined();
  });
  it('returns null for a doc that is already migrated', () => {
    expect(migrationChange(Automerge.from<TextShapes>({ body: 'x' }))).toBeNull();
  });
  it('does not touch the doc it was given', () => {
    const d = legacy();
    migrationChange(d);
    expect(d.text).toHaveLength(7);
    expect(d.body).toBeUndefined();
  });
});

describe('migrationChange on divergent bases', () => {
  it('produces distinct changes that still merge instead of a duplicate-seq error', () => {
    const base = legacy();
    const a = Automerge.change(Automerge.clone(base, 'aaaa'), s => { s.text!.push('A'); });
    const b = Automerge.change(Automerge.clone(base, 'bbbb'), s => { s.text!.push('B'); });
    const ca = migrationChange(a)!;
    const cb = migrationChange(b)!;
    expect(Automerge.decodeChange(ca).actor).not.toBe(Automerge.decodeChange(cb).actor);
    const [a2] = Automerge.applyChanges(a, [ca]);
    const [b2] = Automerge.applyChanges(b, [cb]);
    expect(() => Automerge.applyChanges(Automerge.clone(a2), [cb])).not.toThrow();
    const m = Automerge.merge(Automerge.clone(a2), Automerge.clone(b2));
    expect(typeof m.body).toBe('string');
    expect(m.text).toBeUndefined();
  });
});

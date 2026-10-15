import { describe, it, expect } from 'vitest';
import { pendingNotifications, NoteComments } from './notifications';
import { Comment } from './types';

const c = (over: Partial<Comment>): Comment =>
  ({ id: 'c1', author: 'x', created: 100, text: 'look @Me', quote: 'q', resolved: false, replies: [], ...over });

const note = (comments: Comment[]): NoteComments => ({ noteHash: 'n1', title: 'Plan', comments });

describe('pendingNotifications', () => {
  it('reports a mention of me by someone else', () => {
    const out = pendingNotifications([note([c({ mentions: ['me'] })])], 'me', new Set());
    expect(out).toEqual([{ key: 'm:n1:c1:', kind: 'mention', noteHash: 'n1', title: 'Plan', from: 'x', at: 100, text: 'look @Me' }]);
  });
  it('reports a mention in a reply, keyed by the reply', () => {
    const out = pendingNotifications([note([c({ replies: [{ id: 'r1', author: 'y', created: 200, text: 'cc @Me', mentions: ['me'] }] })])], 'me', new Set());
    expect(out.map(n => [n.key, n.from, n.at])).toEqual([['m:n1:c1:r1', 'y', 200]]);
  });
  it('reports an assignment to me, again after a reassignment', () => {
    const first = pendingNotifications([note([c({ assignee: { agent: 'me', by: 'x', at: 300 } })])], 'me', new Set());
    expect(first.map(n => [n.key, n.kind, n.from, n.at])).toEqual([['a:n1:c1:300', 'assigned', 'x', 300]]);
    const again = pendingNotifications([note([c({ assignee: { agent: 'me', by: 'x', at: 400 } })])], 'me', new Set(['a:n1:c1:300']));
    expect(again.map(n => n.key)).toEqual(['a:n1:c1:400']);
  });
  it('skips what I did myself, what was already seen, and resolved comments', () => {
    const notes = [note([
      c({ id: 'self', author: 'me', mentions: ['me'] }),
      c({ id: 'selfassign', assignee: { agent: 'me', by: 'me', at: 1 } }),
      c({ id: 'seen', mentions: ['me'] }),
      c({ id: 'done', mentions: ['me'], resolved: true }),
    ])];
    expect(pendingNotifications(notes, 'me', new Set(['m:n1:seen:']))).toEqual([]);
  });
});

describe('frameNotification', () => {
  it('builds a Moss notification that opens the note', async () => {
    const { frameNotification } = await import('./notifications');
    const { encodeHashToBase64 } = await import('@holochain/client');
    const note = encodeHashToBase64(new Uint8Array([132, 33, 36, ...new Array(36).fill(1)]));
    const from = encodeHashToBase64(new Uint8Array([132, 32, 36, ...new Array(36).fill(2)]));
    const me = new Uint8Array([132, 32, 36, ...new Array(36).fill(3)]);
    const dna = new Uint8Array([132, 45, 36, ...new Array(36).fill(4)]);
    const n = frameNotification({ key: 'k', kind: 'mention', noteHash: note, title: 'Plan', from, at: 7, text: 'look @Me' }, 'Ann', dna, me);
    expect(n.title).toBe('Ann mentioned you in "Plan"');
    expect(n.body).toBe('look @Me');
    expect(n.notification_type).toBe('mention');
    expect(n.urgency).toBe('high');
    expect(n.timestamp).toBe(7);
    expect(Array.from(n.aboutWal!.hrl[0])).toEqual(Array.from(dna));
    expect(encodeHashToBase64(n.aboutWal!.hrl[1])).toBe(note);
    expect(encodeHashToBase64(n.fromAgent!)).toBe(from);
    const a = frameNotification({ key: 'k', kind: 'assigned', noteHash: note, title: 'Plan', from, at: 7, text: '' }, 'Ann', dna, me);
    expect(a.title).toBe('Ann assigned you a comment in "Plan"');
    expect(a.notification_type).toBe('assignment');
  });
});

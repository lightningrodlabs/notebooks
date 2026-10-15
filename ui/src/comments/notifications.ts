import { decodeHashFromBase64 } from '@holochain/client';
import type { FrameNotification } from '@theweave/api';
import { Comment } from './types';

/** One note's comments, as the notification watcher sees them. */
export interface NoteComments {
  /** EntryHashB64 of the note's document */
  noteHash: string;
  title: string;
  comments: Comment[];
}

export interface PendingNotification {
  /** Stable identity, so each event is reported once. */
  key: string;
  kind: 'mention' | 'assigned';
  noteHash: string;
  title: string;
  /** AgentPubKeyB64 of whoever caused it */
  from: string;
  /** ms since epoch */
  at: number;
  text: string;
}

/**
 * Mentions of `me` and assignments to `me` by someone else, in unresolved
 * comments, that are not in `seen`. A reassignment is a new event (its key
 * carries the assignment time); editing a comment does not re-report a
 * mention that was already seen.
 */
export function pendingNotifications(notes: NoteComments[], me: string, seen: Set<string>): PendingNotification[] {
  const out: PendingNotification[] = [];
  for (const note of notes) {
    for (const c of note.comments.filter(x => !x.resolved)) {
      const base = { noteHash: note.noteHash, title: note.title };
      if (c.author !== me && (c.mentions ?? []).includes(me)) {
        out.push({ key: `m:${note.noteHash}:${c.id}:`, kind: 'mention', ...base, from: c.author, at: c.created, text: c.text });
      }
      for (const r of c.replies) {
        if (r.author !== me && (r.mentions ?? []).includes(me)) {
          out.push({ key: `m:${note.noteHash}:${c.id}:${r.id}`, kind: 'mention', ...base, from: r.author, at: r.created, text: r.text });
        }
      }
      const a = c.assignee;
      if (a && a.agent === me && a.by !== me) {
        out.push({ key: `a:${note.noteHash}:${c.id}:${a.at}`, kind: 'assigned', ...base, from: a.by, at: a.at, text: c.text });
      }
    }
  }
  return out.filter(n => !seen.has(n.key));
}

/** The Moss notification for a pending event; clicking it opens the note. */
export function frameNotification(
  p: PendingNotification,
  fromName: string,
  dnaHash: Uint8Array,
  me: Uint8Array
): FrameNotification {
  const what = p.kind === 'mention' ? 'mentioned you' : 'assigned you a comment';
  return {
    title: `${fromName} ${what} in "${p.title}"`,
    body: p.text.length > 140 ? `${p.text.slice(0, 140)}…` : p.text,
    notification_type: p.kind === 'mention' ? 'mention' : 'assignment',
    icon_src: undefined,
    urgency: 'high',
    timestamp: p.at,
    aboutWal: { hrl: [dnaHash, decodeHashFromBase64(p.noteHash)], context: {} },
    fromAgent: decodeHashFromBase64(p.from),
    forAgents: [me],
  };
}

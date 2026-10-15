import * as Automerge from '@automerge/automerge';
import { TextEditorState } from '../grammar';
import { idOfMark } from './types';

export interface CommentRange {
  id: string;
  /** Offsets into the markdown body. */
  start: number;
  end: number;
}

/** Every comment's current range, read from the body's marks, sorted by start then end. */
export function commentRanges(doc: Automerge.Doc<TextEditorState>): CommentRange[] {
  if (typeof doc.body !== 'string' || !Automerge.isAutomerge(doc)) return [];
  const out: CommentRange[] = [];
  for (const m of Automerge.marks(doc, ['body'])) {
    const id = idOfMark(m.name);
    if (id !== null) out.push({ id, start: m.start, end: m.end });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

export interface Segment {
  start: number;
  end: number;
  /** Ids of every comment covering this piece, in range order. */
  ids: string[];
}

/** Non-overlapping pieces of the body covered by at least one comment. */
export function segments(ranges: CommentRange[]): Segment[] {
  const bounds = Array.from(new Set(ranges.flatMap(r => [r.start, r.end]))).sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const start = bounds[i];
    const end = bounds[i + 1];
    const ids = ranges.filter(r => r.start <= start && r.end >= end && r.start < r.end).map(r => r.id);
    if (ids.length > 0 && end > start) out.push({ start, end, ids });
  }
  return out;
}

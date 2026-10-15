import * as Automerge from '@automerge/automerge';
import { TextEditorState } from '../grammar';
import { commentRanges } from './ranges';
import { Comment, markName } from './types';

/** A comment as it travels in the JSON export; start/end are omitted for orphans. */
export interface ExportedComment extends Comment {
  start?: number;
  end?: number;
}

export function exportComments(doc: Automerge.Doc<TextEditorState>): ExportedComment[] {
  if (!doc.comments) return [];
  const ranges = new Map(commentRanges(doc).map(r => [r.id, r]));
  return Object.values(doc.comments).map(c => {
    const out: ExportedComment = { ...c, replies: c.replies.map(r => ({ ...r })) };
    const r = ranges.get(c.id);
    if (r) {
      out.start = r.start;
      out.end = r.end;
    }
    return out;
  });
}

/** A note's initial Automerge doc: the text plus imported comment records and marks. */
export function initialStateWithComments(text: string, comments: ExportedComment[] | undefined): Automerge.Doc<TextEditorState> {
  const doc = Automerge.from<TextEditorState>({ body: text });
  if (!comments || comments.length === 0) return doc;
  return Automerge.change(doc, s => {
    s.comments = {};
    for (const c of comments) {
      const { start, end, ...record } = c;
      s.comments[c.id] = { ...record, replies: record.replies.map(r => ({ ...r })) };
      if (start !== undefined && end !== undefined) {
        const from = Math.max(0, Math.min(start, text.length));
        const to = Math.max(from, Math.min(end, text.length));
        if (to > from) Automerge.mark(s, ['body'], { start: from, end: to, expand: 'none' }, markName(c.id), true);
      }
    }
  });
}

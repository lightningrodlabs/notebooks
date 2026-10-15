import * as Automerge from '@automerge/automerge';
import { TextEditorState } from '../grammar';
import { CommentRange, commentRanges } from './ranges';
import { Comment } from './types';
import { CommentFilter, matchesFilter } from './filters';

export interface FilterOptions {
  filter: CommentFilter;
  /** AgentPubKeyB64 of the viewer */
  me: string;
}

export interface CommentView extends Comment {
  /** Current range in the body, or null when the commented text was deleted. */
  range: CommentRange | null;
}

/** Comments in margin order: anchored ones by position, then orphans by creation time. */
export function commentsView(doc: Automerge.Doc<TextEditorState>, showResolved: boolean, filter?: FilterOptions): CommentView[] {
  const records = doc.comments ? Object.values(doc.comments) : [];
  const ranges = new Map(commentRanges(doc).map(r => [r.id, r]));
  const views: CommentView[] = records
    .filter(c => showResolved || !c.resolved)
    .filter(c => !filter || matchesFilter(c, filter.filter, filter.me))
    .map(c => ({ ...c, replies: [...c.replies], range: ranges.get(c.id) ?? null }));
  return views.sort((a, b) => {
    if (a.range && b.range) return a.range.start - b.range.start || a.range.end - b.range.end;
    if (a.range) return -1;
    if (b.range) return 1;
    return a.created - b.created;
  });
}

/** The ranges to paint: resolved comments only count while they are shown. */
export function visibleRanges(doc: Automerge.Doc<TextEditorState>, showResolved: boolean, filter?: FilterOptions): CommentRange[] {
  const records = doc.comments ?? {};
  return commentRanges(doc).filter(r => {
    const c = records[r.id];
    if (!c) return !filter; // a mark whose record has not synced yet
    if (!showResolved && c.resolved) return false;
    return !filter || matchesFilter(c, filter.filter, filter.me);
  });
}

/** The innermost (shortest) comment range containing `offset`, or null. */
export function commentAt(ranges: CommentRange[], offset: number): string | null {
  let best: CommentRange | null = null;
  for (const r of ranges) {
    if (r.start <= offset && offset < r.end && (!best || r.end - r.start < best.end - best.start)) best = r;
  }
  return best ? best.id : null;
}

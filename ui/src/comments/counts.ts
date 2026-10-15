import { Comment } from './types';

export interface CommentCounts {
  open: number;
  resolved: number;
}

export function countComments(comments: Record<string, Comment> | undefined): CommentCounts {
  let open = 0;
  let resolved = 0;
  for (const c of Object.values(comments ?? {})) {
    if (c.resolved) resolved += 1;
    else open += 1;
  }
  return { open, resolved };
}

/** Margin header text: both numbers once anything is resolved, so flipping the switch never changes it. */
export function headerLabel({ open, resolved }: CommentCounts): string {
  if (resolved === 0) return open === 1 ? '1 comment' : `${open} comments`;
  return `${open} open · ${resolved} resolved`;
}

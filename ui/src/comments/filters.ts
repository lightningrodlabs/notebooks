import { Comment } from './types';

/** all · assigned to me · mine (I wrote it, replied, or am mentioned) */
export type CommentFilter = 'all' | 'assigned' | 'mine';

export function matchesFilter(c: Comment, filter: CommentFilter, me: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'assigned') return c.assignee?.agent === me;
  return (
    c.author === me ||
    (c.mentions ?? []).includes(me) ||
    c.replies.some(r => r.author === me || (r.mentions ?? []).includes(me))
  );
}

import { CommentRange, segments } from './ranges';
import { Comment } from './types';

/**
 * Markdown with comments as CriticMarkup: `{==text==}{>>@author: comment<<}`.
 * Overlapping comments become adjacent pieces, each carrying every comment
 * that covers it; resolved comments are left out; comments whose text was
 * deleted are appended at the end as detached notes.
 */
export function toCriticMarkup(body: string, comments: Comment[], ranges: CommentRange[]): string {
  const byId = new Map(comments.map(c => [c.id, c]));
  const live = ranges.filter(r => byId.get(r.id) && !byId.get(r.id)!.resolved);
  let out = '';
  let pos = 0;
  for (const seg of segments(live)) {
    out += body.slice(pos, seg.start);
    out += `{==${body.slice(seg.start, seg.end)}==}`;
    for (const id of seg.ids) out += note(byId.get(id)!);
    pos = seg.end;
  }
  out += body.slice(pos);
  const anchored = new Set(ranges.map(r => r.id));
  const orphans = comments.filter(c => !c.resolved && !anchored.has(c.id));
  if (orphans.length > 0) {
    out += '\n\n' + orphans.map(c => note(c, ` (detached, was "${c.quote}")`)).join('\n');
  }
  return out;
}

function note(c: Comment, tag = ''): string {
  const replies = c.replies.map(r => ` // @${r.author}: ${r.text}`).join('');
  return `{>>@${c.author}${tag}: ${c.text}${replies}<<}`;
}

import { CommentRange, segments } from './ranges';
import { Comment } from './types';

function note(c: Comment, names: Map<string, string>, tag = ''): string {
  const name = (author: string) => names.get(author) ?? author;
  const replies = c.replies.map(r => ` // @${name(r.author)}: ${r.text}`).join('');
  return `{>>@${name(c.author)}${tag}: ${c.text}${replies}<<}`;
}

/**
 * Markdown with comments as CriticMarkup: `{==text==}{>>@author: comment<<}`.
 * Overlapping comments become adjacent pieces, each carrying every comment
 * that covers it; resolved comments are left out; comments whose text was
 * deleted are appended at the end as detached notes.
 */
export function toCriticMarkup(
  body: string,
  comments: Comment[],
  ranges: CommentRange[],
  /** Display name per author key; authors without one show their key. */
  names: Map<string, string> = new Map()
): string {
  const byId = new Map(comments.map(c => [c.id, c]));
  const live = ranges.filter(r => byId.get(r.id) && !byId.get(r.id)!.resolved);
  let out = '';
  let pos = 0;
  for (const seg of segments(live)) {
    out += body.slice(pos, seg.start);
    out += `{==${body.slice(seg.start, seg.end)}==}`;
    for (const id of seg.ids) out += note(byId.get(id)!, names);
    pos = seg.end;
  }
  out += body.slice(pos);
  const anchored = new Set(ranges.map(r => r.id));
  const orphans = comments.filter(c => !c.resolved && !anchored.has(c.id));
  if (orphans.length > 0) {
    out += '\n\n' + orphans.map(c => note(c, names, ` (detached, was "${c.quote}")`)).join('\n');
  }
  return out;
}

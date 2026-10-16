/** One place in a note's text where the query occurs. */
export interface SearchHit {
  /** Offset of the match in the note's markdown text. */
  offset: number;
  /** The line holding the match, trimmed to a window around it. */
  before: string;
  match: string;
  after: string;
}

const CONTEXT = 60;

/** The match at `i` with the part of its line around it. */
function snippet(text: string, i: number, length: number): SearchHit {
  const lineStart = text.lastIndexOf('\n', i - 1) + 1;
  const nl = text.indexOf('\n', i + length);
  const lineEnd = nl === -1 ? text.length : nl;
  const from = Math.max(lineStart, i - CONTEXT);
  const to = Math.min(lineEnd, i + length + CONTEXT);
  return {
    offset: i,
    before: (from > lineStart ? '…' : '') + text.slice(from, i).trimStart(),
    match: text.slice(i, i + length),
    after: text.slice(i + length, to).trimEnd() + (to < lineEnd ? '…' : ''),
  };
}

/**
 * Every case-insensitive occurrence of `query` in `text`, each with the line
 * it sits on as a snippet. Occurrences do not overlap. At most `limit` hits
 * are returned; `total` counts them all.
 */
export function findHits(text: string, query: string, limit = 50): { hits: SearchHit[]; total: number } {
  const q = query.toLowerCase();
  if (!q) return { hits: [], total: 0 };
  const lower = text.toLowerCase();
  const hits: SearchHit[] = [];
  let total = 0;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, i + q.length)) {
    total += 1;
    if (hits.length < limit) hits.push(snippet(text, i, q.length));
  }
  return { hits, total };
}

/**
 * The occurrence of `query` in `text` closest to `offset`, as [start, end), or
 * undefined when there is none. The text may have changed since the search
 * that produced `offset`, so the match is looked up again rather than trusted.
 */
export function nearestOccurrence(text: string, query: string, offset: number): [number, number] | undefined {
  const q = query.toLowerCase();
  if (!q) return undefined;
  const lower = text.toLowerCase();
  let best: number | undefined;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, i + 1)) {
    if (best === undefined || Math.abs(i - offset) < Math.abs(best - offset)) best = i;
    if (i > offset) break;
  }
  return best === undefined ? undefined : [best, best + q.length];
}

/** A search hit for an opened note to select: the query, and where it was found. */
export interface Reveal {
  query: string;
  offset: number;
  /** Move focus into the editor; false keeps it where it is (stepping through hits from the search box). */
  focus?: boolean;
}

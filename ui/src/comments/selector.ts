/**
 * Quote re-anchoring over a plain string, ported from the OWW workshop's
 * W3C TextQuote selector scorer. Used where offsets into the markdown do not
 * apply, such as the rendered preview.
 */
export interface Quote {
  exact: string;
  prefix: string;
  suffix: string;
  /** The offset where the quote was taken; only breaks ties. */
  start: number;
}

function commonPrefixLen(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

function commonSuffixLen(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
}

export function makeQuote(text: string, start: number, end: number, context = 32): Quote {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - context), start),
    suffix: text.slice(end, end + context),
    start,
  };
}

/**
 * Scores every occurrence of `exact` by how well its surroundings match
 * prefix/suffix; `start` only breaks ties between equally good matches.
 */
export function findQuote(text: string, q: Quote): { start: number; end: number } | null {
  if (!q.exact) return null;
  let best: { score: number; distance: number; start: number } | null = null;
  let idx = text.indexOf(q.exact);
  while (idx !== -1) {
    const before = text.slice(Math.max(0, idx - q.prefix.length), idx);
    const after = text.slice(idx + q.exact.length, idx + q.exact.length + q.suffix.length);
    const score = commonSuffixLen(before, q.prefix) + commonPrefixLen(after, q.suffix);
    const distance = Math.abs(idx - q.start);
    if (!best || score > best.score || (score === best.score && distance < best.distance)) {
      best = { score, distance, start: idx };
    }
    idx = text.indexOf(q.exact, idx + 1);
  }
  return best ? { start: best.start, end: best.start + q.exact.length } : null;
}

/** Best-effort removal of inline markdown syntax so a quote can be found in rendered text. */
export function stripInlineMarkdown(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/[*_`~]+/g, '');
}

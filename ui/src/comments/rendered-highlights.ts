import { CSSResult, css } from 'lit';
import { CommentView } from './model';
import { findQuote, makeQuote, stripInlineMarkdown } from './selector';

/**
 * Best-effort comment highlights over rendered markdown (where offsets into
 * the source no longer apply). Each anchored comment's quote, stripped of
 * inline syntax, is searched for in the container's text and painted with
 * the CSS Custom Highlight API, which handles overlaps without touching the
 * DOM. A quote that cannot be found exactly is simply not highlighted.
 *
 * All owners share one registry entry, so each keeps its own ranges here and
 * the union is re-registered on every paint.
 */
const HIGHLIGHT_NAME = 'nb-comment';
const rangesByOwner = new Map<object, Range[]>();

/** Include in the styles of any element whose shadow tree is painted. */
export const renderedHighlightStyles: CSSResult = css`
  ::highlight(nb-comment) {
    background-color: rgba(255, 213, 79, 0.45);
  }
`;

function registry(): any | null {
  const cssAny = (globalThis as any).CSS;
  return cssAny && cssAny.highlights ? cssAny.highlights : null;
}

function register() {
  const reg = registry();
  if (!reg) return;
  const all: Range[] = [];
  for (const ranges of rangesByOwner.values()) all.push(...ranges);
  if (all.length === 0) reg.delete(HIGHLIGHT_NAME);
  else reg.set(HIGHLIGHT_NAME, new (globalThis as any).Highlight(...all));
}

/** Map a [start, end) offset range over `container.textContent` to a DOM Range. */
function textRange(container: HTMLElement, start: number, end: number): Range | null {
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const range = container.ownerDocument.createRange();
  let pos = 0;
  let haveStart = false;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.data.length;
    if (!haveStart && start <= pos + len) {
      range.setStart(node, start - pos);
      haveStart = true;
    }
    if (haveStart && end <= pos + len) {
      range.setEnd(node, end - pos);
      return range;
    }
    pos += len;
    node = walker.nextNode() as Text | null;
  }
  return null;
}

export function paintRendered(owner: object, container: HTMLElement | null, body: string, comments: CommentView[]): void {
  if (!registry()) return;
  const ranges: Range[] = [];
  if (container) {
    const text = container.textContent ?? '';
    for (const c of comments.filter(x => x.range)) {
      const q = makeQuote(body, c.range!.start, c.range!.end);
      const stripped = {
        exact: stripInlineMarkdown(q.exact),
        prefix: stripInlineMarkdown(q.prefix),
        suffix: stripInlineMarkdown(q.suffix),
        start: q.start,
      };
      const hit = findQuote(text, stripped);
      const r = hit ? textRange(container, hit.start, hit.end) : null;
      if (r) ranges.push(r);
    }
  }
  rangesByOwner.set(owner, ranges);
  register();
}

export function clearRendered(owner: object): void {
  if (rangesByOwner.delete(owner)) register();
}

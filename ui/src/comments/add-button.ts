/** Height of the floating "+ Comment" button plus its gap from the text, px. */
const BUTTON_SPACE = 34;
const BUTTON_WIDTH = 36;

/**
 * Where to float the "+ Comment" button for a selection whose end character
 * occupies `end` (viewport coords) inside `container` (viewport rect, scrolled
 * by `scrollTop`/`scrollLeft`). Above the selection by default so it is never
 * clipped at the bottom of the editor; below it when the selection is on the
 * first line; never past the right edge.
 */
export function placeAddButton(
  end: { left: number; top: number; bottom: number },
  container: { left: number; top: number; width: number },
  scrollTop: number,
  scrollLeft: number
): { left: number; top: number } {
  const relTop = end.top - container.top;
  const top = relTop >= BUTTON_SPACE ? end.top - container.top - BUTTON_SPACE : end.bottom - container.top + 4;
  const left = Math.max(0, Math.min(end.left - container.left, container.width - BUTTON_WIDTH - 4));
  return { left: left + scrollLeft, top: top + scrollTop };
}

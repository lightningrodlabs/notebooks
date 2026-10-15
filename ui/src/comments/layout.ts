export interface CardInput {
  id: string;
  /** px, top of the highlighted text relative to the layout container */
  anchorTop: number;
  /** measured card height, px */
  height: number;
}

/**
 * Port of the OWW workshop `_fit()`: the active card (or the middle card when
 * none is active) stays at its anchor; every card above it is pushed UP and
 * every card below it is pushed DOWN, just far enough that neighbours keep
 * `gap` px between them. Tops may go negative; the container must not clip.
 */
export function fitCards(cards: CardInput[], activeId: string | null, gap = 30): Map<string, number> {
  const c = [...cards].sort((a, b) => a.anchorTop - b.anchorTop).map(x => ({ ...x, top: x.anchorTop }));
  if (c.length === 0) return new Map();
  let a = c.findIndex(x => x.id === activeId);
  if (a === -1) a = Math.floor(c.length / 2);
  for (let i = a - 1; i >= 0; i -= 1) {
    const maxTop = c[i + 1].top - gap - c[i].height;
    if (c[i].top > maxTop) c[i].top = maxTop;
  }
  for (let i = a + 1; i < c.length; i += 1) {
    const minTop = c[i - 1].top + c[i - 1].height + gap;
    if (c[i].top < minTop) c[i].top = minTop;
  }
  return new Map(c.map(x => [x.id, x.top]));
}

/** The note's markdown: an Automerge Text under `body` (empty for a missing state). */
export function textOf(state: { body?: string } | undefined): string {
  return typeof state?.body === 'string' ? state.body : '';
}

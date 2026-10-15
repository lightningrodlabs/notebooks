/**
 * The note's text lives in the Syn document either as `body` (an Automerge
 * Text, current) or as `text` (a list of single characters, legacy). Old
 * commits keep the legacy shape forever, so every reader goes through
 * `textOf`.
 */
export interface TextShapes {
  body?: string;
  text?: string[];
}

export function textOf(state: TextShapes | undefined): string {
  if (!state) return '';
  if (typeof state.body === 'string') return state.body;
  if (Array.isArray(state.text)) return state.text.join('');
  return '';
}

export function isMigrated(state: TextShapes): boolean {
  return typeof state.body === 'string';
}

/** Call inside an Automerge change: replaces the legacy list with a Text. */
export function migrateText(state: TextShapes): void {
  if (isMigrated(state)) return;
  state.body = Array.isArray(state.text) ? state.text.join('') : '';
  if ('text' in state) delete state.text;
}

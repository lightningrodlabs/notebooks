import * as Automerge from '@automerge/automerge';
import { isMigrated, migrateText, TextShapes } from './text';

/**
 * Legacy notes store their text as a list of characters; comments need an
 * Automerge Text. Two peers opening such a note at the same moment would each
 * create a *different* Text under `body` and Automerge would keep only one of
 * them, together with whatever had been typed into it. So the migration is
 * built as a deterministic change — fixed actor, fixed time, same base — and
 * identical changes from different peers have the same hash and merge into
 * one.
 */
const MIGRATION_ACTOR = 'cafe0000000000000000000000000001';

/** The migration as change bytes against `doc`'s current heads, or null when nothing to do. Leaves `doc` untouched. */
export function migrationChange(doc: Automerge.Doc<TextShapes>, free: (d: Automerge.Doc<unknown>) => void = () => {}): Uint8Array | null {
  if (isMigrated(doc)) return null;
  const base = Automerge.clone(doc, MIGRATION_ACTOR);
  const next = Automerge.change(base, { time: 0, message: 'migrate text to Text' }, s => migrateText(s));
  const bytes = Automerge.getLastLocalChange(next) ?? null;
  free(next);
  return bytes;
}

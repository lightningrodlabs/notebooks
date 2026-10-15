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
/**
 * The actor is derived from the base heads: identical bases give the identical
 * change (same hash, dedups), while divergent bases give different actors and
 * degrade to a plain last-writer-wins on `body` instead of Automerge's
 * "duplicate seq for actor" error, which would wedge sync for good.
 */
function migrationActor(doc: Automerge.Doc<unknown>): string {
  const bytes = new Uint8Array(16);
  for (const head of [...Automerge.getHeads(doc)].sort()) {
    for (let i = 0; i + 1 < head.length; i += 2) {
      // eslint-disable-next-line no-bitwise
      bytes[(i / 2) % 16] ^= parseInt(head.slice(i, i + 2), 16);
    }
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** The migration as change bytes against `doc`'s current heads, or null when nothing to do. Leaves `doc` untouched. */
export function migrationChange(doc: Automerge.Doc<TextShapes>, free: (d: Automerge.Doc<unknown>) => void = () => {}): Uint8Array | null {
  if (isMigrated(doc)) return null;
  const base = Automerge.clone(doc, migrationActor(doc));
  const next = Automerge.change(base, { time: 0, message: 'migrate text to Text' }, s => migrateText(s));
  const bytes = Automerge.getLastLocalChange(next) ?? null;
  free(next);
  return bytes;
}

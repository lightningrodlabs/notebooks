import { Dictionary, EntryHashB64 } from '@holochain-open-dev/core-types';
import { Note } from './types';

export function sortByDescendantTimestamp(
  notes: Dictionary<Note>
): Array<[EntryHashB64, Note]> {
  return Object.entries(notes).sort((a, b) => b[1].timestamp - a[1].timestamp);
}

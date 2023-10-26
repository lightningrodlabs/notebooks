import { EntryRecord } from "@holochain-open-dev/utils";
import { Commit } from "@holochain-syn/core";

export function sortByDescendantTimestamp(
  notes: EntryRecord<Commit>[]
): Array<EntryRecord<Commit>> {
  return notes.sort((a, b) => b.action.timestamp - a.action.timestamp);
}

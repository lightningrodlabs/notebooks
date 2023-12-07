import { EntryRecord } from "@holochain-open-dev/utils";
import { Document } from "@holochain-syn/core";

export function sortByDescendantTimestamp(
  notes: EntryRecord<Document>[]
): Array<EntryRecord<Document>> {
  return notes.sort((a, b) => b.action.timestamp - a.action.timestamp);
}

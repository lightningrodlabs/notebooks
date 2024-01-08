import { EntryRecord } from "@holochain-open-dev/utils";
import { Document } from "@holochain-syn/core";
import { Renderer } from "@ts-stack/markdown";

export function sortByDescendantTimestamp(
  notes: EntryRecord<Document>[]
): Array<EntryRecord<Document>> {
  return notes.sort((a, b) => b.action.timestamp - a.action.timestamp);
}
export class HilightRenderer extends Renderer {
  override link(href: string, title : string, text: string) {
    return `<a href="${href}"${title? ` title="${title}"`:""} target="_blank">${text}</a>`
  }
}
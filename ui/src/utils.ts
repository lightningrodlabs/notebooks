import { EntryRecord } from "@holochain-open-dev/utils";
import { Document } from "@holochain-syn/core";
import { Marked, Renderer } from "@ts-stack/markdown";
import hljs from 'highlight.js';

class HilightRenderer extends Renderer {
  override link(href: string, title : string, text: string) {
    return `<a href="${href}"${title? ` title="${title}"`:""} target="_blank">${text}</a>`
  }
}

Marked.setOptions
({
  renderer: new HilightRenderer,
  highlight: (code, lang) =>  {
    if (lang) {
      return hljs.highlight(lang, code).value
    }
    return code
  },
  gfm: true,
  tables: true,
  breaks: false,
  pedantic: false,
  sanitize: true,
  smartLists: true,
  smartypants: false
});

export function sortByDescendantTimestamp(
  notes: EntryRecord<Document>[]
): Array<EntryRecord<Document>> {
  return notes.sort((a, b) => b.action.timestamp - a.action.timestamp);
}

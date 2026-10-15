/** Someone who can be mentioned or assigned. */
export interface Person {
  /** AgentPubKeyB64 */
  key: string;
  name: string;
}

/** The `@word` the caret is in: where its `@` is and what follows it. Null when the caret is not in one. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null; // inside a word, e.g. an email address
  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, query };
}

/** Replace the `@query` from `start` to `caret` with `@name ` and return the new text and caret. */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const inserted = `@${name} `;
  return { text: text.slice(0, start) + inserted + text.slice(caret), caret: start + inserted.length };
}

/** The mentioned agents whose `@name` is still in the text, each once, in order. */
export function pruneMentions(text: string, mentions: string[], names: Map<string, string>): string[] {
  const out: string[] = [];
  for (const key of mentions) {
    const name = names.get(key);
    if (name && text.includes(`@${name}`) && !out.includes(key)) out.push(key);
  }
  return out;
}

/** People whose name contains the query (case-insensitive), names starting with it first. */
export function matchPeople(people: Person[], query: string, limit = 8, exclude?: string): Person[] {
  const q = query.toLowerCase();
  const hits = people.filter(p => p.key !== exclude && p.name.toLowerCase().includes(q));
  const starts = (p: Person) => (p.name.toLowerCase().startsWith(q) ? 0 : 1);
  return hits.sort((a, b) => starts(a) - starts(b) || a.name.localeCompare(b.name)).slice(0, limit);
}

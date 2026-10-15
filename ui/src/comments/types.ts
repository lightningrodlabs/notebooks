export interface Reply {
  id: string;
  /** AgentPubKeyB64 */
  author: string;
  /** ms since epoch */
  created: number;
  text: string;
}

export interface Comment {
  id: string;
  /** AgentPubKeyB64 */
  author: string;
  /** ms since epoch */
  created: number;
  text: string;
  /** The selected text at creation: shown for orphans, used to re-find the span in rendered views. */
  quote: string;
  resolved: boolean;
  replies: Reply[];
}

/** A comment's range is the Automerge mark `comment:<id>` on the body. */
export const MARK_PREFIX = 'comment:';
export const markName = (id: string) => `${MARK_PREFIX}${id}`;
export const idOfMark = (name: string): string | null =>
  name.startsWith(MARK_PREFIX) ? name.slice(MARK_PREFIX.length) : null;

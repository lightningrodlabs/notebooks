export interface Reply {
  id: string;
  /** AgentPubKeyB64 */
  author: string;
  /** ms since epoch */
  created: number;
  text: string;
  /** Agents mentioned in `text` (AgentPubKeyB64). */
  mentions?: string[];
}

export interface Assignment {
  /** AgentPubKeyB64 of the assignee */
  agent: string;
  /** AgentPubKeyB64 of whoever assigned it */
  by: string;
  /** ms since epoch */
  at: number;
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
  /** Agents mentioned in `text` (AgentPubKeyB64). */
  mentions?: string[];
  assignee?: Assignment;
}

/** A comment's range is the Automerge mark `comment:<id>` on the body. */
export const MARK_PREFIX = 'comment:';
export const markName = (id: string) => `${MARK_PREFIX}${id}`;
export const idOfMark = (name: string): string | null =>
  name.startsWith(MARK_PREFIX) ? name.slice(MARK_PREFIX.length) : null;

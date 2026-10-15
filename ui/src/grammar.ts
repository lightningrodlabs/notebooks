import { AgentPubKey, encodeHashToBase64 } from '@holochain/client';
import * as Automerge from '@automerge/automerge';
import { isMigrated, migrateText } from './text';
import { Comment, markName } from './comments/types';

/** A participant's selection: an Automerge cursor into `body` plus the selection length. */
export interface AgentSelection {
  cursor: Automerge.Cursor;
  characterCount: number;
}

export type TextEditorState = {
  /** The markdown, as an Automerge Text. */
  body?: string;
  /** Legacy list of characters; absent once a note is migrated. */
  text?: string[];
  /** Comment records keyed by id; each one's range is the mark `comment:<id>` on `body`. */
  comments?: Record<string, Comment>;
};

export interface AddCommentInput {
  id: string;
  from: number;
  to: number;
  text?: string;
  created?: number;
}
export interface AddReplyInput {
  id: string;
  text: string;
  created?: number;
}
export type TextEditorEphemeralState = { [agentB64: string]: AgentSelection };

const BODY = ['body'];

function ensureComments(state: TextEditorState): Record<string, Comment> {
  if (!state.comments) state.comments = {};
  return state.comments;
}

export const textEditorGrammar = {
  initialState(): TextEditorState {
    return { body: '' };
  },
  changes(myPubKey: AgentPubKey, state: TextEditorState, cursors: TextEditorEphemeralState) {
    const me = encodeHashToBase64(myPubKey);
    if (!isMigrated(state)) migrateText(state);
    const len = () => state.body!.length;
    const setCursor = (index: number, characterCount: number) => {
      cursors[me] = { cursor: Automerge.getCursor(state as any, BODY, index), characterCount };
    };

    return {
      insert(from: number, text: string) {
        const safeFrom = Math.max(0, Math.min(from, len()));
        Automerge.splice(state as any, BODY, safeFrom, 0, text);
        setCursor(safeFrom + text.length, 0);
      },
      delete(position: number, characterCount: number) {
        const safePosition = Math.max(0, Math.min(position, len()));
        const safeCount = Math.max(0, Math.min(characterCount, len() - safePosition));
        if (safeCount > 0) Automerge.splice(state as any, BODY, safePosition, safeCount);
        setCursor(safePosition, 0);
      },
      changeSelection(from: number, characterCount: number) {
        const safeFrom = Math.max(0, Math.min(from, len()));
        setCursor(safeFrom, characterCount);
      },

      addComment(input: AddCommentInput) {
        const comments = ensureComments(state);
        const from = Math.max(0, Math.min(input.from, len()));
        const to = Math.max(from, Math.min(input.to, len()));
        Automerge.mark(state as any, BODY, { start: from, end: to, expand: 'none' }, markName(input.id), true);
        comments[input.id] = {
          id: input.id,
          author: me,
          created: input.created ?? Date.now(),
          text: input.text ?? '',
          quote: state.body!.slice(from, to),
          resolved: false,
          replies: [],
        };
      },
      setCommentText(id: string, text: string) {
        const c = state.comments?.[id];
        if (c) c.text = text;
      },
      setResolved(id: string, resolved: boolean) {
        const c = state.comments?.[id];
        if (c) c.resolved = resolved;
      },
      deleteComment(id: string) {
        const name = markName(id);
        for (const m of Automerge.marks(state as any, BODY)) {
          if (m.name === name) {
            Automerge.unmark(state as any, BODY, { start: m.start, end: m.end, expand: 'none' }, name);
          }
        }
        if (state.comments && id in state.comments) delete state.comments[id];
      },
      addReply(id: string, reply: AddReplyInput) {
        const c = state.comments?.[id];
        if (c) c.replies.push({ id: reply.id, author: me, created: reply.created ?? Date.now(), text: reply.text });
      },
      setReplyText(id: string, replyId: string, text: string) {
        const r = state.comments?.[id]?.replies.find(x => x.id === replyId);
        if (r) r.text = text;
      },
      deleteReply(id: string, replyId: string) {
        const c = state.comments?.[id];
        if (!c) return;
        const i = c.replies.findIndex(x => x.id === replyId);
        if (i >= 0) c.replies.splice(i, 1);
      },
    };
  },
};

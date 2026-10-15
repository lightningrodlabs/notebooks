import { AgentPubKey, encodeHashToBase64 } from '@holochain/client';
import * as Automerge from '@automerge/automerge';
import { isMigrated, migrateText } from './text';

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
};
export type TextEditorEphemeralState = { [agentB64: string]: AgentSelection };

const BODY = ['body'];

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
    };
  },
};

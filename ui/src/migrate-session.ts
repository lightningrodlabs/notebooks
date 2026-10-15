import { get } from '@holochain-open-dev/stores';
import { freeDoc, SessionStore } from '@holochain-syn/core';
import { TextEditorEphemeralState, TextEditorState } from './grammar';
import { migrateText } from './text';
import { migrationChange } from './migrate';

/**
 * Migrate the session's document if it still holds the character list.
 * Returns true when a migration was applied.
 */
export function migrateSession(session: SessionStore<TextEditorState, TextEditorEphemeralState>): boolean {
  const doc = get(session.docState);
  const bytes = migrationChange(doc, freeDoc);
  if (!bytes) return false;
  // The session store applies change bytes through the same guarded path it
  // uses for peers' changes; it then syncs them out like any other change.
  const apply = (session as any).applyRemoteStateChanges;
  if (typeof apply === 'function') {
    apply.call(session, [bytes], undefined);
  } else {
    // Older syn without that path: a plain change (loses the determinism).
    session.change(s => migrateText(s));
  }
  return true;
}

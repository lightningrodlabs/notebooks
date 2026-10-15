import type { EntryHash } from '@holochain/client';
import type { WAL } from '@theweave/api';

/**
 * The app view for Moss's main view. Moss attaches a WAL when it opens the
 * tool for something specific, e.g. "Open in Notebooks" on a notification
 * about a note; that note is opened instead of the notes list.
 */
export function mainView(wal: WAL | undefined): { type: 'main' } | { type: 'note'; noteHash: EntryHash } {
  return wal ? { type: 'note', noteHash: wal.hrl[1] } : { type: 'main' };
}

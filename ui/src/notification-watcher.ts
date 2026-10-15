import { encodeHashToBase64, LazyHoloHashMap } from '@holochain/client';
import { AsyncReadable, pipe, joinAsync, sliceAndJoin, asyncDerived } from '@holochain-open-dev/stores';
import { GetonlyMap } from '@holochain-open-dev/utils';
import { SynStore, WorkspaceStore } from '@holochain-syn/core';
import { decode } from '@msgpack/msgpack';
import { TextEditorEphemeralState, TextEditorState } from './grammar';
import { NoteComments, PendingNotification, pendingNotifications } from './comments/notifications';

const SEEN_CAP = 2000;
const DEBOUNCE_MS = 1500;

/**
 * Watches every note's latest state for new mentions of this agent and new
 * assignments to it, and hands them to `deliver` once each. What has been
 * delivered is remembered per agent in localStorage. Nothing is marked seen
 * while there is no deliverer (outside Moss), so events wait until there is.
 *
 * The latest state of a note someone else is editing advances when their
 * session commits (every 30s or 200 edits), so that is the delay for a
 * mention made in a note this agent does not have open.
 */
export class NotificationWatcher {
  private unsubscribe: (() => void) | undefined;

  private timer: ReturnType<typeof setTimeout> | undefined;

  private latest: NoteComments[] = [];

  constructor(
    private synStore: SynStore,
    private me: string,
    private deliver: () => ((items: PendingNotification[]) => Promise<void> | void) | undefined
  ) {}

  private seenKey() {
    return `nb-notified:${this.me}`;
  }

  private loadSeen(): Set<string> {
    try {
      return new Set(JSON.parse(localStorage.getItem(this.seenKey()) ?? '[]'));
    } catch (e) {
      return new Set();
    }
  }

  private saveSeen(seen: Set<string>) {
    try {
      localStorage.setItem(this.seenKey(), JSON.stringify([...seen].slice(-SEEN_CAP)));
    } catch (e) {
      // storage unavailable: events may be reported again next session
    }
  }

  start() {
    const noteData = new LazyHoloHashMap((documentHash: Uint8Array) => {
      const docStore = this.synStore.documents.get(documentHash)!;
      const workspace = pipe(
        docStore.allWorkspaces,
        ws => Array.from(ws.values() as IterableIterator<WorkspaceStore<TextEditorState, TextEditorEphemeralState> | undefined>)[0]
      );
      const latestState = pipe(workspace, w => w!.latestState);
      return pipe(joinAsync([latestState, docStore.record]), ([state, record]) => ({
        noteHash: encodeHashToBase64(documentHash),
        title: record?.entry?.meta ? ((decode(record.entry.meta) as { title?: string }) ?? {}).title ?? '' : '',
        comments: Object.values(state?.comments ?? {}),
      }) as NoteComments);
    });
    const hashes = asyncDerived(this.synStore.documentsByTag.get('note'), m => Array.from(m.keys() as IterableIterator<Uint8Array>));
    const all = pipe(hashes, hs =>
      sliceAndJoin(noteData as unknown as GetonlyMap<Uint8Array, AsyncReadable<NoteComments>>, hs, { errors: 'filter_out' })
    );
    this.unsubscribe = all.subscribe(status => {
      if (status.status !== 'complete') return;
      this.latest = Array.from(status.value.values()) as NoteComments[];
      this.schedule();
    });
  }

  /** Re-check now, e.g. after a deliverer became available. */
  schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.check(), DEBOUNCE_MS);
  }

  private async check() {
    const deliver = this.deliver();
    if (!deliver) return;
    const seen = this.loadSeen();
    const pending = pendingNotifications(this.latest, this.me, seen);
    if (pending.length === 0) return;
    for (const p of pending) seen.add(p.key);
    this.saveSeen(seen);
    try {
      await deliver(pending);
    } catch (e) {
      console.error('notebooks: could not deliver notifications', e);
    }
  }

  stop() {
    this.unsubscribe?.();
    if (this.timer) clearTimeout(this.timer);
  }
}

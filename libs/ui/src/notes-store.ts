import { CellClient, HolochainClient } from '@holochain-open-dev/cell-client';
import {
  AgentPubKeyB64,
  Dictionary,
  DnaHashB64,
  EntryHashB64,
} from '@holochain-open-dev/core-types';
import { serializeHash, deserializeHash } from '@holochain-open-dev/utils';
import { derived, get, Writable, writable } from 'svelte/store';
import pickBy from 'lodash-es/pickBy';
import isEqual from 'lodash-es/isEqual';
import { SynClient, SynStore } from '@holochain-syn/core';
import {
  AdminWebsocket,
  DnaHash,
  InstalledCell,
} from '@holochain/client';
import { textEditorGrammar } from '@holochain-syn/text-editor';

import { NotesService } from './notes-service';
import { NoteWithBacklinks } from './types';

export class NotesStore {
  service: NotesService;

  #notesByEntryHash: Writable<Dictionary<NoteWithBacklinks>> = writable({});

  #openedNotes: Writable<Dictionary<SynStore>> = writable({});

  notesCreatedByMe = derived(this.#notesByEntryHash, notes =>
    pickBy(notes, value => value.creator === this.myAgentPubKey)
  );

  notesCreatedByOthers = derived(this.#notesByEntryHash, notes =>
    pickBy(notes, value => value.creator !== this.myAgentPubKey)
  );

  note(noteHash: EntryHashB64) {
    return derived(this.#notesByEntryHash, notes => notes[noteHash]);
  }

  noteSynStore(noteHash: EntryHashB64) {
    return derived(this.#openedNotes, notes => notes[noteHash]);
  }

  get myAgentPubKey(): AgentPubKeyB64 {
    return serializeHash(this.notesCell.cell_id[1]);
  }

  constructor(
    protected client: HolochainClient,
    protected adminWebsocket: AdminWebsocket,
    protected notesCell: InstalledCell,
    protected synDnaHash: DnaHash, // This is a template DNA so we don't have a cell on app init
    zomeName: string = 'notes'
  ) {
    this.service = new NotesService(
      new CellClient(client, notesCell),
      zomeName
    );
  }

  async fetchAllNotes() {
    const fetchedNotes = await this.service.getAllNotes();

    this.#notesByEntryHash.update(notes => ({
      ...notes,
      ...fetchedNotes,
    }));
  }

  async createNote(title: string) {
    const creator = this.myAgentPubKey;
    const timestamp = Date.now() * 1000;

    const cell = await this.cloneNoteDna(creator, timestamp);
    const synDnaHash = serializeHash(cell.cell_id[0]);

    const entryHash = await this.service.createNote({
      title,
      synDnaHash,
      timestamp,
    });

    this.#notesByEntryHash.update(notes => {
      notes[entryHash] = {
        title,
        synDnaHash,
        timestamp,
        creator,
        backlinks: { linksTo: {}, linkedFrom: {} },
      };
      return notes;
    });

    const synStore = await this.openNote(entryHash);

    const rootStore = await synStore.createRoot(textEditorGrammar);
    await rootStore.createWorkspace('main', rootStore.root.entryHash);
  }

  async openNote(noteHash: EntryHashB64): Promise<SynStore> {
    let note = get(this.#notesByEntryHash)[noteHash];

    if (!note) {
      await this.fetchAllNotes();
      note = get(this.#notesByEntryHash)[noteHash];
    }

    const { creator, timestamp, synDnaHash } = note;

    let noteCell = await this.getNoteCell(synDnaHash);

    if (!noteCell) {
      noteCell = await this.cloneNoteDna(creator, timestamp);
      if (serializeHash(noteCell.cell_id[0]) !== note.synDnaHash) {
        throw new Error(
          "Installed Dna hash doesn't actually match the expected one"
        );
      }
    }

    const cellClient = new CellClient(this.client, noteCell);

    const store: SynStore = new SynStore(new SynClient(cellClient));

    this.#openedNotes.update(n => {
      n[noteHash] = store;
      return n;
    });

    return store;
  }

  private async getNoteCell(
    synDnaHashB64: DnaHashB64
  ): Promise<InstalledCell | undefined> {
    const synDnaHash = deserializeHash(synDnaHashB64);
    const appInfo = await this.client.appWebsocket.appInfo({
      installed_app_id: 'notebooks',
    });
    const cell = appInfo.cell_data.find(c => isEqual(c.cell_id[0], synDnaHash));
    return cell;
  }

  private async cloneNoteDna(
    creator: AgentPubKeyB64,
    timestamp: number
  ): Promise<InstalledCell> {
    const newCell = await this.client.appWebsocket.createCloneCell({
      app_id: 'notebooks',
      modifiers: {
        network_seed: `notebooks-${creator}-${timestamp}`,
      },
      role_id: 'syn',
    });

    return newCell;
  }
}

import { CellClient } from '@holochain-open-dev/cell-client';
import {
  AgentPubKeyB64,
  Dictionary,
  serializeHash,
} from '@holochain-open-dev/core-types';
import { derived, Writable, writable } from 'svelte/store';
import { pickBy } from 'lodash-es';

import { NotesService } from './notes-service';
import { Note } from './types';

export class NotesStore {
  service: NotesService;

  #notesByEntryHash: Writable<Dictionary<Note>> = writable({});

  notesCreatedByMe = derived(this.#notesByEntryHash, notes =>
    pickBy(notes, (value, key) => value.creator === this.myAgentPubKey)
  );

  notesCreatedByOthers = derived(this.#notesByEntryHash, notes =>
    pickBy(notes, (value, key) => value.creator !== this.myAgentPubKey)
  );

  get myAgentPubKey(): AgentPubKeyB64 {
    return serializeHash(this.cellClient.cellId[1]);
  }

  constructor(protected cellClient: CellClient, zomeName: string = 'notes') {
    this.service = new NotesService(cellClient, zomeName);
  }

  async fetchAllNotes() {
    const fetchedNotes = await this.service.getAllNotes();

    this.#notesByEntryHash.update(notes => ({
      ...notes,
      ...fetchedNotes,
    }));
  }

  async createNote(title: string) {
    await this.service.createNote({
      title,
      syn_dna_hash: '',
    });

    await this.fetchAllNotes();
  }
}

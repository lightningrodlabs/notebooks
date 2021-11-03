import { CellClient } from '@holochain-open-dev/cell-client';
import { Dictionary } from '@holochain-open-dev/core-types';
import { Writable, writable } from 'svelte/store';
import { NotesService } from './notes-service';
import { Note } from './types';

export class NotesStore {
  service: NotesService;

  #notesByEntryHash: Writable<Dictionary<Note>> = writable({});

  constructor(cellClient: CellClient, zomeName: string = 'notes') {
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

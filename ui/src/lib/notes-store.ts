import {
  BaseClient,
  CellClient,
  HolochainClient,
} from '@holochain-open-dev/cell-client';
import {
  AgentPubKeyB64,
  deserializeHash,
  Dictionary,
  DnaHashB64,
  EntryHashB64,
  serializeHash,
} from '@holochain-open-dev/core-types';
import { derived, get, Writable, writable } from 'svelte/store';
import pickBy from 'lodash-es/pickBy';
import { SynStore } from '@holochain-syn/store';
import {
  AdminWebsocket,
  AppWebsocket,
  InstalledAppInfo,
  InstalledCell,
} from '@holochain/client';
import {
  textEditorGrammar,
  TextEditorGrammar,
} from '@holochain-syn/text-editor';

import { NotesService } from './notes-service';
import { Note } from './types';

export type NoteSynStore = SynStore<TextEditorGrammar>;

export class NotesStore {
  service: NotesService;

  #notesByEntryHash: Writable<Dictionary<Note>> = writable({});

  #openedNotes: Writable<Dictionary<NoteSynStore>> = writable({});

  notesCreatedByMe = derived(this.#notesByEntryHash, notes =>
    pickBy(notes, (value, key) => value.creator === this.myAgentPubKey)
  );

  notesCreatedByOthers = derived(this.#notesByEntryHash, notes =>
    pickBy(notes, (value, key) => value.creator !== this.myAgentPubKey)
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
    protected client: BaseClient,
    protected notesCell: InstalledCell,
    protected adminWebsocket: AdminWebsocket,
    zomeName: string = 'notes'
  ) {
    this.service = new NotesService(client.forCell(notesCell), zomeName);
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

    const synDnaHash = await this.installNoteDna(creator, timestamp);

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
      };
      return notes;
    });
  }

  async openNote(noteHash: EntryHashB64): Promise<NoteSynStore> {
    let note = get(this.#notesByEntryHash)[noteHash];

    if (!note) {
      await this.fetchAllNotes();
      note = get(this.#notesByEntryHash)[noteHash];
    }

    const creator = note.creator;
    const timestamp = note.timestamp;

    if (!(await this.isNoteDnaInstalled(creator, timestamp))) {
      const resultingDnaHash = await this.installNoteDna(creator, timestamp);
      if (resultingDnaHash !== note.synDnaHash) {
        throw new Error(
          "Installed Dna hash doesn't actually match the expected one"
        );
      }
    }

    const cellData: InstalledCell = {
      role_id: `syn-${creator}-${timestamp}`,
      cell_id: [
        deserializeHash(note.synDnaHash) as Buffer,
        deserializeHash(this.myAgentPubKey) as Buffer,
      ],
    };
    const cellClient = this.client.forCell(cellData);

    const store: SynStore<TextEditorGrammar> = new SynStore(
      cellClient,
      textEditorGrammar
    );

    this.#openedNotes.update(n => {
      n[noteHash] = store;
      return n;
    });

    return store;
  }

  private async isNoteDnaInstalled(creator: AgentPubKeyB64, timestamp: number) {
    const appId = `syn-${creator}-${timestamp}`;
    const activeApps = await this.adminWebsocket.listActiveApps();

    return !!activeApps.find(app => app === appId);
  }

  private async installNoteDna(
    creator: AgentPubKeyB64,
    timestamp: number
  ): Promise<DnaHashB64> {
    const appInfo = await (
      (this.client as any).appWebsocket as AppWebsocket
    ).appInfo({
      installed_app_id: 'notebooks',
    });

    const installedCells = appInfo.cell_data;
    const cell = installedCells.find(c => c.role_id === 'syn') as InstalledCell;
    const myAgentPubKey = serializeHash(installedCells[0].cell_id[1]);
    const synDnaHash = serializeHash(cell.cell_id[0]);

    const newWeHash = await this.adminWebsocket.registerDna({
      hash: deserializeHash(synDnaHash) as Buffer,
      uid: '',
      properties: { creator, timestamp },
    });

    const installed_app_id = `syn-${creator}-${timestamp}`;
    const newAppInfo: InstalledAppInfo = await this.adminWebsocket.installApp({
      installed_app_id,
      agent_key: deserializeHash(myAgentPubKey) as Buffer,
      dnas: [
        {
          hash: newWeHash,
          role_id: installed_app_id,
        },
      ],
    });
    const enabledResult = await this.adminWebsocket.enableApp({
      installed_app_id,
    });

    return serializeHash(newAppInfo.cell_data[0].cell_id[0]);
  }
}

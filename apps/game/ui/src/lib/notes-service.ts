import { CellClient } from '@holochain-open-dev/cell-client';
import { Dictionary, EntryHashB64 } from '@holochain-open-dev/core-types';
import { Note, CreateNoteInput } from './types';

export class NotesService {
  constructor(public cellClient: CellClient, public zomeName = 'notes') {}

  async createNote(input: CreateNoteInput): Promise<EntryHashB64> {
    return this.callZome('create_new_note', input);
  }

  async getAllNotes(): Promise<Dictionary<Note>> {
    return this.callZome('get_all_notes', null);
  }

  private callZome(fn_name: string, payload: any) {
    return this.cellClient.callZome(this.zomeName, fn_name, payload);
  }
}

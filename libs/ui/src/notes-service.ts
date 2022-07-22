import { CellClient } from '@holochain-open-dev/cell-client';
import { Dictionary, EntryHashB64 } from '@holochain-open-dev/core-types';
import { CreateNoteInput, NoteContentsInput, UpdateNoteBacklinksInput, NoteWithBacklinks } from './types';

export class NotesService {
  constructor(public cellClient: CellClient, public zomeName = 'notes') {}

  async createNote(input: CreateNoteInput): Promise<EntryHashB64> {
    return this.callZome('create_new_note', input);
  }

  async getAllNotes(): Promise<Dictionary<NoteWithBacklinks>> {
    return this.callZome('get_all_notes', null);
  }

  async parseAndUpdateNoteLinks(input: NoteContentsInput): Promise<string[]> {
    return this.callZome('parse_note_for_links_and_update_backlinks', input);
  }

  async updateNoteLinks(input: UpdateNoteBacklinksInput): Promise<null> {
    return this.callZome('update_note_backlinks', input);
  }

  private callZome(fnName: string, payload: any) {
    return this.cellClient.callZome(this.zomeName, fnName, payload);
  }
}

import { AgentPubKeyB64, Dictionary, DnaHashB64, EntryHashB64 } from '@holochain-open-dev/core-types';

interface NoteBacklinks {
  linksTo: Dictionary<EntryHashB64>;
  linkedFrom: Dictionary<EntryHashB64>;
}
export interface Note {
  title: string;
  creator: AgentPubKeyB64;
  timestamp: number;
  synDnaHash: DnaHashB64;
  // backlinks?: NoteBacklinks;
}

export type NoteWithBacklinks = Note & {
  backlinks: NoteBacklinks;
}


export interface CreateNoteInput {
  timestamp: number;
  title: string;
  synDnaHash: DnaHashB64;
}

export interface NoteContentsInput {
  note: EntryHashB64;
  contents: string;
}

export interface UpdateNoteBacklinksInput {
  note: EntryHashB64;
  linkTitles: string[];
}

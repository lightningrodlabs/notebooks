import { AgentPubKeyB64, DnaHashB64 } from '@holochain-open-dev/core-types';

export interface Note {
  title: string;
  creator: AgentPubKeyB64;
  timestamp: number;
  synDnaHash: DnaHashB64;
}

export interface CreateNoteInput {
  timestamp: number;
  title: string;
  synDnaHash: DnaHashB64;
}

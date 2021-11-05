import { AgentPubKeyB64, DnaHashB64 } from '@holochain-open-dev/core-types';

export interface Note {
  title: string;
  creator: AgentPubKeyB64;
  timestamp: number;
  syn_dna_hash: DnaHashB64;
}

export interface CreateNoteInput {
  timestamp: number;
  title: string;
  syn_dna_hash: DnaHashB64;
}

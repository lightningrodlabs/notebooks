use std::collections::BTreeMap;

use hdi::prelude::holo_hash::*;
use hdi::prelude::*;

#[hdk_entry_helper]
#[serde(rename_all = "camelCase")]
#[derive(Clone)]
pub struct Note {
    pub title: String,

    // With the creator and timestamp as properties,
    // anyone can recreate the Note Dna
    pub creator: AgentPubKeyB64,
    pub timestamp: Timestamp,

    // Resulting Dna hash to check that we are accessing the right thing
    pub syn_dna_hash: DnaHashB64,
}

#[hdk_entry_defs]
#[unit_enum(UnitEntryTypes)]
pub enum EntryTypes {
    #[entry_def(name="post")]
    Note(Note)
}

#[hdk_link_types]
pub enum LinkTypes {
    PathToNote,
    NoteToBacklinks
}

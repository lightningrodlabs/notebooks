use std::collections::BTreeMap;

use hdk::prelude::holo_hash::*;
use hdk::prelude::*;

#[hdk_entry(id = "note")]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub title: String,

    // With the creator and timestamp as properties,
    // anyone can recreate the Note Dna
    pub creator: AgentPubKeyB64,
    pub timestamp: Timestamp,

    // Resulting Dna hash to check that we are accessing the right thing
    pub syn_dna_hash: DnaHashB64,
}

entry_defs![Note::entry_def(), PathEntry::entry_def()];

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteInput {
    pub title: String,
    pub timestamp: Timestamp,
    pub syn_dna_hash: DnaHashB64,
}

#[hdk_extern]
pub fn create_new_note(input: CreateNoteInput) -> ExternResult<EntryHashB64> {
    let creator = agent_info()?.agent_latest_pubkey;

    let note = Note {
        creator: creator.into(),
        timestamp: input.timestamp,
        syn_dna_hash: input.syn_dna_hash,
        title: input.title,
    };

    create_entry(&note)?;
    let hash = hash_entry(&note)?;

    let path = all_notes_path();
    path.ensure()?;

    create_link(
        path.path_entry_hash()?.into(),
        hash.clone().into(),
        HdkLinkType::Any,
        (),
    )?;

    Ok(EntryHashB64::from(hash))
}

#[hdk_extern]
pub fn get_all_notes(_: ()) -> ExternResult<BTreeMap<EntryHashB64, Note>> {
    let path = all_notes_path();

    let links = get_links(path.path_entry_hash()?.into(), None)?;

    let get_inputs = links
        .into_iter()
        .map(|link| GetInput::new(link.target.into(), GetOptions::default()))
        .collect();

    let notes_elements = HDK.with(|hdk| hdk.borrow().get(get_inputs))?;

    let notes: Vec<(EntryHashB64, Note)> = notes_elements
        .into_iter()
        .filter_map(|e| e)
        .map(|element| {
            let entry_hash = element
                .header()
                .entry_hash()
                .ok_or(WasmError::Guest("Malformed note element".into()))?;

            let note: Note = element
                .entry()
                .to_app_option()?
                .ok_or(WasmError::Guest(String::from("Malformed note")))?;

            Ok((EntryHashB64::from(entry_hash.clone()), note))
        })
        .collect::<ExternResult<Vec<(EntryHashB64, Note)>>>()?;

    let notes_map: BTreeMap<EntryHashB64, Note> = notes.into_iter().collect();

    Ok(notes_map)
}

fn all_notes_path() -> Path {
    Path::from("all_notes")
}

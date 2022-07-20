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
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NoteBacklinks {
    pub links_to: BTreeMap<String, EntryHashB64>,
    pub linked_from: BTreeMap<String, EntryHashB64>,
}
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNoteBacklinksInput {
    pub note: EntryHashB64,
    pub link_titles: Vec<String>,
}

#[hdk_extern]
pub fn create_new_note(input: CreateNoteInput) -> ExternResult<EntryHashB64> {
    let creator = agent_info()?.agent_latest_pubkey;

    // TODO: check if any other note links to this one, if it does, add it to backlink
    // for now assume cannot start with backlinks
    let note = Note {
        creator: creator.into(),
        timestamp: input.timestamp,
        syn_dna_hash: input.syn_dna_hash,
        title: input.title.clone(),
    };

    create_entry(&note)?;
    let hash = hash_entry(&note)?;

    let path = all_notes_path();
    path.ensure()?;

    create_link(
        path.path_entry_hash()?,
        hash.clone(),
        HdkLinkType::Any,
        (),
    )?;
    create_link(
        title_path(input.title).path_entry_hash()?,
        hash.clone(),
        HdkLinkType::Any,
        (),
    )?;

    Ok(EntryHashB64::from(hash))
}

#[hdk_extern]
pub fn get_all_notes(_: ()) -> ExternResult<BTreeMap<EntryHashB64, Note>> {
    let path = all_notes_path();

    let links = get_links(path.path_entry_hash()?, None)?;

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


#[hdk_extern]
pub fn update_note_backlinks(input: UpdateNoteBacklinksInput) -> ExternResult<()> {
    // - figures out which links to delete, and which links to add  
    // - gets all links of type `linksTo`, maps over all then, checking if the tag name matches the link names, if it doesn't delete (delete backlink as well)  
    // - for each title in link_titles, check if matches a tag name, if not, create a new link
    // - return the notes backlinks?
    let links = get_links(EntryHash::from(input.note.clone()), None)?;
    // find overlaps
    for title in input.link_titles {
        match links.iter().find(|link| link.clone().tag.eq(&links_to_tag(title.clone()))) {
            // link exists
            Some(_) => (),
            // link doesn't exist, so create it
            None => add_backlink(input.note.clone().into(), title)?,
        }
    }
    Ok(())
}
fn all_notes_path() -> Path {
    Path::from("all_notes")
}

fn title_path(title: String) -> Path {
    Path::from(title)
}

fn links_to_tag(title: String) -> LinkTag {
    LinkTag::new(String::from(format!("links_to_{}", title)))
}
fn linked_from_tag(title: String) -> LinkTag {
    LinkTag::new(String::from(format!("linked_from_{}", title)))
}

fn add_backlink(base_note: EntryHash, target_note_title: String) -> ExternResult<()> {
    // get note by title
    match get_note_by_title(target_note_title.clone())? {
        Some(target_note) => {
            let target_note_hash = hash_entry(target_note)?;
            create_link(
                base_note.clone(),
                target_note_hash.clone(),
                HdkLinkType::Any,
                links_to_tag(target_note_title),
            )?;
            create_link(
                target_note_hash,
                base_note.clone(),
                HdkLinkType::Any,
                linked_from_tag(get_note(base_note)?.title),
            )?;
            ()
        },
        // note doesn't exist
        None => (),
    };
    Ok(())
}

#[hdk_extern]
pub fn get_note_by_title(title: String) -> ExternResult<Option<Note>> {
    let mut links = get_links(
        title_path(title).path_entry_hash()?,
        None,
    )?;
    match links.pop() {
        Some(link) => { 
            match get::<EntryHash>(link.target.into(), GetOptions::default())? {
                Some(element) => { 
                    let note: Note = element.entry().to_app_option()?.ok_or(WasmError::Guest(String::from("Malformed note")))?;
                    Ok(Some(note))
                },
                None => Ok(None),
            }
        },
        None => Ok(None),
    }
}

fn get_note(entry_hash: EntryHash) -> ExternResult<Note> {
    match get(entry_hash, GetOptions::default())? {
        Some(element) => {
            let note: Note = element.entry().to_app_option()?.ok_or(WasmError::Guest(String::from("malformed note")))?;
            Ok(note)
        },
        None => Err(WasmError::Guest(String::from("unable to resolve note from entry hash"))),
    }
}

// pub fn get_note_links(note_hash: EntryHashB64) -> ExternResult<BTreeMap<String, EntryHashB64>> {
#[hdk_extern]
pub fn get_note_links(note_hash: EntryHashB64) -> ExternResult<Vec<Link>> {
    get_links::<EntryHash>(
        note_hash.into(),
        None,
    )
}
use std::collections::BTreeMap;

use hdk::prelude::holo_hash::*;
use hdk::prelude::*;
use regex::Regex;

#[hdk_entry(id = "note")]
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
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NoteWithBacklinks {
    pub title: String,
    pub creator: AgentPubKeyB64,
    pub timestamp: Timestamp,
    pub syn_dna_hash: DnaHashB64,
    pub backlinks: NoteBacklinks,
}
impl NoteWithBacklinks {
    fn from_note(note: Note) -> ExternResult<Self> {
        let note_hash: EntryHashB64 = hash_entry(note.clone())?.into();
        Ok(Self {
            title: note.title,
            creator: note.creator,
            timestamp: note.timestamp,
            syn_dna_hash: note.syn_dna_hash,
            backlinks: get_note_links(note_hash)?,
        })
    }
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
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NoteContentsInput {
    pub note: EntryHashB64,
    pub contents: String,
}

#[derive(Clone)]
pub enum NoteLink {
    LinksTo(String),
    LinkedFrom(String),
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

    create_link(path.path_entry_hash()?, hash.clone(), HdkLinkType::Any, ())?;
    create_link(
        title_path(input.title).path_entry_hash()?,
        hash.clone(),
        HdkLinkType::Any,
        (),
    )?;

    Ok(EntryHashB64::from(hash))
}

#[hdk_extern]
pub fn get_all_notes(_: ()) -> ExternResult<BTreeMap<EntryHashB64, NoteWithBacklinks>> {
    let path = all_notes_path();

    let links = get_links(path.path_entry_hash()?, None)?;

    let get_inputs = links
        .into_iter()
        .map(|link| GetInput::new(link.target.into(), GetOptions::default()))
        .collect();

    let notes_elements = HDK.with(|hdk| hdk.borrow().get(get_inputs))?;

    let notes: Vec<(EntryHashB64, NoteWithBacklinks)> = notes_elements
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

            Ok((
                EntryHashB64::from(entry_hash.clone()),
                NoteWithBacklinks::from_note(note)?,
            ))
        })
        .collect::<ExternResult<Vec<(EntryHashB64, NoteWithBacklinks)>>>()?;

    let notes_map: BTreeMap<EntryHashB64, NoteWithBacklinks> = notes.into_iter().collect();

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
        match links
            .iter()
            .find(|link| link.clone().tag.eq(&links_to_tag(title.clone())))
        {
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
        }
        // note doesn't exist
        None => (),
    };
    Ok(())
}

#[hdk_extern]
pub fn get_note_by_title(title: String) -> ExternResult<Option<Note>> {
    let mut links = get_links(title_path(title).path_entry_hash()?, None)?;
    match links.pop() {
        Some(link) => match get::<EntryHash>(link.target.into(), GetOptions::default())? {
            Some(element) => {
                let note: Note = element
                    .entry()
                    .to_app_option()?
                    .ok_or(WasmError::Guest(String::from("Malformed note")))?;
                Ok(Some(note))
            }
            None => Ok(None),
        },
        None => Ok(None),
    }
}

fn get_note(entry_hash: EntryHash) -> ExternResult<Note> {
    match get(entry_hash, GetOptions::default())? {
        Some(element) => {
            let note: Note = element
                .entry()
                .to_app_option()?
                .ok_or(WasmError::Guest(String::from("malformed note")))?;
            Ok(note)
        }
        None => Err(WasmError::Guest(String::from(
            "unable to resolve note from entry hash",
        ))),
    }
}

#[hdk_extern]
pub fn get_note_links(note_hash: EntryHashB64) -> ExternResult<NoteBacklinks> {
    let links = get_links::<EntryHash>(note_hash.into(), None)?;
    let mut links_to: BTreeMap<String, EntryHashB64> = BTreeMap::new();
    let mut linked_from: BTreeMap<String, EntryHashB64> = BTreeMap::new();
    let _links_tuple: Vec<(String, EntryHashB64)> = links
        .iter()
        .map(|link| {
            let maybe_title = title_from_tag(link.tag.clone())?;
            let entry_hash: EntryHash = link.target.clone().into();
            Ok((entry_hash.into(), maybe_title))
        })
        .collect::<ExternResult<Vec<(EntryHashB64, Option<NoteLink>)>>>()?
        .iter()
        .filter_map(|target_title_pair| {
            if let Some(title) = target_title_pair.1.clone() {
                match title {
                    NoteLink::LinksTo(title_string) => {
                        links_to.insert(title_string.clone(), target_title_pair.0.clone());
                        Some((title_string, target_title_pair.0.clone()))
                    }
                    NoteLink::LinkedFrom(title_string) => {
                        linked_from.insert(title_string.clone(), target_title_pair.0.clone());
                        Some((title_string, target_title_pair.0.clone()))
                    }
                }
            } else {
                None
            }
        })
        .collect();
    Ok(NoteBacklinks {
        links_to,
        linked_from,
    })
}

fn title_from_tag(link_tag: LinkTag) -> ExternResult<Option<NoteLink>> {
    let links_to_regex = Regex::new(r"links_to_(.*)$")
        .map_err(|_e| WasmError::Guest(String::from("error defining regex")))?;
    let linked_from_regex = Regex::new(r"linked_from_(.*)$")
        .map_err(|_e| WasmError::Guest(String::from("error defining regex")))?;
    let tag_string = String::from_utf8(link_tag.into_inner())
        .map_err(|_e| WasmError::Guest(String::from("could not convert link tag to string")))?;
    if let Some(captures) = links_to_regex.captures(&*tag_string) {
        Ok(captures
            .get(1)
            .map(|mat| mat.as_str())
            .map(|title| NoteLink::LinksTo(String::from(title))))
    } else if let Some(captures) = linked_from_regex.captures(&*tag_string) {
        Ok(captures
            .get(1)
            .map(|mat| mat.as_str())
            .map(|title| NoteLink::LinkedFrom(String::from(title))))
    } else {
        return Ok(None);
    }
}

#[hdk_extern]
pub fn parse_note_for_links_and_update_backlinks(
    NoteContentsInput { note, contents }: NoteContentsInput,
) -> ExternResult<Vec<String>> {
    let inline_links = Regex::new(r"\[\[([^\]]*)\]\]")
        .map_err(|_e| WasmError::Guest(String::from("error defining regex")))?;
    let link_titles = inline_links.captures_iter(&*contents).filter_map(|cap| {
        cap.get(1)
            .map(|mat| mat.as_str())
            .map(|title| String::from(title))
    })
    .collect::<Vec<String>>();
    update_note_backlinks(UpdateNoteBacklinksInput {
        note,
        link_titles: link_titles.clone(),
    })?;
    Ok(link_titles)
}

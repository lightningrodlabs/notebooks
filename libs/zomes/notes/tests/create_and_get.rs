use ::fixt::prelude::fixt;
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use hdk::prelude::holo_hash::*;
use hdk::prelude::Timestamp;
use hdk::prelude::*;
use holochain::test_utils::consistency_10s;
use holochain::{conductor::config::ConductorConfig, sweettest::*};
use notes::{CreateNoteInput, Note, NoteWithBacklinks, UpdateNoteBacklinksInput, NoteBacklinks, NoteContentsInput};

#[tokio::test(flavor = "multi_thread")]
async fn create_and_get() {
    // Use prebuilt DNA file
    let dna_path = std::env::current_dir()
        .unwrap()
        .join("../../../apps/launcher/dnas/notebooks/notebooks.dna");
    let dna = SweetDnaFile::from_bundle(&dna_path).await.unwrap();

    // Set up conductors
    let mut conductors = SweetConductorBatch::from_config(2, ConductorConfig::default()).await;
    let apps = conductors.setup_app("notebooks", &[dna]).await.unwrap();
    conductors.exchange_peer_info().await;

    let ((alice,), (bobbo,)) = apps.into_tuples();

    let alice_zome = alice.zome("notes");
    let bob_zome = bobbo.zome("notes");

    let start = SystemTime::now();
    let since_the_epoch = start
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards");

    let note_title_1 = String::from("new note");
    let create_note_input = CreateNoteInput {
        title: note_title_1.clone(),
        timestamp: Timestamp::from_micros(since_the_epoch.as_micros() as i64),
        syn_dna_hash: fixt!(DnaHashB64),
    };

    let first_note_hash: EntryHashB64 = conductors[0]
        .call(&alice_zome, "create_new_note", create_note_input)
        .await;

    consistency_10s(&[&alice, &bobbo]).await;

    let all_notes: BTreeMap<EntryHashB64, NoteWithBacklinks> =
        conductors[1].call(&bob_zome, "get_all_notes", ()).await;

    assert_eq!(all_notes.keys().len(), 1);

    let note = all_notes.values().last().unwrap();
    assert_eq!(note.title, String::from("new note"));

    let note_by_title: Option<Note> = conductors[1].call(&bob_zome, "get_note_by_title", note_title_1.clone()).await;
    assert_eq!(note_by_title.unwrap().title, note_title_1.clone());

    let note_title_2 = String::from("new note 2");
    let create_note_input_2 = CreateNoteInput {
        title: note_title_2.clone(),
        timestamp: Timestamp::from_micros(since_the_epoch.as_micros() as i64),
        syn_dna_hash: fixt!(DnaHashB64),
    };

    let second_note_hash: EntryHashB64 = conductors[0]
        .call(&alice_zome, "create_new_note", create_note_input_2)
        .await;

    consistency_10s(&[&alice, &bobbo]).await;
    let update_note_backlinks_input = UpdateNoteBacklinksInput {
        note: first_note_hash.clone(),
        link_titles: vec![String::from("new note 2")],
    };
    let non_existant_notes = UpdateNoteBacklinksInput {
        note: first_note_hash.clone(),
        link_titles: vec![String::from("blah")],
    };
    let _result: () = conductors[0]
        .call(&alice_zome, "update_note_backlinks", update_note_backlinks_input)
        .await;
    // should not create a backlink since the note doesn't exist
    let _result: () = conductors[0]
        .call(&alice_zome, "update_note_backlinks", non_existant_notes)
        .await;

    let first_note_links: NoteBacklinks = conductors[0]
        .call(&alice_zome, "get_note_links", first_note_hash.clone())
        .await;
    let second_note_links: NoteBacklinks = conductors[0]
        .call(&alice_zome, "get_note_links", second_note_hash.clone())
        .await;

    assert_eq!(first_note_links.links_to.len(), 1);
    assert_eq!(first_note_links.links_to.keys().last().unwrap().clone(), note_title_2);
    assert_eq!(first_note_links.links_to.values().last().unwrap().clone(), second_note_hash);
    assert_eq!(second_note_links.linked_from.len(), 1);
    assert_eq!(second_note_links.linked_from.keys().last().unwrap().clone(), note_title_1);
    assert_eq!(second_note_links.linked_from.values().last().unwrap().clone(), first_note_hash);


    let note_content = String::from(
        "
        hello, this is a note with [[backlinks]] which can be [[composed of multiple words]], [[I love links]].
        "
    );
    let note_links = vec![String::from("backlinks"), String::from("composed of multiple words"), String::from("I love links")];
    let note_contents_input = NoteContentsInput {
        note: first_note_hash,
        contents: note_content,
    };
    let note_links_regexed: Vec<String> = conductors[0]
        .call(&alice_zome, "parse_note_for_links_and_update_index", note_contents_input)
        .await;
    assert_eq!(note_links_regexed.len(), 3);
    assert_eq!(note_links_regexed, note_links);
}

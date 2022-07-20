use ::fixt::prelude::fixt;
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use hdk::prelude::holo_hash::*;
use hdk::prelude::Timestamp;
use hdk::prelude::*;
use holochain::test_utils::consistency_10s;
use holochain::{conductor::config::ConductorConfig, sweettest::*};
use notes::{CreateNoteInput, Note, UpdateNoteBacklinksInput};

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

    let all_notes: BTreeMap<EntryHashB64, Note> =
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

    let note_links: Vec<Link> = conductors[0]
        .call(&alice_zome, "get_note_links", first_note_hash.clone())
        .await;
    let linked_note_links: Vec<Link> = conductors[0]
        .call(&alice_zome, "get_note_links", second_note_hash.clone())
        .await;

    assert_eq!(note_links.len(),1);
    assert_eq!(EntryHash::from(note_links.clone().pop().unwrap().target), EntryHash::from(second_note_hash));
    assert_eq!(linked_note_links.len(),1);
    assert_eq!(EntryHash::from(linked_note_links.clone().pop().unwrap().target), EntryHash::from(first_note_hash));
}

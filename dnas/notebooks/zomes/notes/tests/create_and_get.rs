use ::fixt::prelude::*;
use std::collections::BTreeMap;
use std::time::SystemTime;

use hdk::prelude::holo_hash::*;
use hdk::prelude::DnaHashB64Fixturator;
use holochain::test_utils::consistency_10s;
use holochain::{conductor::config::ConductorConfig, sweettest::*};
use notes::{CreateNoteInput, Note};

#[tokio::test(flavor = "multi_thread")]
async fn create_and_get() {
    // Use prebuilt DNA file
    let dna_path = std::env::current_dir()
        .unwrap()
        .join("../../workdir/notebooks.dna");
    let dna = SweetDnaFile::from_bundle(&dna_path).await.unwrap();

    // Set up conductors
    let mut conductors = SweetConductorBatch::from_config(2, ConductorConfig::default()).await;
    let apps = conductors.setup_app("notebooks", &[dna]).await.unwrap();
    conductors.exchange_peer_info().await;

    let ((alice,), (bobbo,)) = apps.into_tuples();

    let alice_zome = alice.zome("notes");
    let bob_zome = bobbo.zome("notes");

    let now = SystemTime::now();

    let create_note_input = CreateNoteInput {
        title: String::from("new note"),
        timestamp: now,
        syn_dna_hash: fixt!(DnaHashB64),
    };

    let _note_hash: EntryHashB64 = conductors[0]
        .call(&alice_zome, "create_new_note", create_note_input)
        .await;

    consistency_10s(&[&alice, &bobbo]).await;

    let all_notes: BTreeMap<EntryHashB64, Note> =
        conductors[1].call(&bob_zome, "get_all_notes", ()).await;

    assert_eq!(all_notes.keys().len(), 1);

    let note = all_notes.values().last().unwrap();
    assert_eq!(note.title, String::from("new note"));
}

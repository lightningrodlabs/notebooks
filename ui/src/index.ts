import { Commit, DocumentStore, SynStore } from "@holochain-syn/core";
import { textEditorGrammar } from "@holochain-syn/text-editor";
import { EntryHash } from "@holochain/client";
import { Hrl } from "@lightningrodlabs/we-applet";
import { NoteMeta } from "./types";

export async function createNote(
  synStore: SynStore,
  title: string,
  attachedToHrl: Hrl | undefined = undefined
): Promise<EntryHash> {
  const documentStore = await synStore.createDocument(
    textEditorGrammar.initialState(),
    {
      title,
      author: synStore.client.client.myPubKey,
      timestamp: Date.now(),
      attachedToHrl,
    } as NoteMeta
  );
  await documentStore.synStore.client.tagDocument(
    documentStore.documentHash,
    "note"
  );
  await documentStore.createWorkspace("main", undefined);

  return documentStore.documentHash;
}

import { EntryRecord } from "@holochain-open-dev/utils";
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
  const rootHash = await synStore.createDocument(textEditorGrammar, {
    title,
    author: synStore.client.client.myPubKey,
    timestamp: Date.now(),
    attachedToHrl,
  } as NoteMeta);
  const documentStore = new DocumentStore(
    synStore,
    textEditorGrammar,
    rootHash
  );
  await documentStore.createWorkspace("main", rootHash);

  return rootHash;
}

import { EntryRecord } from "@holochain-open-dev/utils";
import { Commit, SynStore } from "@holochain-syn/core";
import { textEditorGrammar } from "@holochain-syn/text-editor";
import { Hrl } from "@lightningrodlabs/we-applet";

import { NoteMeta } from "./types";

export async function createNote(
  synStore: SynStore,
  title: string,
  attachedToHrl: Hrl | undefined = undefined
): Promise<EntryRecord<Commit>> {
  const rootStore = await synStore.createRoot(textEditorGrammar, {
    title,
    author: synStore.client.client.myPubKey,
    timestamp: Date.now(),
    attachedToHrl,
  } as NoteMeta);
  await rootStore.createWorkspace("main", rootStore.root.entryHash);

  return rootStore.root;
}

export { NoteMeta };

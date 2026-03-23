import { Commit, DocumentStore, SynStore } from "@holochain-syn/core";
import { EntryHash } from "@holochain/client";
import { Hrl } from "@theweave/api";
import { textEditorGrammar } from "./grammar";
import { EditorType, NoteMeta } from "./types";

export async function createNote(
  synStore: SynStore,
  title: string,
  attachedToHrl: Hrl | undefined = undefined,
  text: string | undefined = undefined,
  editorType: EditorType = "markdown",
): Promise<EntryHash> {
  // Create initial state with text if provided
  const initialState = text !== undefined 
    ? { text: text.split('') }
    : textEditorGrammar.initialState();

  const documentStore = await synStore.createDocument(
    initialState,
    {
      title,
      author: synStore.client.client.myPubKey,
      timestamp: Date.now(),
      attachedToHrl,
      editorType,
    } as NoteMeta
  );
  await documentStore!.synStore.client.tagDocument(
    documentStore!.documentHash,
    "note"
  );
  await documentStore!.createWorkspace("main", undefined);

  return documentStore!.documentHash;
}

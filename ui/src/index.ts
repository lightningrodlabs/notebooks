import * as Automerge from "@automerge/automerge";
import { encode } from "@msgpack/msgpack";
import { SynStore, freeDoc } from "@holochain-syn/core";
import { EntryHash } from "@holochain/client";
import { Hrl } from "@theweave/api";
import { ExportedComment, initialStateWithComments } from "./comments/export";
import { EditorType, NoteMeta } from "./types";

export async function createNote(
  synStore: SynStore,
  title: string,
  attachedToHrl: Hrl | undefined = undefined,
  text: string | undefined = undefined,
  editorType: EditorType = "markdown",
  comments: ExportedComment[] | undefined = undefined,
): Promise<EntryHash> {
  // The initial state is built here rather than through synStore.createDocument
  // so that imported comment marks can be part of it (createDocument only
  // takes a plain object).
  const doc = initialStateWithComments(text ?? "", comments);
  const meta = {
    title,
    author: synStore.client.client.myPubKey,
    timestamp: Date.now(),
    attachedToHrl,
    editorType,
  } as NoteMeta;
  const initialState = encode(Automerge.save(doc));
  freeDoc(doc); // wasm docs are never reclaimed by the GC
  const documentRecord = await synStore.client.createDocument({
    meta: encode(meta),
    initial_state: initialState,
    nonce: crypto.getRandomValues(new Uint8Array(32)),
  });
  const documentStore = synStore.documents.get(documentRecord.entryHash);
  await documentStore!.synStore.client.tagDocument(
    documentStore!.documentHash,
    "note"
  );
  await documentStore!.createWorkspace("main", undefined);

  return documentStore!.documentHash;
}

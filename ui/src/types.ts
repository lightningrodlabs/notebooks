import { AgentPubKey, AgentPubKeyB64, decodeHashFromBase64, encodeHashToBase64 } from "@holochain/client";
import { Hrl, HrlB64 } from "@theweave/api";

export interface NoteMeta {
  title: string;
  author: AgentPubKey;
  timestamp: number;
  attachedToHrl: Hrl;
}

export interface NoteMetaB64 {
  title: string;
  author: AgentPubKeyB64;
  timestamp: number;
  attachedToHrl: HrlB64;
}

export const noteMetaToB64 = (noteMeta: NoteMeta) : NoteMetaB64 => {
  const hrl = noteMeta.attachedToHrl
  const hrlB64 :HrlB64 | undefined = hrl ? [encodeHashToBase64(hrl[0]), encodeHashToBase64(hrl[1])] : hrl
  const noteMetaB64 = {
    title: noteMeta.title,
    timestamp: noteMeta.timestamp,
    author: encodeHashToBase64(noteMeta.author),
    attachedToHrl: hrlB64

  }
  return noteMetaB64
}

export const noteMetaB64ToRaw = (noteMetaB64: NoteMetaB64) : NoteMeta => {
  const hrlB64 = noteMetaB64.attachedToHrl
  const hrl :Hrl | undefined = hrlB64 ? [decodeHashFromBase64(hrlB64[0]), decodeHashFromBase64(hrlB64[1])] : hrlB64
  const noteMeta = {
    title: noteMetaB64.title,
    timestamp: noteMetaB64.timestamp,
    author: decodeHashFromBase64(noteMetaB64.author),
    attachedToHrl: hrl

  }
  return noteMeta
}

export interface NoteWorkspace {
  name: string,
  note: string,
}

export interface Notebook {
  meta: NoteMetaB64
  workspaces: Array<NoteWorkspace>
}
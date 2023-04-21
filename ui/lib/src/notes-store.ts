import { Commit, SynClient, SynStore } from "@holochain-syn/core";
import { AppAgentClient } from "@holochain/client";
import { textEditorGrammar } from "@holochain-syn/text-editor";

import { AsyncReadable } from "@holochain-open-dev/stores";
import { EntryRecord } from "@holochain-open-dev/utils";

export class NotesStore {
  synStore: SynStore;

  allNotes: AsyncReadable<EntryRecord<Commit>[]>;

  constructor(public client: AppAgentClient) {
    this.synStore = new SynStore(new SynClient(client, "notebooks"));
    this.allNotes = this.synStore.allRoots;
  }

  async createNote(title: string) {
    const rootStore = await this.synStore.createRoot(textEditorGrammar, {
      title,
    });
    await rootStore.createWorkspace("main", rootStore.root.entryHash);

    return rootStore.root;
  }
}

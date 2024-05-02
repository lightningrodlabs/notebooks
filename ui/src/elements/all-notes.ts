import {
  alwaysSubscribed,
  asyncDerived,
  AsyncStatus,
  joinAsync,
  joinAsyncMap,
  mapAndJoin,
  pipe,
  StoreSubscriber,
} from "@holochain-open-dev/stores";
import { synContext, SynStore, Document, WorkspaceStore } from "@holochain-syn/core";
import { consume } from "@lit/context";
import { css, html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { decode } from "@msgpack/msgpack";
import { localized, msg } from "@lit/localize";
import { sharedStyles, wrapPathInSvg } from "@holochain-open-dev/elements";

import "@holochain-open-dev/elements/dist/elements/display-error.js";
import "@holochain-open-dev/profiles/dist/elements/agent-avatar.js";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/relative-time/relative-time.js";
import "@shoelace-style/shoelace/dist/components/skeleton/skeleton.js";
import "@shoelace-style/shoelace/dist/components/checkbox/checkbox.js";
import { mdiDelete, mdiRestore } from "@mdi/js";
import { ActionHash, AgentPubKey, encodeHashToBase64, EntryHash, Timestamp } from "@holochain/client";
import SlCheckbox from "@shoelace-style/shoelace/dist/components/checkbox/checkbox.js";
import { EntryRecord, LazyHoloHashMap } from "@holochain-open-dev/utils";
import { SortDirection } from "./column-label.js";
import { TextEditorEphemeralState, TextEditorState } from "../grammar.js";

enum SortColumn {
  Created,
  Title,
  Author
}

type NoteRow = {
  title: string,
  created: Timestamp,
  author: AgentPubKey,
  actionHash: ActionHash,
  authorSort: number,
  archived: boolean
}

export interface NoteAndLatestState {
  workspace: WorkspaceStore<TextEditorState,TextEditorEphemeralState>,
  latestState: TextEditorState,
  tip: EntryHash,
}

@localized()
@customElement("all-notes")
export class AllNotes extends LitElement {
  @consume({ context: synContext, subscribe: true })
  synStore!: SynStore;

  @state()
  sortColumn = SortColumn.Created

  @state()
  sortDirection = SortDirection.Descending

  @state()
  showArchived = false

  allNotes = new StoreSubscriber(
    this,
    () =>
      pipe(this.synStore.documentsByTag.get("note"), (map) =>
        mapAndJoin(map, (d) => d.record)
      ),
    () => [this.synStore]
  );

  archivedNotes = new StoreSubscriber(
    this,
    () =>
      pipe(this.synStore.documentsByTag.get("arc"), (map) =>
        mapAndJoin(map, (d) => d.record)
      ),
    () => [this.synStore]
  );

  setSort(column: SortColumn, direction:SortDirection) {
    this.sortColumn = column
    this.sortDirection = direction
  }

  authors:string[] = []

  @state()
  noteRows:NoteRow[] = []

  noReset = false

  @state()
  error = ""

  // activeNoteHashes = asyncDerived(this.synStore.documentsByTag.get("note"),x=>Array.from(x.keys()))

  // archivedNoteHashes = asyncDerived(this.synStore.documentsByTag.get("arc"),x=>Array.from(x.keys()))

  // allNoteHashes = joinAsync([this.activeNoteHashes, this.archivedNoteHashes])

  // noteData = new LazyHoloHashMap( documentHash => {
  //   const docStore = this.synStore.documents.get(documentHash)

  //   const workspace = pipe(docStore.allWorkspaces,
  //       workspaces =>  new WorkspaceStore(docStore, Array.from(workspaces.keys())[0])
  //   )
  //   const latestState = pipe(workspace, 
  //     workspace => workspace.latestState
  //       )
  //   const tip = pipe(workspace,
  //     workspace => workspace.tip
  //       )

  //   return alwaysSubscribed(pipe(joinAsync([workspace, latestState, tip]), ([workspace, latestState, tip]) => (
  //        {workspace,latestState, tip: tip ? tip.entryHash: undefined})))
  // })

  processNoteRecord(note: EntryRecord<Document>, archived: boolean) : NoteRow {
    const a = encodeHashToBase64(note.action.author)
    let authorSort = this.authors.findIndex(x=>x===a)
    if (authorSort === -1) {
      authorSort = this.authors.length
      this.authors.push(a)
    }
    return {
      title:(decode(note.entry.meta!) as any).title,
      created: note.action.timestamp,
      author:note.action.author,
      actionHash:note.actionHash,
      authorSort,
      archived
    }
  }

  processNoteRecords(subscriber: StoreSubscriber<AsyncStatus<ReadonlyMap<Uint8Array, EntryRecord<Document>>>>, archived: boolean) {
    switch (subscriber.value.status) {
      case "pending":
          break;
      case "error":
        this.error = subscriber.value.error
        break;
      case "complete":
        this.error = ""
        Array.from(subscriber.value.value.values())
        .forEach((note) => {
          this.noteRows.push(this.processNoteRecord(note, archived))
          })
    }
  }

  doSort(
    notes: NoteRow[]
  ): Array<NoteRow> {
    switch (this.sortColumn) {
      case SortColumn.Created:
        if (this.sortDirection=== SortDirection.Descending)
           return notes.sort((a, b) => b.created - a.created)
        return notes.sort((a, b) => a.created - b.created)
      case SortColumn.Title:      
        if (this.sortDirection=== SortDirection.Descending)
          return notes.sort((a, b) => b.title.localeCompare(a.title))
        return notes.sort((a, b) => a.title.localeCompare(b.title))
      case SortColumn.Author:      
        if (this.sortDirection=== SortDirection.Descending)
           return notes.sort((a, b) => b.authorSort - a.authorSort)
        return notes.sort((a, b) => a.authorSort - b.authorSort)
      }
    return notes
  }

  renderNote(note: NoteRow) {
    const createDate = new Date(note.created)
    return html`
        <div
          class="note-row"
          tabindex="0"
          @click=${() =>
            this.dispatchEvent(
              new CustomEvent("note-selected", {
                bubbles: true,
                composed: true,
                detail: {
                  noteHash: note.actionHash,
                },
              })
            )}
          @keypress=${(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              this.dispatchEvent(
                new CustomEvent("note-selected", {
                  bubbles: true,
                  composed: true,
                  detail: {
                    noteHash: note.actionHash,
                  },
                })
              );
            }
          }}
        >
          <span class="note-title" style="font-size: 18px;">
            ${note.title}
            ${note.archived ? html`<span class="archived">${msg("Archived")}</span>`:""}

          </span>
        
          <span class="note-created">
            ${createDate.toLocaleDateString()} ${createDate.toLocaleTimeString()}
          </span>
          <span class="note-author">
            <agent-avatar .agentPubKey=${note.author}></agent-avatar>
          </span>
          <span class="note-controls"> 
          <sl-icon-button 
          .src=${wrapPathInSvg(note.archived ? mdiRestore : mdiDelete)}
          @click=${async (e:MouseEvent) => {
            e.stopPropagation()
            const nB64 = encodeHashToBase64(note.actionHash)
            const idx = this.noteRows.findIndex(n=>encodeHashToBase64(n.actionHash) === nB64)

            if (idx >= 0) {
              if (note.archived) {
                await this.synStore.client.removeDocumentTag(note.actionHash, "arc")
                await this.synStore.client.tagDocument(note.actionHash, "note")
                this.noteRows[idx].archived = false
              }
              else {
                if (this.showArchived) {
                  this.noteRows[idx].archived = true
                } else {
                  this.noteRows.splice(idx,1)
                }
                await this.synStore.client.removeDocumentTag(note.actionHash, "note")
                await this.synStore.client.tagDocument(note.actionHash, "arc")
              }
              this.noReset = true
              this.requestUpdate();
            }
          }}>
          </sl-icon-button>
          </span>

        </div>
    `;
  }
 

  render() {
    if (!this.noReset) {
      this.noteRows = []
      this.processNoteRecords(this.allNotes, false)
      if (this.showArchived)
        this.processNoteRecords(this.archivedNotes, true)
    }
    else this.noReset = false

    // switch (this.allNotes.value.status) {
    //   case "pending":
    //     return html` <div class="row" style="">
    //       ${Array(3).map(
    //         () => html`<sl-skeleton effect="pulse" class="note"></sl-skeleton>`
    //       )}
    //     </div>`;
    //   case "complete":
        
    //       Array.from(this.allNotes.value.value.values())
    //         .forEach((note) => {
    //           const a = encodeHashToBase64(note.action.author)
    //           let authorSort = authors.findIndex(x=>x===a)
    //           if (authorSort === -1) {
    //             authorSort = authors.length
    //             authors.push(a)
    //           }
    //           noteRows.push( {
    //             title:(decode(note.entry.meta!) as any).title,
    //             created: note.action.timestamp,
    //             author:note.action.author,
    //             actionHash:note.actionHash,
    //             authorSort,
    //             archived:false,
    //       })})
    //     break;
    //     }

    return html`
      <div class="notes">
        <div style="display:flex;width:100%;justify-content:flex-end;margin-bottom:10px">
          ${this.error ? html`
          <display-error
            .headline=${msg("Error fetching notes")}
            .error=${this.error}
          ></display-error>
          `:""}
          <sl-checkbox
            @sl-change=${(e:CustomEvent)=>this.showArchived = (e.target as SlCheckbox).checked}
          >
            show archived
          </sl-checkbox>
        </div>
        <div class="notes-row notes-header">
          <span class="note-title"> 
            <column-label id="title"
              direction=${this.sortColumn === SortColumn.Title?this.sortDirection:SortDirection.None}
              @column-selected=${(e:any)=>this.setSort(SortColumn.Title, e.detail.direction)}
              >
              ${msg("Title")}
            </column-label>
          </span>
          <span class="note-created"> 
            <column-label id="created"
              direction=${this.sortColumn === SortColumn.Created?this.sortDirection:SortDirection.None}
              @column-selected=${(e:any)=>this.setSort(SortColumn.Created, e.detail.direction)}
            >${msg("Created")}
            </column-label >
          </span>
          <span class="note-author"> 
            <column-label id="author"
              direction=${this.sortColumn === SortColumn.Author?this.sortDirection:SortDirection.None}
              @column-selected=${(e:any)=>this.setSort(SortColumn.Author, e.detail.direction)}>
              ${msg("Author")}
            </column-label>
          </span>
          <span class="note-controls"> 
          </span>

        </div>
        ${(this.noteRows.length > 0) ? this.doSort(this.noteRows).map(n=>this.renderNote(n)) :html`
          <div
            class="row"
            style="flex: 1; justify-content: center; align-items: center"
          >
            <span class="placeholder" style="margin: 24px;"
              >${msg("No notes to display.")}</span
            >
          </div>
          `}
      </div>
    `;
    
  }

  static styles = [
    sharedStyles,
    css`
      .notes {
        flex: 1; 
      }
      .notes-header {
        display:flex; align-items:center; justify-content: space-between;
        border-bottom: solid 1px #999;
        width: 100%;
        font-weight: bold;
      }
      .note-row {
        cursor: pointer;
        display:flex; align-items:center; justify-content: space-between;
        padding:5px; 
        width:100%; 
        border-bottom: solid 1px #ccc;
      }
      .note-row:hover {
        box-shadow: 1px 1px 8px #a7a7a7;
      }
      .note-title {
        flex: 1;
      }
      .note-author {
        display:flex;
        width: 80px;
        margin-left:10px;
        justify-content:center;
      }
      .note-created {
        display:flex;
        width: 180px;
        margin-left:10px;
        justify-content:flex-start;
      }
      .note-controls {
        display:flex;
        width:20px;
        justify-content:center;
      }
      .archived {
        background-color: lightgray;
        border-radius: 10px;
        font-size:80%;
        padding:5px;
      }
      sl-card::part(body) {
        display: flex;
        flex: 1;
      }
      :host {
        display: flex;
      }
    `,
  ];
}

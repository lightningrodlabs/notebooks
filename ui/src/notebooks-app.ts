import { LitElement, css, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import {
  ActionHash,
  AdminWebsocket,
  AppClient,
  AppWebsocket,
  AppWebsocketConnectionOptions,
  CellType,
  EntryHash,
} from "@holochain/client";
import {
  ProfilesClient,
  Profile,
  ProfilesStore,
  profilesStoreContext,
} from "@holochain-open-dev/profiles";
import {
  SynStore,
  synContext,
  SynClient,
  DocumentStore,
} from "@holochain-syn/core";

import "@holochain-open-dev/elements/dist/elements/display-error.js";
import "@holochain-open-dev/profiles/dist/elements/agent-avatar.js";
import "@holochain-open-dev/profiles/dist/elements/profile-prompt.js";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";
import "@shoelace-style/shoelace/dist/components/icon-button/icon-button.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/alert/alert.js";
import "@shoelace-style/shoelace/dist/components/dialog/dialog.js";
import "@holochain-syn/core/dist/elements/syn-document-context.js";
import { textEditorGrammar } from "@holochain-syn/text-editor";
import {
  AppletServices,
  WAL,
  initializeHotReload,
  isWeContext,
  WeaveClient,
} from "@lightningrodlabs/we-applet";
import { EntryRecord, LazyHoloHashMap } from "@holochain-open-dev/utils";

import { provide } from "@lit/context";
import { localized, msg } from "@lit/localize";

import {
  AsyncStatus,
  StoreSubscriber,
  get,
  subscribe,
  toPromise,
} from "@holochain-open-dev/stores";
import {
  notifyError,
  onSubmit,
  sharedStyles,
  wrapPathInSvg,
} from "@holochain-open-dev/elements";
import { mdiArrowLeft, mdiCog, mdiInformation } from "@mdi/js";
import { decode } from "@msgpack/msgpack";
import SlDialog from "@shoelace-style/shoelace/dist/components/dialog/dialog.js";
import SlInput from "@shoelace-style/shoelace/dist/components/input/input.js";

import "./elements/markdown-note.js";
import "./elements/all-notes.js";
import { createNote } from "./index.js";
import { appletServices } from "./we-applet.js";
import { NoteMeta, NoteWorkspace, Notebook, noteMetaB64ToRaw, noteMetaToB64 } from "./types.js";
import { deserializeExport, exportNotes } from "./export.js";
import { NotebooksStore, notebooksContext } from "./store.js";
import { renderAsyncStatus } from "./utils.js";

// @ts-ignore
const appPort = import.meta.env.VITE_APP_PORT ? import.meta.env.VITE_APP_PORT : 8888
// @ts-ignore
const adminPort = import.meta.env.VITE_ADMIN_PORT
const url = `ws://localhost:${appPort}`;

type View =
  | {
    type: "main";
  }
  | {
    type: "note";
    noteHash: EntryHash;
  }
  | {
    type: "standalone-note";
    noteHash: EntryHash;
  }
  | {
    type: "create";
    data: any
  };

@localized()
@customElement("notebooks-app")
export class NotebooksApp extends LitElement {
  @state()
  view: View = {
    type: "main",
  };

  @state()
  _loading = true;

  @state()
  importing = false

  @state()
  exporting = false

  @provide({ context: profilesStoreContext })
  @property()
  _profilesStore!: ProfilesStore;

  @provide({ context: synContext })
  @property()
  _synStore!: SynStore;

  @provide({ context: notebooksContext })
  @property()
  _notebooksStore!: NotebooksStore;

  @query('#settings')
  private _settings!: SlDialog;

  @query("#file-input")
  _fileInput!: HTMLElement

  @query("#about-dialog")
  _aboutDialog!: SlDialog

  @query("#create-title")
  _createTitle!: SlInput

  @state()
  disabled: boolean = true


  // _activeNote = new StoreSubscriber(
  //   this,
  //   () =>
  //     this.view.type === "note"
  //       ? this._synStore.documents.get(this.view.noteHash)
  //       : undefined,
  //   () => [this.view.type]
  // );

  _myProfile!: StoreSubscriber<AsyncStatus<EntryRecord<Profile> | undefined>>;

  async buildClient(): Promise<{
    view: View;
    client: AppClient;
    profilesClient: ProfilesClient;
    weaveClient: WeaveClient | undefined;
  }> {
    if ((import.meta as any).env.DEV) {
      try {
        await initializeHotReload();
      } catch (e) {
        console.warn("Could not initialize applet hot-reloading. This is only expected to work in a We context in dev mode.")
      }
    }
    let weaveClient: WeaveClient | undefined
    let tokenResp;
    if (isWeContext()) {
      weaveClient = await WeaveClient.connect(appletServices);

      // Then handle all the different types of views that you offer
      switch (weaveClient.renderInfo.type) {
        case "applet-view":
          switch (weaveClient.renderInfo.view.type) {
            case "main":
              // here comes your rendering logic for the main view
              return {
                view: {
                  type: "main",
                },
                profilesClient: weaveClient.renderInfo.profilesClient as any,
                client: weaveClient.renderInfo.appletClient,
                weaveClient
              };
            case "block":
              throw new Error("Unknown applet-view block type");
            case "asset":
                            if (!weaveClient.renderInfo.view.recordInfo) {
                throw new Error(
                  "Notebooks does not implement asset views pointing to DNAs instead of Records."
                );
              } else {
                switch (weaveClient.renderInfo.view.recordInfo.roleName) {
                  case "notebooks":
                    switch (weaveClient.renderInfo.view.recordInfo.integrityZomeName) {
                      case "syn_integrity":
                        switch (weaveClient.renderInfo.view.recordInfo.entryType) {
                          case "document":
                            // here comes your rendering logic for that specific entry type
                            return {
                              view: {
                                type: "standalone-note",
                                noteHash: weaveClient.renderInfo.view.wal.hrl[1],
                              },
                              client: weaveClient.renderInfo.appletClient,
                              profilesClient: weaveClient.renderInfo
                                .profilesClient as any,
                              weaveClient
                            };
                          default:
                            throw new Error(`Unknown entry type: ${weaveClient.renderInfo.view.recordInfo.entryType}`);
                        }
                      default:
                        throw new Error(`Unknown integrity zome ${weaveClient.renderInfo.view.recordInfo.integrityZomeName}`);
                    }
                  default:
                    throw new Error(`Unknown role name: ${weaveClient.renderInfo.view.recordInfo.roleName}`);
                }
              }
            case "creatable":
              switch (weaveClient.renderInfo.view.name) {
                case "note":
                  return {
                    view: {
                      type: "create",
                      data: weaveClient.renderInfo.view
                    },
                    client: weaveClient.renderInfo.appletClient,
                    profilesClient: weaveClient.renderInfo
                      .profilesClient as any,
                    weaveClient
                  };
                default: throw new Error(`Unknown creatable type: ${weaveClient.renderInfo.view.name}`);
              }
            default:
              throw new Error(`Unknown applet-view type: ${(weaveClient.renderInfo.view as any).type}`);
          }

        default:
          throw new Error(`Unknown render view type: ${weaveClient.renderInfo.type}`);
      }
    }
    if (adminPort) {
      console.log("adminPort is", adminPort)
      const adminWebsocket = await AdminWebsocket.connect({
        url: new URL(`ws://localhost:${adminPort}`)
      })
      tokenResp = await adminWebsocket.issueAppAuthenticationToken({
        installed_app_id: "notebooks",
      });
      const x = await adminWebsocket.listApps({})
      console.log("apps", x)
      const cellIds = await adminWebsocket.listCellIds()
      console.log("CELL IDS", cellIds)
      await adminWebsocket.authorizeSigningCredentials(cellIds[0])
    }
    const params: AppWebsocketConnectionOptions = { url: new URL(url) };
    if (tokenResp) params.token = tokenResp.token;
    const client = await AppWebsocket.connect(params);

    const profilesClient = new ProfilesClient(client, "notebooks");
    return {
      view: {
        type: "main",
      },
      client,
      profilesClient,
      weaveClient
    };
  }

  async connectToHolochain() {
    const { view, profilesClient, client, weaveClient } = await this.buildClient();
    this._synStore = new SynStore(new SynClient(client, "notebooks"));


    const appInfo = await this._synStore.client.client.appInfo();
    const dnaHash = (appInfo?.cell_info.notebooks[0] as any)[
      CellType.Provisioned
    ].cell_id[0];
    this._notebooksStore = new NotebooksStore(dnaHash, weaveClient)
    this._profilesStore = new ProfilesStore(profilesClient);

    this._myProfile = new StoreSubscriber(
      this,
      () => this._profilesStore.myProfile
    );

    this.view = view;
  }

  async firstUpdated() {
    await this.connectToHolochain();

    this._loading = false;
  }

  async doExport() {
    const notes: Array<Notebook> = []
    this.exporting = true
    const docs = await toPromise(this._synStore.documentsByTag.get("note"))
    for (const docStore of Array.from(docs.values())) {
      const record = await toPromise(docStore.record)
      const noteMeta: NoteMeta = decode(record.entry.meta!) as NoteMeta
      const workspaceStores = await toPromise(docStore.allWorkspaces)
      const workspaces: Array<NoteWorkspace> = []
      for (const wsStore of Array.from(workspaceStores.values())) {
        const name = await toPromise(wsStore.name)
        const note = await toPromise(wsStore.latestSnapshot)
        const text = note.text as string
        workspaces.push({ name, note: text })
      }
      notes.push({
        meta: noteMetaToB64(noteMeta),
        workspaces
      })
    }
    exportNotes(notes)
    this.exporting = false
  }

  onFileSelected = (e: any) => {
    const file = e.target.files[0];
    const reader = new FileReader();

    reader.addEventListener("load", async () => {
      this.importing = true

      const importedNotebooks = deserializeExport(reader.result as string)
      if (importedNotebooks.length > 0) {
        for (const n of importedNotebooks) {
          const noteMeta = noteMetaB64ToRaw(n.meta)
          console.log(n)
          const _noteHash = await createNote(this._synStore, noteMeta.title, noteMeta.attachedToHrl, n.workspaces[0].note);
        }
      }
      this.importing = false
    }, false);
    reader.readAsText(file);
  };

  renderContent() {
    if (this.view.type === "create")
      return html`
      <div style="display:flex; flex-direction:column;padding:20px;">
        <sl-input
          id="create-title"
          @sl-input=${(e: any) => this.disabled = !e.target.value}
          .label=${msg("Title")}></sl-input>
          <div style="margin-top:10px;display:flex;justify-content:flex-end;width:400px">
            <sl-button @click=${() => {
          // @ts-ignore
          this.view.data.cancel()
        }}>Cancel</sl-button>

            <sl-button 
              style="margin-left:10px;"
              variant="primary"
              .disabled=${this.disabled}
              @click=${async () => {
          try {
            const title = this._createTitle.value
            const noteHash = await createNote(this._synStore, title, undefined, `# ${title}\n\n`);

            const hrlWithContext: WAL = {
              hrl: [this._notebooksStore.dnaHash, noteHash],
              context: {},
            }
            // @ts-ignore
            this.view.data.resolve(hrlWithContext)
          } catch (e) {
            console.log("ERR", e)
            // @ts-ignore
            this.view.reject(e)
          }
        }}>Create</sl-button>
          </div>
        </div>
      `;
    if (this.view.type === "note" || this.view.type === "standalone-note")
      return html`
        <syn-document-context
          .documentstore=${this._synStore.documents.get(this.view.noteHash)}
        >
          <markdown-note 
          @close=${()=>this.view = {
            type: "main",
          }}
          .standalone=${this.view.type === "standalone-note"} style="flex: 1;"></markdown-note>
        </syn-document-context>
      `;
    return html`
      <input id="file-input" style="display:none" type="file" accept=".json" @change=${(e: any) => { this.onFileSelected(e) }} >

      <div class="flex-scrollable-parent">
        <div class="flex-scrollable-container">
          <div class="flex-scrollable-y">
            <div class="column" style="flex: 1; margin: 16px">
              <sl-dialog id="settings" label="Settings">
                  <sl-button
                    @click=${async () => { await this.doExport() }}
                    .loading=${this.exporting}
                    >
                    Export All Notes
                  </sl-button>
                  <sl-button
                    @click=${() => this._fileInput.click()}
                    .loading=${this.importing}
                    >
                    Import Notes
                  </sl-button> 

                  </sl-dialog>
              ${ this._synStore ? html`
              <all-notes
                style="flex: 1;"
                @note-selected=${(e: CustomEvent) => {
                  this.view = {
                    type: "note",
                    noteHash: e.detail.noteHash,
                  };
                }}
              ></all-notes>
              `:``}
            </div>
          </div>
        </div>
      </div>
      ${this.renderNewNoteButton()}
    `;
  }

  get _newNoteDialog(): SlDialog {
    return this.shadowRoot?.getElementById("new-note-dialog") as SlDialog;
  }

  @state()
  creatingNote = false;

  async createNote(title: string) {
    if (this.creatingNote) return;

    this.creatingNote = true;

    try {
      const noteHash = await createNote(this._synStore, title, undefined, `# ${title}\n\n`);

      this._newNoteDialog.hide();
      (this.shadowRoot?.getElementById("note-form") as HTMLFormElement).reset();

      this.view = {
        type: "note",
        noteHash,
      };
    } catch (e) {
      console.error(e);
      notifyError(msg("Error creating the note"));
    }
    this.creatingNote = false;
  }

  renderNewNoteButton() {
    return html`<sl-button
        variant="primary"
        style="
      margin: 16px;
      position: absolute;
      right: 0;
      bottom: 0;
    "
        @click=${() => this._newNoteDialog.show()}
      >
        ${msg("Create Note")}
      </sl-button>
      <sl-dialog .label=${msg("Create Note")} id="new-note-dialog"
        @sl-initial-focus=${(e: { preventDefault: () => void }) => {
            e.preventDefault();
            const title = this.shadowRoot?.getElementById("title") as SlInput
            title.focus()
          }}
      >
        <form ${onSubmit((f) => this.createNote(f.title))} id="note-form">
          <sl-input id="title" name="title" .label=${msg("Title")} required></sl-input>
        </form>

        <sl-button slot="footer" @click=${() => this._newNoteDialog.hide()}>
          ${msg("Cancel")}
        </sl-button>

        <sl-button
          slot="footer"
          variant="primary"
          type="submit"
          form="note-form"
          .loading=${this.creatingNote}
        >
          ${msg("Create")}
        </sl-button>
      </sl-dialog> `;
  }

  renderMyProfile() {
    if (
      this._myProfile.value.status !== "complete" ||
      this._myProfile.value.value === undefined
    )
      return html``;
    return html` <div
      class="row"
      style="align-items: center;"
      slot="actionItems"
    >
      <agent-avatar
        .agentPubKey=${this._profilesStore.client.client.myPubKey}
      ></agent-avatar>
      <span style="margin: 0 16px;"
        >${this._myProfile.value.value?.entry.nickname}</span
      >
    </div>`;
  }

  renderFooter() {
    const buttons = html`
    <div style="display:flex;align-items:center;margin-right:${isWeContext()? "0px": "40px"};">
      <sl-icon-button 
        style="color:white;"
        .src=${wrapPathInSvg(mdiInformation)}
        @click=${() => {
          this._aboutDialog.show()
        }}>
        </sl-icon-button>
      <sl-icon-button style="color:white;" class="settings-button" .src=${wrapPathInSvg(mdiCog)} @click=${() => { this._settings.show() }}></sl-icon-button>
      </div>
`

    return html`
    <div style="height: 40px; background-color: #0c4a6e; display:flex;align-items:center;">
      <h3 style="color:white;margin-left:10px;">${msg("Notebooks")} 
      </h3>
        ${buttons}
    </div>
    `
  }

  render() {
    if (this._loading)
      return html`<div
        class="row"
        style="flex: 1; height: 100%; align-items: center; justify-content: center;"
      >
        <sl-spinner style="font-size: 2rem"></sl-spinner>
      </div>`;
    if (this.view.type === "standalone-note") {
      return this.renderContent()
    }

    return html`
      <sl-dialog label="Notebooks: UI v0.2.10 for DNA v0.2.0" id="about-dialog" width={600} >
          <div class="about">
              <p>Notebooks is a demonstration Holochain app built by Lighning Rod Labs.</p>
              <p> <b>Developers:</b>
                  Check out this hApp's source-code <a target="_blank" href="https://github.com/lightningrodlabs/notebooks">in our github repo</a>.
                  This project's real-time syncronization is powered by <a href="https://github.com/holochain/syn">Syn</a>, 
                  a library that makes it really easy to build this kind of real-time collaboaration into Holochain apps.
              </p>
              <p class="small">Copyright © 2023-2024 Harris-Braun Enterprises, LLC.  This software is distributed under the MIT License</p>
          </div>
      </sl-dialog>
      <div class="column" style="flex: 1; display: flex;">
        <div class="fill row" style="width: 100vw; height: 100%;">
          <profile-prompt style="flex: 1;">
            ${this.renderContent()}
          </profile-prompt>
        </div>
        ${this.renderFooter()}
      </div>
    `;
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex: 1;
      }
      .title {
        display:flex;
        align-items: center;
      }
      .back-button {
        color: white;
        font-size: 22px;
      }
      .back-button:hover {
        background: #ffffff65;
        border-radius: 50%;
      }
      .settings-button {
        font-size: 22px;
      }
      .settings-button:hover {
        background: #ffffff65;
        border-radius: 50%;
      }
      .about {
        background-color: white;
      }
      .about p {

          margin-bottom:10px;
      }
      .small {
          font-size: 80%;
      }

    `,
    sharedStyles,
  ];
}

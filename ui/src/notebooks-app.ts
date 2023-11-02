import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  ActionHash,
  AppAgentClient,
  AppAgentWebsocket,
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
import "@shoelace-style/shoelace/dist/components/dialog/dialog.js";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";
import "@shoelace-style/shoelace/dist/components/icon-button/icon-button.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/alert/alert.js";
import "@holochain-syn/core/dist/elements/syn-document-context.js";
import { textEditorGrammar } from "@holochain-syn/text-editor";
import {
  AppletServices,
  isWeContext,
  WeClient,
} from "@lightningrodlabs/we-applet";
import { LazyHoloHashMap } from "@holochain-open-dev/utils";

import { provide } from "@lit-labs/context";
import { localized, msg } from "@lit/localize";

import { AsyncStatus, StoreSubscriber } from "@holochain-open-dev/stores";
import {
  notifyError,
  onSubmit,
  sharedStyles,
  wrapPathInSvg,
} from "@holochain-open-dev/elements";
import { mdiArrowLeft } from "@mdi/js";
import { decode } from "@msgpack/msgpack";
import SlDialog from "@shoelace-style/shoelace/dist/components/dialog/dialog.js";

import "./elements/markdown-note.js";
import "./elements/all-notes.js";
import { createNote } from "./index.js";
import { appletServices } from "./we-applet.js";

type View =
  | {
      type: "main";
    }
  | {
      type: "note";
      noteHash: EntryHash;
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

  @provide({ context: profilesStoreContext })
  @property()
  _profilesStore!: ProfilesStore;

  @provide({ context: synContext })
  @property()
  _synStore!: SynStore;

  _activeNoteCommit = new StoreSubscriber(
    this,
    () =>
      this.view.type === "note"
        ? this._synStore.commits.get(this.view.noteHash)
        : undefined,
    () => [this.view.type]
  );

  _myProfile!: StoreSubscriber<AsyncStatus<Profile | undefined>>;

  documents = new LazyHoloHashMap(
    (noteHash: EntryHash) =>
      new DocumentStore(this._synStore, textEditorGrammar, noteHash)
  );

  async buildClient(): Promise<{
    view: View;
    client: AppAgentClient;
    profilesClient: ProfilesClient;
  }> {
    if (isWeContext()) {
      const weClient = await WeClient.connect(appletServices);

      // Then handle all the different types of views that you offer
      switch (weClient.renderInfo.type) {
        case "applet-view":
          switch (weClient.renderInfo.view.type) {
            case "main":
              // here comes your rendering logic for the main view
              return {
                view: {
                  type: "main",
                },
                profilesClient: weClient.renderInfo.profilesClient,
                client: weClient.renderInfo.appletClient,
              };
            case "block":
              throw new Error("Unknown applet-view block type");
            case "entry":
              switch (weClient.renderInfo.view.roleName) {
                case "notebooks":
                  switch (weClient.renderInfo.view.integrityZomeName) {
                    case "syn_integrity":
                      switch (weClient.renderInfo.view.entryType) {
                        case "commit":
                          // here comes your rendering logic for that specific entry type
                          return {
                            view: {
                              type: "note",
                              noteHash: weClient.renderInfo.view.hrl[1],
                            },
                            client: weClient.renderInfo.appletClient,
                            profilesClient: weClient.renderInfo.profilesClient,
                          };
                        default:
                          throw new Error("Unknown entry type");
                      }
                    default:
                      throw new Error("Unknown integrity zome");
                  }
                default:
                  throw new Error("Unknown role name");
              }

            default:
              throw new Error("Unknown applet-view type");
          }

        default:
          throw new Error("Unknown render view type");
      }
    }

    const client = await AppAgentWebsocket.connect(
      new URL("ws://localhost"),
      "notebooks"
    );
    const profilesClient = new ProfilesClient(client, "notebooks");
    return {
      view: {
        type: "main",
      },
      client,
      profilesClient,
    };
  }

  async connectToHolochain() {
    const { view, profilesClient, client } = await this.buildClient();
    this._synStore = new SynStore(new SynClient(client, "notebooks"));

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

  renderContent() {
    if (this.view.type === "note")
      return html`
        <syn-document-context
          .documentstore=${this.documents.get(this.view.noteHash)}
        >
          <markdown-note style="flex: 1;"></markdown-note>
        </syn-document-context>
      `;

    return html`
      <div class="flex-scrollable-parent">
        <div class="flex-scrollable-container">
          <div class="flex-scrollable-y">
            <div class="column" style="flex: 1; margin: 16px">
              <span class="title">${msg("All Notes")}</span>
              <all-notes
                style="flex: 1;"
                @note-selected=${(e: CustomEvent) => {
                  this.view = {
                    type: "note",
                    noteHash: e.detail.noteHash,
                  };
                }}
              ></all-notes>
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
      const noteHash = await createNote(this._synStore, title);

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
      <sl-dialog .label=${msg("Create Note")} id="new-note-dialog">
        <form ${onSubmit((f) => this.createNote(f.title))} id="note-form">
          <sl-input name="title" .label=${msg("Title")} required></sl-input>
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
        >${this._myProfile.value.value?.nickname}</span
      >
    </div>`;
  }

  renderBackButton() {
    if (this.view.type === "main") return html``;

    return html`
      <sl-icon-button
        .src=${wrapPathInSvg(mdiArrowLeft)}
        class="back-button"
        @click=${() => {
          this.view = {
            type: "main",
          };
        }}
      ></sl-icon-button>
    `;
  }

  renderTitle() {
    if (this._activeNoteCommit.value?.status === "complete")
      return (decode(this._activeNoteCommit.value.value.entry.meta!) as any)
        .title;
    return msg("Notebooks");
  }

  render() {
    if (this._loading)
      return html`<div
        class="row"
        style="flex: 1; height: 100%; align-items: center; justify-content: center;"
      >
        <sl-spinner style="font-size: 2rem"></sl-spinner>
      </div>`;

    return html`
      <div class="column" style="flex: 1; display: flex;">
        <div
          class="row"
          style="align-items: center; color:white; background-color: var(--sl-color-primary-900); padding: 0 16px; height: 65px;"
        >
          ${this.renderBackButton()}
          <div style="flex: 1">${this.renderTitle()}</div>
          ${this.renderMyProfile()}
        </div>
        <div class="fill row" style="width: 100vw; height: 100%;">
          <profile-prompt style="flex: 1;">
            ${this.renderContent()}
          </profile-prompt>
        </div>
      </div>
    `;
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex: 1;
      }
      .back-button {
        color: white;
        font-size: 22px;
      }
      .back-button:hover {
        background: #ffffff65;
        border-radius: 50%;
      }
    `,
    sharedStyles,
  ];
}
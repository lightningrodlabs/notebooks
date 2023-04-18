import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ActionHash, AppAgentWebsocket } from "@holochain/client";
import {
  ProfilesClient,
  Profile,
  ProfilesStore,
  profilesStoreContext,
} from "@holochain-open-dev/profiles";

import "@holochain-open-dev/elements/dist/elements/display-error.js";
import "@holochain-open-dev/profiles/dist/elements/agent-avatar.js";
import "@holochain-open-dev/profiles/dist/elements/profile-prompt.js";
import "@shoelace-style/shoelace/dist/dialog/dialog.js";
import "@shoelace-style/shoelace/dist/spinner/spinner.js";
import "@shoelace-style/shoelace/dist/icon-button/icon-button.js";
import "@shoelace-style/shoelace/dist/button/button.js";
import "@shoelace-style/shoelace/dist/alert/alert.js";

import { provide } from "@lit-labs/context";
import { localized, msg } from "@lit/localize";

import "@lightningrodlabs/notebooks/dist/elements/markdown-note.js";
import "@lightningrodlabs/notebooks/dist/elements/all-notes.js";
import { NotesStore, notesStoreContext } from "@lightningrodlabs/notebooks";

import { router } from "./router";
import { AsyncStatus, StoreSubscriber } from "@holochain-open-dev/stores";
import { SlDialog } from "@shoelace-style/shoelace";
import {
  notifyError,
  onSubmit,
  wrapPathInSvg,
} from "@holochain-open-dev/elements";
import { mdiArrowLeft } from "@mdi/js";

@localized()
@customElement("notebooks-app")
export class NotebooksApp extends LitElement {
  @state()
  _activeNoteHash: ActionHash | undefined;

  @state()
  _loading = true;

  @provide({ context: profilesStoreContext })
  @property()
  _profilesStore!: ProfilesStore;

  @provide({ context: notesStoreContext })
  @property()
  _notesStore!: NotesStore;

  _activeNote = new StoreSubscriber(this, () =>
    this._activeNoteHash
      ? this._notesStore.note(this._activeNoteHash)
      : undefined
  );

  _myProfile!: StoreSubscriber<AsyncStatus<Profile | undefined>>;

  _openedSyn = new StoreSubscriber(this, () =>
    this._activeNoteHash
      ? this._notesStore?.noteSynStore(this._activeNoteHash)
      : undefined
  );

  async connectToHolochain() {
    const client = await AppAgentWebsocket.connect("", "notebooks");

    this._profilesStore = new ProfilesStore(
      new ProfilesClient(client, "notebooks")
    );

    this._myProfile = new StoreSubscriber(
      this,
      () => this._profilesStore.myProfile
    );

    this._notesStore = new NotesStore(client);
  }

  async firstUpdated() {
    await this.connectToHolochain();

    router
      .on("/note/:note", (params: any) => {
        this._activeNoteHash = params.data.note;
      })
      .on("/", () => {
        this._activeNoteHash = undefined;
      })
      .resolve();
    this._loading = false;
  }

  renderContent() {
    if (this._activeNoteHash)
      return html`<markdown-note
        style="flex: 1;"
        .noteHash=${this._activeNoteHash}
      ></markdown-note>`;

    return html`
      <div class="column" style="flex: 1;">
        <all-notes
          style="flex: 1; margin: 16px;"
          @note-selected=${(e: CustomEvent) =>
            router.navigate(`/note/${e.detail.noteHash}`)}
        ></all-notes>
        ${this.renderNewNoteButton()}
      </div>
    `;
  }

  get _newNoteDialog(): SlDialog {
    return this.shadowRoot?.getElementById("new-note-dialog") as SlDialog;
  }

  async createNote(title: string) {
    try {
      await this._notesStore.createNote(title);
      this._newNoteDialog.hide();
      (this.shadowRoot?.getElementById("note-form") as HTMLFormElement).reset();
    } catch (e) {
      console.error(e);
      notifyError(msg("Error creating the note"));
    }
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
        >
          ${msg("Create")}
        </sl-button>
      </sl-dialog> `;
  }

  renderMyProfile() {
    if (!this._myProfile) return html``;
    switch (this._myProfile.value.status) {
      case "pending":
        return html``;
      case "complete":
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
      case "error":
        return html`<display-error
          tooltip
          .headline=${msg("Error fetching your profile")}
          .error=${this._myProfile.value.error.data.data}
        ></display-error>`;
    }
  }

  renderBackButton() {
    if (!this._activeNoteHash) return html``;

    return html`
      <sl-icon-button
        .src=${wrapPathInSvg(mdiArrowLeft)}
        @click=${() => router.navigate("/")}
      ></sl-icon-button>
    `;
  }

  renderTitle() {
    if (this._activeNote.value) return this._activeNote.value.title;
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
          ${this.renderBackButton()} ${this.renderTitle()}
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
    `,
    sharedStyles,
  ];
}

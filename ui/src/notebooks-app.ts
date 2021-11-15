import { LitElement, css, html } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import {
  AdminWebsocket,
  AppWebsocket,
  InstalledCell,
} from '@holochain/conductor-api';
import { CellClient, HolochainClient } from '@holochain-open-dev/cell-client';
import { EntryHashB64 } from '@holochain-open-dev/core-types';
import {
  AgentAvatar,
  ProfilePrompt,
  ProfilesStore,
  profilesStoreContext,
} from '@holochain-open-dev/profiles';
import { profilesStoreContext as profilesStoreContext2 } from '../../../syn/node_modules/@holochain-open-dev/profiles';
import { Context, ContextProvider } from '@lit-labs/context';
import { StoreSubscriber } from 'lit-svelte-stores';
import { ScopedElementsMixin } from '@open-wc/scoped-elements';
import {
  Button,
  CircularProgress,
  Dialog,
  Fab,
  IconButton,
  TextField,
  TopAppBar,
} from '@scoped-elements/material-web';

import { router } from './router';

import { MarkdownNote } from './lib/elements/markdown-note';
import { sharedStyles } from './lib/shared-styles';
import { NotesCreatedByMe } from './lib/elements/notes-created-by-me';
import { NotesCreatedByOthers } from './lib/elements/notes-created-by-others';
import { NotesStore } from './lib/notes-store';
import { notesStoreContext } from './lib/context';

export class NotebooksApp extends ScopedElementsMixin(LitElement) {
  @state()
  _activeNoteHash: EntryHashB64 | undefined;
  @state()
  _loading = true;

  _profilesStore!: ContextProvider<Context<ProfilesStore>>;
  _notesStore!: ContextProvider<Context<NotesStore>>;

  _myProfile = new StoreSubscriber(
    this,
    () => this._profilesStore?.value.myProfile
  );

  _openedSyn = new StoreSubscriber(this, () =>
    this._activeNoteHash
      ? this._notesStore?.value.noteSynStore(this._activeNoteHash)
      : undefined
  );
  _activeSession = new StoreSubscriber(
    this,
    () => this._openedSyn.value?.activeSession
  );

  async connectToHolochain() {
    const appWebsocket = await AppWebsocket.connect(
      `ws://localhost:${process.env.HC_PORT}`
    );
    const adminWebsocket = await AdminWebsocket.connect(
      `ws://localhost:${process.env.ADMIN_PORT}`
    );

    const appInfo = await appWebsocket.appInfo({
      installed_app_id: 'notebooks',
    });

    const cellData = appInfo.cell_data.find(
      c => c.role_id === 'notebooks'
    ) as InstalledCell;

    const client = new HolochainClient(appWebsocket, cellData);

    const profilesStore = new ProfilesStore(client);

    this._profilesStore = new ContextProvider(
      this,
      profilesStoreContext,
      profilesStore
    );
    new ContextProvider(this, profilesStoreContext2, profilesStore);
    this._notesStore = new ContextProvider(
      this,
      notesStoreContext,
      new NotesStore(client, adminWebsocket)
    );
  }

  async firstUpdated() {
    await this.connectToHolochain();

    router
      .on('/note/:note', (params: any) => {
        this._activeNoteHash = params.data.note;
      })
      .on('/', () => {
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
        <notes-created-by-me
          style="flex: 1; margin: 16px;"
          @note-selected=${(e: CustomEvent) =>
            router.navigate(`/note/${e.detail.noteHash}`)}
        ></notes-created-by-me>
        <notes-created-by-others
          @note-selected=${(e: CustomEvent) =>
            router.navigate(`/note/${e.detail.noteHash}`)}
          style="flex: 1; margin: 16px;"
        ></notes-created-by-others>
        ${this.renderNewNoteButton()}
      </div>
    `;
  }

  get _newNoteDialog(): Dialog {
    return this.shadowRoot?.getElementById('new-note-dialog') as Dialog;
  }
  @state()
  _newNoteTitle: string | undefined;

  renderNewNoteButton() {
    return html`<mwc-fab
        extended
        icon="add"
        label="Create Note"
        style="
      margin: 16px;
      position: absolute;
      right: 0;
      bottom: 0;
    "
        @click=${() => this._newNoteDialog.show()}
      ></mwc-fab>
      <mwc-dialog
        heading="Create Note"
        id="new-note-dialog"
        @closed=${() =>
          ((this.shadowRoot?.getElementById('new-note-title') as any).value =
            '')}
      >
        <mwc-textfield
          label="Title"
          id="new-note-title"
          required
          autoValidate
          outlined
          @input=${(e: CustomEvent) =>
            (this._newNoteTitle = (e.target as any).value)}
        ></mwc-textfield>

        <mwc-button slot="secondaryAction" dialogAction="cancel">
          Cancel
        </mwc-button>

        <mwc-button
          slot="primaryAction"
          dialogAction="create"
          .disabled=${!this._newNoteTitle}
          @click=${() =>
            this._notesStore.value.createNote(this._newNoteTitle as string)}
        >
          Create
        </mwc-button>
      </mwc-dialog> `;
  }

  renderMyProfile() {
    if (!this._myProfile.value) return html``;
    return html`
      <div class="row" style="align-items: center;" slot="actionItems">
        <agent-avatar
          .agentPubKey=${this._profilesStore.value.myAgentPubKey}
        ></agent-avatar>
        <span style="margin: 0 16px;">${this._myProfile.value.nickname}</span>
      </div>
    `;
  }

  renderBackButton() {
    if (
      !this._activeNoteHash ||
      !this._activeSession ||
      this._activeSession.value
    )
      return html``;

    return html`
      <mwc-icon-button
        icon="arrow_back"
        slot="navigationIcon"
        @click=${() => router.navigate('/')}
      ></mwc-icon-button>
    `;
  }

  render() {
    if (this._loading)
      return html`<div
        class="row"
        style="flex: 1; height: 100%; align-items: center; justify-content: center;"
      >
        <mwc-circular-progress indeterminate></mwc-circular-progress>
      </div>`;

    return html`
      <mwc-top-app-bar style="flex: 1; display: flex;">
        ${this.renderBackButton()}
        <div slot="title">Notebooks</div>
        <div class="fill row" style="width: 100vw; height: 100%;">
          <profile-prompt style="flex: 1;">
            ${this.renderContent()}
          </profile-prompt>
        </div>
        ${this.renderMyProfile()}
      </mwc-top-app-bar>
    `;
  }

  static get scopedElements() {
    return {
      'profile-prompt': ProfilePrompt,
      'agent-avatar': AgentAvatar,
      'mwc-top-app-bar': TopAppBar,
      'markdown-note': MarkdownNote,
      'notes-created-by-me': NotesCreatedByMe,
      'notes-created-by-others': NotesCreatedByOthers,
      'mwc-icon-button': IconButton,
      'mwc-circular-progress': CircularProgress,
      'mwc-fab': Fab,
      'mwc-dialog': Dialog,
      'mwc-textfield': TextField,
      'mwc-button': Button,
    };
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

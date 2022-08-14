import '@webcomponents/scoped-custom-element-registry';

import { LitElement, css, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { AdminWebsocket, AppWebsocket, InstalledCell } from '@holochain/client';
import { HolochainClient, CellClient } from '@holochain-open-dev/cell-client';
import { EntryHashB64, serializeHash } from '@holochain-open-dev/core-types';
import {
  AgentAvatar,
  Profile,
  ProfilePrompt,
  ProfilesService,
  ProfilesStore,
  profilesStoreContext,
} from '@holochain-open-dev/profiles';
import { contextProvider } from '@lit-labs/context';
import { StoreSubscriber, TaskSubscriber } from 'lit-svelte-stores';
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

import {
  MarkdownNote,
  sharedStyles,
  NotesCreatedByMe,
  NotesCreatedByOthers,
  NotesStore,
  notesStoreContext,
} from '@lightningrodlabs/notebooks';

import { router } from './router';

export class NotebooksApp extends ScopedElementsMixin(LitElement) {
  @state()
  _activeNoteHash: EntryHashB64 | undefined;

  @state()
  _loading = true;

  @contextProvider({ context: profilesStoreContext })
  @property()
  _profilesStore!: ProfilesStore;

  @contextProvider({ context: notesStoreContext })
  @property()
  _notesStore!: NotesStore;

  _activeNote = new StoreSubscriber(this, () =>
    this._activeNoteHash
      ? this._notesStore.note(this._activeNoteHash)
      : undefined
  );

  _myProfileTask!: TaskSubscriber<[], Profile | undefined>;

  _openedSyn = new StoreSubscriber(this, () =>
    this._activeNoteHash
      ? this._notesStore?.noteSynStore(this._activeNoteHash)
      : undefined
  );

  async connectToHolochain() {
    const url = `ws://localhost:${process.env.HC_PORT}`;
    const adminWebsocket = await AdminWebsocket.connect(
      `ws://localhost:${process.env.ADMIN_PORT}`
    );

    const appWebsocket = await AppWebsocket.connect(url);
    const client = new HolochainClient(appWebsocket);

    const appInfo = await appWebsocket.appInfo({
      installed_app_id: 'notebooks',
    });

    const installedCells = appInfo.cell_data;
    const notebooksCell = installedCells.find(
      c => c.role_id === 'notebooks'
    ) as InstalledCell;

    const cellClient = new CellClient(client, notebooksCell);

    this._profilesStore = new ProfilesStore(new ProfilesService(cellClient));

    this._myProfileTask = new TaskSubscriber(this, () =>
      this._profilesStore.fetchMyProfile()
    );
    const cell = installedCells.find(c => c.role_id === 'syn') as InstalledCell;
    const synDnaHash = cell.cell_id[0];

    this._notesStore = new NotesStore(
      client,
      adminWebsocket,
      notebooksCell,
      synDnaHash
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
            this._notesStore.createNote(this._newNoteTitle as string)}
        >
          Create
        </mwc-button>
      </mwc-dialog> `;
  }

  renderMyProfile() {
    return this._myProfileTask?.render({
      pending: () => html``,
      complete: profile =>
        profile
          ? html` <div
              class="row"
              style="align-items: center;"
              slot="actionItems"
            >
              <agent-avatar
                .agentPubKey=${serializeHash(this._profilesStore.myAgentPubKey)}
              ></agent-avatar>
              <span style="margin: 0 16px;">${profile?.nickname}</span>
            </div>`
          : undefined,
    });
  }

  renderBackButton() {
    if (!this._activeNoteHash) return html``;

    return html`
      <mwc-icon-button
        icon="arrow_back"
        slot="navigationIcon"
        @click=${() => router.navigate('/')}
      ></mwc-icon-button>
    `;
  }

  renderTitle() {
    if (this._activeNote.value) return this._activeNote.value.title;
    return 'Notebooks';
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
        <div slot="title">${this.renderTitle()}</div>
        <div class="fill row" style="width: 100vw; height: 100%;">
          <profile-prompt
            style="flex: 1;"
            @profile-created=${() => this._myProfileTask.run()}
          >
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

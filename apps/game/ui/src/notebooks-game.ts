import { LitElement, css, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { AdminWebsocket, AppWebsocket, InstalledCell } from '@holochain/client';
import { HolochainClient } from '@holochain-open-dev/cell-client';
import { EntryHashB64 } from '@holochain-open-dev/core-types';
import {
  AgentAvatar,
  Profile,
  ProfilePrompt,
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

export class NotebooksGame extends ScopedElementsMixin(LitElement) {
  @state()
  _activeNoteHash: EntryHashB64 | undefined;

  @contextProvider({ context: profilesStoreContext })
  @property()
  profilesStore!: ProfilesStore;

  @contextProvider({ context: notesStoreContext })
  @property()
  notesStore!: NotesStore;

  _activeNote = new StoreSubscriber(this, () =>
    this._activeNoteHash
      ? this.notesStore.note(this._activeNoteHash)
      : undefined
  );

  _myProfileTask!: TaskSubscriber<Profile | undefined>;

  _openedSyn = new StoreSubscriber(this, () =>
    this._activeNoteHash
      ? this.notesStore?.noteSynStore(this._activeNoteHash)
      : undefined
  );

  _activeSession = new StoreSubscriber(
    this,
    () => this._openedSyn.value?.activeSession
  );

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
            (this._activeNoteHash = e.detail.noteHash)}
        ></notes-created-by-me>
        <notes-created-by-others
          @note-selected=${(e: CustomEvent) =>
            (this._activeNoteHash = e.detail.noteHash)}
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
            this.notesStore.createNote(this._newNoteTitle as string)}
        >
          Create
        </mwc-button>
      </mwc-dialog> `;
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
        @click=${() => (this._activeNoteHash = undefined)}
      ></mwc-icon-button>
    `;
  }

  render() {
    return html` ${this.renderBackButton()} ${this.renderContent()} `;
  }

  static get scopedElements() {
    return {
      'agent-avatar': AgentAvatar,
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

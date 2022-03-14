import { EntryHashB64 } from '@holochain-open-dev/core-types';
import { contextProvided, provide } from '@holochain-open-dev/context';
import { ScopedElementsMixin } from '@open-wc/scoped-elements';
import { html, LitElement, PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import {
  SynContext,
  synContext,
  SynFolks,
  SynCommitHistory,
  SynSessions,
} from '@holochain-syn/elements';
import { SynTextEditor } from '@holochain-syn/text-editor';
import { StoreSubscriber } from 'lit-svelte-stores';
import { MarkdownRenderer } from '@scoped-elements/markdown-renderer';
import {
  Card,
  CircularProgress,
  Fab,
  Snackbar,
} from '@scoped-elements/material-web';

import { notesStoreContext } from '../context';
import { NotesStore, NoteSynStore } from '../notes-store';
import { sharedStyles } from '../shared-styles';

import { getLatestCommit } from './utils';

export class MarkdownNote extends ScopedElementsMixin(LitElement) {
  @property()
  noteHash!: EntryHashB64;

  @contextProvided({ context: notesStoreContext })
  _notesStore!: NotesStore;

  @state()
  _noteSynStore: NoteSynStore | undefined;

  _activeSession = new StoreSubscriber(
    this,
    () => this._noteSynStore?.activeSession
  );
  _lastCommitHash = new StoreSubscriber(
    this,
    () => this._activeSession.value?.lastCommitHash
  );
  _state = new StoreSubscriber(
    this,
    () => this._activeSession.value?.state
  );
  _allCommits = new StoreSubscriber(this, () => this._noteSynStore?.allCommits);
  _snapshots = new StoreSubscriber(this, () => this._noteSynStore?.snapshots);
  _note = new StoreSubscriber(this, () =>
    this._notesStore?.note(this.noteHash)
  );

  @state()
  _fetchingSnapshot = false;

  _selectedCommitHash: EntryHashB64 | undefined;

  updated(changedValues: PropertyValues) {
    super.updated(changedValues);

    if (changedValues.has('noteHash') && this.noteHash) {
      this.connectSyn();
    }
  }

  async connectSyn() {
    if (this._noteSynStore) await this._noteSynStore.close();

    this._noteSynStore = await this._notesStore.openNote(this.noteHash);

    this._noteSynStore.activeSession.subscribe(activeSession => {
      if (
        activeSession &&
        activeSession.session.scribe === this._noteSynStore?.myPubKey
      ) {
        window.onbeforeunload = function () {
          return 'Are you sure you want to leave? Close the session before leaving to commit the changes.';
        };
      } else {
        window.onbeforeunload = function () {};
      }

      activeSession?.on('session-closed', () => {
        (
          this.shadowRoot?.getElementById('closed-session-message') as Snackbar
        ).show();
      });
    });

    await this._noteSynStore.fetchCommitHistory();
    if (Object.keys(this._allCommits.value).length > 0) {
      const [hash, _] = getLatestCommit(this._allCommits.value);
      await this.fetchSnapshot(hash);
    }
  }

  getMarkdownContent() {
    if (!this._selectedCommitHash) return undefined;

    const selectedCommit = this._allCommits.value[this._selectedCommitHash];
    return this._snapshots.value[selectedCommit.newContentHash].text;
  }

  async fetchSnapshot(commitHash: EntryHashB64) {
    this._fetchingSnapshot = true;
    this._selectedCommitHash = commitHash;

    const selectedCommit = this._allCommits.value[commitHash];

    await this._noteSynStore?.fetchSnapshot(selectedCommit.newContentHash);
    this._fetchingSnapshot = false;
  }

  renderNotInSessionContent() {
    return html`<div class="row" style="flex: 1;">
      <div class="column" style="flex: 1;">
        <syn-sessions style="flex: 1; margin: 16px; margin-bottom: 0;"></syn-sessions>
        <syn-commit-history
          style="flex: 1; margin: 16px;"
          .selectedCommitHash=${this._selectedCommitHash}
          @commit-selected=${(e: CustomEvent) =>
            this.fetchSnapshot(e.detail.commitHash)}
        ></syn-commit-history>
      </div>
      ${this._fetchingSnapshot
        ? this.renderLoading()
        : html`
            <mwc-card style="flex: 1;">
              <div class="flex-scrollable-parent">
                <div class="flex-scrollable-container">
                  <div class="flex-scrollable-y" style="padding: 0 8px;">
                    <markdown-renderer
                      style="flex: 1;"
                      .markdown=${this.getMarkdownContent()}
                    ></markdown-renderer>
                  </div>
                </div>
              </div>
            </mwc-card>

            <mwc-fab
              extended
              icon="edit"
              label="Start Session"
              style="
                margin: 16px;
                position: absolute;
                right: 0;
                bottom: 0;
              "
              @click=${() =>
                this._noteSynStore?.newSession(this._selectedCommitHash)}
            ></mwc-fab>
          `}
    </div> `;
  }

  renderInSessionContent() {
    return html`<div class="row" style="flex: 1;">
      <syn-folks style="margin: 4px;"></syn-folks>

      <syn-text-editor
        style="flex: 1;"
        .synSlice=${this._activeSession.value}
      ></syn-text-editor>

      <mwc-card style="flex: 1; margin-left: 4px;">
        <div class="flex-scrollable-parent">
          <div class="flex-scrollable-container">
            <div class="flex-scrollable-y" style="padding: 0 8px;">
              <markdown-renderer
                style="flex: 1; "
                .markdown=${this._state.value?.text}
              ></markdown-renderer>
            </div>
          </div>
        </div>
      </mwc-card>

      <mwc-fab
        extended
        icon="logout"
        .label=${this._noteSynStore?.myPubKey ===
        this._activeSession.value?.session.scribe
          ? 'Close Session'
          : 'Leave Session'}
        style="
                margin: 16px;
                position: absolute;
                right: 0;
                bottom: 0;
              "
        @click=${async () => {
          this._selectedCommitHash = this._lastCommitHash.value;
          const result = await this._activeSession.value?.leave();
          if (result && result.closingCommitHash)
            this._selectedCommitHash = result?.closingCommitHash;
        }}
      ></mwc-fab>
    </div>`;
  }

  renderSessionClosedMessage() {
    return html`<mwc-snackbar
      id="closed-session-message"
      labelText="Session was closed by the scribe"
    ></mwc-snackbar>`;
  }

  renderLoading() {
    return html`
      <div
        class="row"
        style="flex: 1; align-items: center; justify-contents: center"
      >
        <mwc-circular-progress indeterminate></mwc-circular-progress>
      </div>
    `;
  }

  render() {
    if (!this._noteSynStore) return this.renderLoading();
    return html`
      <syn-context .store=${this._noteSynStore}>
        ${this._activeSession.value
          ? this.renderInSessionContent()
          : this.renderNotInSessionContent()}
      </syn-context>
      ${this.renderSessionClosedMessage()}
    `;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._noteSynStore?.close();
  }

  static get scopedElements() {
    return {
      'markdown-renderer': MarkdownRenderer,
      'mwc-circular-progress': CircularProgress,
      'mwc-card': Card,
      'mwc-fab': Fab,
      'mwc-snackbar': Snackbar,
      'syn-text-editor': SynTextEditor,
      'syn-sessions': SynSessions,
      'syn-folks': SynFolks,
      'syn-commit-history': SynCommitHistory,
      'syn-context': SynContext,
    };
  }

  static styles = [sharedStyles];
}

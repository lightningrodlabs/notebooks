import { EntryHashB64 } from '@holochain-open-dev/core-types';
import { contextProvided, provide } from '@lit-labs/context';
import { ScopedElementsMixin } from '@open-wc/scoped-elements';
import { html, LitElement, PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import {
  SynContext,
  synContext,
  SynFolks,
  SynCommitHistory,
  SynSessions,
} from '@syn/elements';
import { SynTextEditor } from '@syn/text-editor';
import { StoreSubscriber } from 'lit-svelte-stores';
import { readable } from 'svelte/store';

import { notesStoreContext } from '../context';
import { NotesStore, NoteSynStore } from '../notes-store';
import { MarkdownRenderer } from '@scoped-elements/markdown-renderer';
import { sharedStyles } from '../shared-styles';
import {
  ProfilesStore,
  profilesStoreContext,
} from '@holochain-open-dev/profiles';
import { Card, CircularProgress, Fab } from '@scoped-elements/material-web';
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
  _content = new StoreSubscriber(
    this,
    () => this._activeSession.value?.content
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
    console.log(this._activeSession.value);
  }

  async connectSyn() {
    if (this._noteSynStore) await this._noteSynStore.close();

    this._noteSynStore = await this._notesStore.openNote(this.noteHash);

    await this._noteSynStore.fetchCommitHistory();
    if (Object.keys(this._allCommits.value).length > 0) {
      const [hash, _] = getLatestCommit(this._allCommits.value);
      await this.fetchSnapshot(hash);
    } else if (
      this._note.value &&
      this._note.value.creator === this._notesStore.myAgentPubKey
    ) {
      await this._noteSynStore.newSession();
    }
  }

  getMarkdownContent() {
    if (!this._selectedCommitHash) return undefined;

    const selectedCommit = this._allCommits.value[this._selectedCommitHash];
    return this._snapshots.value[selectedCommit.newContentHash];
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
        <syn-sessions style="flex: 1;"></syn-sessions>
        <syn-commit-history
          style="flex: 1;"
          .selectedCommitHash=${this._selectedCommitHash}
          @commit-selected=${(e: CustomEvent) =>
            this.fetchSnapshot(e.detail.commitHash)}
        ></syn-commit-history>
      </div>
      ${this._fetchingSnapshot
        ? this.renderLoading()
        : html`
            <mwc-card style="flex: 1; margin: 16px;">
              <markdown-renderer
                style="flex: 1;"
                .markdown=${this.getMarkdownContent()}
              ></markdown-renderer>
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
      <syn-folks></syn-folks>

      <syn-text-editor
        style="flex: 1;"
        @changes-requested=${(e: CustomEvent) =>
          this._activeSession.value?.requestChanges({
            deltas: e.detail.deltas,
            ephemeral: e.detail.ephemeral,
          })}
      ></syn-text-editor>

      <mwc-card style="flex: 1; margin: 16px;">
        <markdown-renderer
          style="flex: 1;"
          .markdown=${this._content.value}
        ></markdown-renderer>
      </mwc-card>
      <mwc-fab
        extended
        icon="logout"
        label="Leave Session"
        style="
                margin: 16px;
                position: absolute;
                right: 0;
                bottom: 0;
              "
        @click=${() => this._activeSession.value?.leave()}
      ></mwc-fab>
    </div>`;
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
      'syn-text-editor': SynTextEditor,
      'syn-sessions': SynSessions,
      'syn-folks': SynFolks,
      'syn-commit-history': SynCommitHistory,
      'syn-context': SynContext,
    };
  }

  static styles = [sharedStyles];
}

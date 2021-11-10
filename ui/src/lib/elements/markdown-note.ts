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
import { CircularProgress } from '@scoped-elements/material-web';
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

    const sessions = await this._noteSynStore.getAllSessions();

    if (Object.keys(sessions).length > 0) {
      await this._noteSynStore.joinSession(Object.keys(sessions)[0]);
    } else {
      await this._noteSynStore.fetchCommitHistory();
      if (Object.keys(this._allCommits.value).length > 0) {
        const [hash, _] = getLatestCommit(this._allCommits.value);
        await this.fetchSnapshot(hash);
      } else {
        await this._noteSynStore.newSession();
      }
    }
  }

  getMarkdownContent() {
    if (this._content.value) return this._content.value;
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

  render() {
    if (!this._noteSynStore) return html`Loading...`;
    return html`
      <syn-context .store=${this._noteSynStore}>
        <div class="row" style="flex: 1;">
          ${this._activeSession.value
            ? html`
                <syn-text-editor
                  style="flex: 1;"
                  @changes-requested=${(e: CustomEvent) =>
                    this._activeSession.value?.requestChanges({
                      deltas: e.detail.deltas,
                    })}
                ></syn-text-editor>
              `
            : html``}
          ${this._fetchingSnapshot
            ? html`
                <div
                  class="row"
                  style="flex: 1; align-items: center; justify-contents: center"
                >
                  <mwc-circular-progress indeterminate></mwc-circular-progress>
                </div>
              `
            : html`
                <markdown-renderer
                  style="flex: 1;"
                  .markdown=${this.getMarkdownContent()}
                ></markdown-renderer>
              `}
          <div class="column" style="width: 400px">
            <syn-folks style="flex: 1;"></syn-folks>
            <syn-commit-history
              style="flex: 1;"
              @commit-selected=${(e: CustomEvent) =>
                this.fetchSnapshot(e.detail.commitHash)}
            ></syn-commit-history>
          </div>
        </div>
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
      'syn-text-editor': SynTextEditor,
      'syn-sessions': SynSessions,
      'syn-folks': SynFolks,
      'syn-commit-history': SynCommitHistory,
      'syn-context': SynContext,
    };
  }

  static styles = [sharedStyles];
}

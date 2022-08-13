import { deserializeHash, EntryHashB64 } from '@holochain-open-dev/core-types';
import { contextProvided } from '@lit-labs/context';
import { ScopedElementsMixin } from '@open-wc/scoped-elements';
import { html, LitElement, PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import {
  SynContext,
  WorkspaceParticipants,
  SynCommitHistory,
  WorkspaceStore,
  SynStore,
  Commit,
} from '@holochain-syn/core';
import {
  SynMarkdownEditor,
  TextEditorDeltaType,
  textEditorGrammar,
  TextEditorGrammar,
} from '@holochain-syn/text-editor';
import { decode } from '@msgpack/msgpack';
import { StoreSubscriber, TaskSubscriber } from 'lit-svelte-stores';
import { MarkdownRenderer } from '@scoped-elements/markdown-renderer';
import {
  Card,
  CircularProgress,
  Fab,
  Snackbar,
  MenuSurface,
  List,
  ListItem,
} from '@scoped-elements/material-web';
import { readable } from 'svelte/store';
import { EntryHashMap, serializeHash } from '@holochain-open-dev/utils';
import { EntryHash } from '@holochain/client';

import { notesStoreContext } from '../context';
import { NotesStore } from '../notes-store';
import { sharedStyles } from '../shared-styles';

import { getLatestCommit } from './utils';
import { NoteWithBacklinks } from '../types';
import { WorkspaceList } from './workspace-list';

export class MarkdownNote extends ScopedElementsMixin(LitElement) {
  @property()
  noteHash!: EntryHashB64;

  @contextProvided({ context: notesStoreContext })
  _notesStore!: NotesStore;

  @state()
  _noteSynStore: SynStore | undefined;

  @state()
  _workspaceStore: WorkspaceStore<TextEditorGrammar> | undefined;

  _lastCommitHash = new StoreSubscriber(
    this,
    () => this._workspaceStore?.currentTip
  );

  _myNoteTitles = new StoreSubscriber(
    this,
    () => this._notesStore.notesCreatedByMe
  );

  _othersNoteTitles = new StoreSubscriber(
    this,
    () => this._notesStore.notesCreatedByOthers
  );

  _state = new StoreSubscriber(this, () => this._workspaceStore?.state);

  _allCommits: TaskSubscriber<any, EntryHashMap<Commit>> = new TaskSubscriber(
    this,
    async () =>
      this._noteSynStore ? this._noteSynStore.fetchAllCommits() : readable()
  );

  _note = new StoreSubscriber(this, () =>
    this._notesStore?.note(this.noteHash)
  );

  @state()
  _fetchingSnapshot = false;

  @state()
  _noteLinkModalOpen = false;

  _selectedCommitHash: EntryHashB64 | undefined;

  updated(changedValues: PropertyValues) {
    super.updated(changedValues);

    if (changedValues.has('noteHash') && this.noteHash) {
      this.connectSyn();
    }
  }

  async connectSyn() {
    if (this._workspaceStore) {
      await this._workspaceStore.leaveWorkspace();
    }

    this._noteSynStore = await this._notesStore.openNote(this.noteHash);

    await this._allCommits.run();
    if (this._allCommits.value && this._allCommits.value.keys().length > 0) {
      this._selectedCommitHash = serializeHash(
        getLatestCommit(this._allCommits.value)[0]
      );
    } else {
      this._selectedCommitHash = undefined;
    }
  }

  async joinWorskpace(workspaceHash: EntryHash) {
    this._workspaceStore = await this._noteSynStore?.joinWorkspace(
      workspaceHash,
      textEditorGrammar
    );
    window.onbeforeunload = () =>
      'Are you sure you want to leave? Leave the workspace before leaving to commit the changes.';
  }

  async leaveWorkspace() {
    await this._workspaceStore?.leaveWorkspace();
    window.onbeforeunload = () => undefined;
    this._workspaceStore = undefined;
  }

  getMarkdownContent() {
    if (!this._selectedCommitHash) return this.insertBacklinks('');

    const selectedCommit: Commit | undefined = (
      this._allCommits as any
    ).value?.get(deserializeHash(this._selectedCommitHash));
    if (!selectedCommit) return this.insertBacklinks('');

    return this.insertBacklinks(
      this.replaceLinks((decode(selectedCommit.state) as any).text.toString())
    );
  }

  hashLookup(a: any, b: any) {
    const entryHash = this._note.value.backlinks.linksTo[b];
    if (entryHash) {
      return `[${b}](/#/note/${entryHash})`;
    }
    return `[[${b}]]`;
  }

  replaceLinks(text = '') {
    const backlinks = this._note.value.backlinks.linksTo;
    return text.replace(/\[\[([^\]]*)\]\]/g, (a, b) => {
      const entryHash = backlinks[b];
      if (entryHash) {
        return `[${b}](/#/note/${entryHash})`;
      }
      return `[[${b}]]`;
    });
  }

  insertBacklinks(text = '') {
    const backlinks = this._note.value.backlinks.linkedFrom;
    let backlinkList = '';
    for (const title of Object.keys(backlinks)) {
      backlinkList += `- [${title}](/#/note/${backlinks[title]})\n`;
    }
    return `${text}\n\n\r---\n## backlinks\n\n${backlinkList}`;
  }

  renderNotInSessionContent() {
    return html`<div class="row" style="flex: 1;">
      <div class="column" style="flex: 1;">
        <workspace-list
          style="flex: 1; margin: 16px; margin-bottom: 0;"
          @join-workspace=${(e: CustomEvent) =>
            this.joinWorskpace(e.detail.workspaceHash)}
        ></workspace-list>
        <syn-commit-history
          style="flex: 1; margin: 16px;"
          .selectedCommitHash=${this._selectedCommitHash}
          @commit-selected=${(e: CustomEvent) => {
            this._selectedCommitHash = e.detail.commitHash;
          }}
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
          `}
    </div> `;
  }

  renderInSessionContent(workspaceStore: WorkspaceStore<TextEditorGrammar>) {
    return html`<div class="row" style="flex: 1;">
      <syn-folks style="margin: 4px;"></syn-folks>

      <syn-markdown-editor
        style="flex: 1;"
        .slice=${workspaceStore}
        @text-inserted=${(e: any) => {
          if (e.detail.text === '[]') {
            workspaceStore.requestChanges([
              {
                type: TextEditorDeltaType.ChangeSelection,
                position: e.detail.from + 1,
                characterCount: 0,
              },
            ]);
            const text = this._state.value?.text;
            const position = e.detail.from;
            if (text[position - 1] === '[' && text[position] === ']') {
              const menuSurface = this.shadowRoot?.getElementById(
                'title-search-modal'
              ) as MenuSurface;
              menuSurface.x = e.detail.coords.left + 20;
              menuSurface.y = e.detail.coords.top + 20;
              menuSurface.show();
            }
          }
        }}
      ></syn-markdown-editor>
      <mwc-menu-surface relative id="title-search-modal">
        <mwc-list>
          ${Object.values(this._myNoteTitles.value).map(
            (note: NoteWithBacklinks) =>
              html`<mwc-list-item>${note.title}</mwc-list-item>`
          )}
          ${Object.values(this._othersNoteTitles.value).map(
            (note: NoteWithBacklinks) =>
              html`<mwc-list-item>${note.title}</mwc-list-item>`
          )}
        </mwc-list>
      </mwc-menu-surface>

      <mwc-card style="flex: 1; margin-left: 4px;">
        <div class="flex-scrollable-parent">
          <div class="flex-scrollable-container">
            <div class="flex-scrollable-y" style="padding: 0 8px;">
              <markdown-renderer
                style="flex: 1; "
                .markdown=${this.insertBacklinks(
                  this.replaceLinks(this._state.value?.text.toString())
                )}
              ></markdown-renderer>
            </div>
          </div>
        </div>
      </mwc-card>

      <mwc-fab
        extended
        icon="logout"
        label="Leave Workspace"
        style="
                margin: 16px;
                position: absolute;
                right: 0;
                bottom: 0;
              "
        @click=${async () => {
          this._selectedCommitHash = serializeHash(this._lastCommitHash.value);
          const text = this._state.value?.text;
          await this.leaveWorkspace();
          /*           if (result && result.closingCommitHash)
            this._selectedCommitHash = result?.closingCommitHash;
 */ // TODO, handle unhappy path
          this._notesStore.service.parseAndUpdateNoteLinks({
            note: this.noteHash,
            contents: text.toString(),
          });
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
        ${this._workspaceStore
          ? this.renderInSessionContent(this._workspaceStore)
          : this.renderNotInSessionContent()}
      </syn-context>
      ${this.renderSessionClosedMessage()}
    `;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.leaveWorkspace();
  }

  static get scopedElements() {
    return {
      'markdown-renderer': MarkdownRenderer,
      'mwc-circular-progress': CircularProgress,
      'mwc-card': Card,
      'mwc-fab': Fab,
      'mwc-snackbar': Snackbar,
      'syn-markdown-editor': SynMarkdownEditor,
      'workspace-list': WorkspaceList,
      'workspace-participants': WorkspaceParticipants,
      'syn-commit-history': SynCommitHistory,
      'syn-context': SynContext,
      'mwc-menu-surface': MenuSurface,
      'mwc-list': List,
      'mwc-list-item': ListItem,
    };
  }

  static styles = [sharedStyles];
}

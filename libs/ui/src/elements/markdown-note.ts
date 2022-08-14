import { deserializeHash, EntryHashB64 } from '@holochain-open-dev/core-types';
import {
  contextProvided,
  ContextProvider,
  contextProvider,
} from '@lit-labs/context';
import { ScopedElementsMixin } from '@open-wc/scoped-elements';
import { ref } from 'lit/directives/ref.js';
import { html, LitElement, PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import {
  SynContext,
  WorkspaceParticipants,
  CommitHistory,
  WorkspaceStore,
  SynStore,
  Commit,
  Workspace,
  synContext,
} from '@holochain-syn/core';
import {
  SynMarkdownEditor,
  TextEditorDeltaType,
  textEditorGrammar,
} from '@holochain-syn/text-editor';
import Automerge from 'automerge';
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
  Drawer,
  Button,
  Dialog,
  TextField,
} from '@scoped-elements/material-web';
import { readable } from 'svelte/store';
import { EntryHashMap } from '@holochain-open-dev/utils';
import { Task } from '@lit-labs/task';

import { notesStoreContext } from '../context';
import { NotesStore } from '../notes-store';
import { sharedStyles } from '../shared-styles';

import { NoteWithBacklinks } from '../types';
import { WorkspaceList } from './workspace-list';

export class MarkdownNote extends ScopedElementsMixin(LitElement) {
  @property()
  noteHash!: EntryHashB64;

  @contextProvided({ context: notesStoreContext })
  _notesStore!: NotesStore;

  _synStore = new ContextProvider(this, synContext, undefined);

  _noteSynStore = new Task(
    this,
    async () => {
      if (this._workspaceStore.value) await this.leaveWorkspace();
      const synStore = await this._notesStore.openNote(this.noteHash);
      this._synStore.setValue(synStore);
      return synStore;
    },
    () => [this.noteHash]
  );

  _allWorkspaces = new TaskSubscriber<any, EntryHashMap<Workspace>>(
    this,
    async () =>
      this._noteSynStore.value
        ? this._noteSynStore.value.fetchAllWorkspaces()
        : readable(new EntryHashMap()),
    () => [this._noteSynStore.value]
  );

  @state()
  _workspaceName: string = 'main';

  _workspaceStore = new Task(
    this,
    async () => {
      if (!this._noteSynStore.value || !this._allWorkspaces.value)
        return undefined;

      const workspace = this._allWorkspaces.value
        ?.entries()
        .find(([_h, w]) => w.name === this._workspaceName);

      if (!workspace) return undefined;

      return this._noteSynStore.value.joinWorkspace(
        workspace[0],
        textEditorGrammar
      );
    },
    () => [this._allWorkspaces.value, this._workspaceName]
  );

  _lastCommitHash = new StoreSubscriber(
    this,
    () => this._workspaceStore.value?.currentTip
  );

  _myNoteTitles = new StoreSubscriber(
    this,
    () => this._notesStore.notesCreatedByMe
  );

  _othersNoteTitles = new StoreSubscriber(
    this,
    () => this._notesStore.notesCreatedByOthers
  );

  _state = new StoreSubscriber(this, () => this._workspaceStore.value?.state);

  _allCommits: TaskSubscriber<any, EntryHashMap<Commit>> = new TaskSubscriber(
    this,
    async () =>
      this._noteSynStore.value
        ? this._noteSynStore.value.fetchAllCommits()
        : readable(),
    () => [this._noteSynStore.value]
  );

  _note = new StoreSubscriber(this, () =>
    this._notesStore?.note(this.noteHash)
  );

  @state()
  _noteLinkModalOpen = false;

  @state()
  _selectedCommitHash: EntryHashB64 | undefined;

  async leaveWorkspace() {
    await this._workspaceStore.value?.leaveWorkspace();
  }

  getMarkdownContent(allCommits: EntryHashMap<Commit>) {
    if (!this._selectedCommitHash) return '';
    const selectedCommit: Commit | undefined = allCommits.get(
      deserializeHash(this._selectedCommitHash)
    );
    if (!selectedCommit) return '';

    return (
      Automerge.load(decode(selectedCommit.state) as any) as any
    ).text.toString();
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

  @state()
  _newWorkspaceName: string | undefined;

  renderNewWorkspaceButton() {
    return html` <mwc-button
        style="flex: 1"
        .disabled=${this._selectedCommitHash === undefined}
        raised
        label="Create Workspace From This Commit"
        @click=${() => {
          (
            this.shadowRoot?.getElementById('new-workspace-dialog') as Dialog
          ).show();
        }}
      ></mwc-button>

      <mwc-dialog heading="Create Workspace" id="new-workspace-dialog">
        <mwc-textfield
          label="Title"
          id="new-workspace-name"
          required
          autoValidate
          outlined
          @input=${(e: CustomEvent) => {
            this._newWorkspaceName = (e.target as any).value;
          }}
        ></mwc-textfield>

        <mwc-button slot="secondaryAction" dialogAction="cancel">
          Cancel
        </mwc-button>

        <mwc-button
          slot="primaryAction"
          dialogAction="create"
          .disabled=${this._newWorkspaceName === undefined ||
          this._allWorkspaces.value
            ?.entries()
            .find(([_, w]) => w.name === this._newWorkspaceName)}
          @click=${async () => {
            setTimeout(async () => {
              if (this._workspaceStore.value) await this.leaveWorkspace();

              await this._noteSynStore.value?.createWorkspace(
                { name: this._newWorkspaceName as string, meta: undefined },
                deserializeHash(this._selectedCommitHash as string)
              );

              (this.shadowRoot?.getElementById('drawer') as Drawer).open =
                false;
              this._workspaceName = this._newWorkspaceName as string;
            });
          }}
        >
          Create
        </mwc-button>
      </mwc-dialog>`;
  }

  renderVersionControlPanel() {
    return html`<div class="row" style="flex: 1; height: 88%">
      <div class="column" style="width: 400px;">
        <workspace-list
          style="flex: 1; margin: 16px; margin-bottom: 0;"
          @join-workspace=${async (e: CustomEvent) => {
            if (this._workspaceStore.value) await this._workspaceStore.value.leaveWorkspace();
            this._workspaceName = e.detail.workspace.name;
            (this.shadowRoot?.getElementById('drawer') as Drawer).open = false;
          }}
        ></workspace-list>
        <commit-history
          style="margin: 16px; flex: 1"
          .selectedCommitHash=${this._selectedCommitHash}
          @commit-selected=${(e: CustomEvent) => {
            this._selectedCommitHash = e.detail.commitHash;
          }}
        ></commit-history>
      </div>
      ${this._allCommits.render({
        pending: () => this.renderLoading(),
        complete: allCommits =>
          html`
            <div class="column" style="flex: 1">
              <mwc-card style="flex: 1;">
                <div class="flex-scrollable-parent">
                  <div class="flex-scrollable-container">
                    <div class="flex-scrollable-y" style="padding: 0 8px;">
                      <markdown-renderer
                        style="flex: 1;"
                        .markdown=${this.getMarkdownContent(allCommits)}
                      ></markdown-renderer>
                    </div>
                  </div>
                </div>
              </mwc-card>
              <div class="row">${this.renderNewWorkspaceButton()}</div>
            </div>
          `,
      })}
    </div> `;
  }

  renderNoteWorkspace() {
    return this._workspaceStore.render({
      pending: () => this.renderLoading(),
      complete: workspaceStore =>
        workspaceStore
          ? html`
              <mwc-drawer
                style="flex: 1; --mdc-drawer-width: 1200px;"
                type="modal"
                id="drawer"
              >
                ${this.renderVersionControlPanel()}
                <div
                  slot="appContent"
                  class="column"
                  style="flex: 1; height: 100%"
                >
                  <div
                    class="row"
                    style="align-items: center; background-color: white"
                  >
                    <mwc-button
                      icon="account_tree"
                      .label=${this._workspaceName}
                      raised
                      @click=${() => {
                        (
                          this.shadowRoot?.getElementById('drawer') as Drawer
                        ).open = true;
                        this._allCommits.run();
                      }}
                    ></mwc-button>
                    <span style="flex:1"></span>

                    <workspace-participants
                      direction="row"
                      .workspacestore=${this._workspaceStore.value}
                      style="margin: 4px;"
                    ></workspace-participants>
                  </div>
                  <div class="row" style="flex: 1;">
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
                          if (
                            text[position - 1] === '[' &&
                            text[position] === ']'
                          ) {
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
                          <div
                            class="flex-scrollable-y"
                            style="padding: 0 8px;"
                          >
                            <markdown-renderer
                              style="flex: 1; "
                              .markdown=${this._state.value?.text.toString()}
                            ></markdown-renderer>
                          </div>
                        </div>
                      </div>
                    </mwc-card>
                  </div>
                </div>
              </mwc-drawer>
            `
          : this.renderLoading(),
    });
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

  renderNoRootFound() {
    return html`
      <div
        class="row"
        style="flex: 1; align-items: center; justify-content: center"
      >
        <span class="placeholder"
          >The note was not found. Try again when one of its past contributors
          is online.</span
        >
      </div>
    `;
  }

  render() {
    return this._noteSynStore.render({
      pending: () => this.renderLoading(),
      complete: () =>
        this._allWorkspaces.render({
          pending: () => this.renderLoading(),
          complete: workspaces =>
            workspaces && workspaces.keys().length > 0
              ? this.renderNoteWorkspace()
              : this.renderNoRootFound(),
        }),
    });
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
      'mwc-drawer': Drawer,
      'mwc-dialog': Dialog,
      'mwc-textfield': TextField,
      'mwc-button': Button,
      'mwc-snackbar': Snackbar,
      'syn-markdown-editor': SynMarkdownEditor,
      'workspace-list': WorkspaceList,
      'workspace-participants': WorkspaceParticipants,
      'commit-history': CommitHistory,
      'syn-context': SynContext,
      'mwc-menu-surface': MenuSurface,
      'mwc-list': List,
      'mwc-list-item': ListItem,
    };
  }

  static styles = [sharedStyles];
}

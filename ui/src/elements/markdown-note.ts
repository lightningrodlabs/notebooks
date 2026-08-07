import { EntryRecord } from "@holochain-open-dev/utils";
import { consume } from "@lit/context";
import { css, html, LitElement, PropertyValueMap } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import {
  Workspace,
  DocumentStore,
  WorkspaceStore,
  SynStore,
  synContext,
  synDocumentContext,
  SessionStore,
  SynConfig,
} from "@holochain-syn/core";
import { MarkdownRenderer } from "@scoped-elements/markdown-renderer";

import "@holochain-syn/core/dist/elements/syn-context.js";
import "@holochain-syn/core/dist/elements/session-participants.js";
import "./commit-history";
import "./diff-viewer";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";
import "@shoelace-style/shoelace/dist/components/input/input.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/icon-button/icon-button.js";
import "@shoelace-style/shoelace/dist/components/button-group/button-group.js";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/dialog/dialog.js";
import "@shoelace-style/shoelace/dist/components/split-panel/split-panel.js";
import "@shoelace-style/shoelace/dist/components/icon-button/icon-button.js";
import '@shoelace-style/shoelace/dist/components/radio-group/radio-group.js';
import '@shoelace-style/shoelace/dist/components/radio-button/radio-button.js';
import "@holochain-open-dev/profiles/dist/elements/agent-avatar.js";
import "./workspace-list";
import "@shoelace-style/shoelace/dist/components/badge/badge.js";
import "@shoelace-style/shoelace/dist/components/drawer/drawer.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import "./session-status"
import "./syn-md-editor";

import { Profile, ProfilesStore, profilesStoreContext } from '@holochain-open-dev/profiles';


import {
  hashState,
  notifyError,
  onSubmit,
  sharedStyles,
  wrapPathInSvg,
} from "@holochain-open-dev/elements";
import { ActionHash, encodeHashToBase64, EntryHash, HoloHashMap } from "@holochain/client";
import {
  asyncDerived,
  completed,
  joinAsyncMap,
  mapAndJoin,
  pipe,
  StoreSubscriber,
  subscribe,
} from "@holochain-open-dev/stores";
import { SlChangeEvent, SlDialog, SlDrawer, SlRadioGroup } from "@shoelace-style/shoelace";
import { msg } from "@lit/localize";
import { decode } from "@msgpack/msgpack";
import { Marked } from "@ts-stack/markdown";
import { mdiArrowLeft, mdiBookOpenOutline, mdiEye, mdiPencil, mdiClose, mdiGrid, mdiDotsGrid, mdiUndoVariant, mdiRedoVariant } from "@mdi/js";
import { isWeaveContext, WAL } from "@theweave/api";
import {
  TextEditorEphemeralState,
  TextEditorState,
} from "../grammar";
import { NoteMeta } from "../types.js";
import { notebooksContext, NotebooksStore } from "../store";
import { renderAsyncStatus } from "../utils.js";

enum View {
  Edit,
  Both,
  View
}

interface HistoryTypes {
  linear: boolean;
  commit: boolean;
  workspaces: boolean;
}

type EditorHistoryState = {
  canUndo: boolean;
  canRedo: boolean;
};

const POCKET_ICON=`<svg width="20" height="20" viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M74.2273 83.9C71.7318 83.9 69.3386 84.8956 67.574 86.6678C65.8095 88.4401 64.8182 90.8437 64.8182 93.35V150.05C64.8182 172.607 73.74 194.239 89.6209 210.189C105.502 226.139 127.041 235.1 149.5 235.1C196.27 235.1 234.182 197.023 234.182 150.05V93.35C234.182 90.8437 233.191 88.4401 231.426 86.6678C229.661 84.8956 227.268 83.9 224.773 83.9H74.2273ZM54.2676 73.3035C59.5612 67.9869 66.7409 65 74.2273 65H224.773C232.259 65 239.439 67.9869 244.732 73.3035C250.026 78.6202 253 85.8311 253 93.35V150.05C253 207.461 206.663 254 149.5 254C122.05 254 95.7245 243.048 76.3144 223.554C56.9044 204.059 46 177.619 46 150.05V93.35C46 85.8311 48.9739 78.6202 54.2676 73.3035Z" fill="black"/><path d="M188.841 141.469H158.596V110.124C158.596 105.635 154.961 102 150.474 102C145.986 102 142.351 105.635 142.351 110.124V141.469H110.085C105.635 141.469 102 145.104 102 149.593C102 154.081 105.635 157.717 110.122 157.717H142.388V188.876C142.388 193.365 146.023 197 150.511 197C154.998 197 158.633 193.365 158.633 188.876V157.717H188.878C193.365 157.717 197 154.081 197 149.593C196.944 145.104 193.328 141.469 188.841 141.469Z" fill="black"/></svg>`
customElements.define("markdown-renderer", MarkdownRenderer);

const WORKSPACE_NOT_FOUND = "The requested workspace was not found";

const SYN_CONFIG: Partial<SynConfig> = {
  heartbeatInterval: 5 * 1000,
  inactiveSessionThreshold: 20 * 1000,
  newPeersDiscoveryInterval: 30 * 1000,
  outOfSessionTimeout: 60 * 1000,
  commitStrategy: { CommitEveryNDeltas: 200, CommitEveryNMs: 1000 * 30, SnapshotEveryNCommits: 20 }, // TODO: reduce ms
}

@customElement("markdown-note")
export class MarkdownNote extends LitElement {
  @consume({ context: synDocumentContext, subscribe: true })
  @property()
  documentStore!: DocumentStore<TextEditorState, TextEditorEphemeralState>;

  @consume({ context: notebooksContext, subscribe: true })  
  @property()
  notebooksStore!: NotebooksStore;

  @consume({ context: profilesStoreContext, subscribe: true })
  profilesStore!: ProfilesStore;

  @property()
  standalone = false

  @state()
  _renderDrawer = false

  @state()
  _historyTypes: HistoryTypes = {
    workspaces: false,
    linear: true,
    commit: false,
  };

  @state()
  _diffView: boolean = false;

  _meta = new StoreSubscriber(
    this,
    () =>
      pipe(
        this.documentStore.record,
        (document) => decode(document.entry.meta!) as NoteMeta
      ),
    () => [this.documentStore]
  );

  _session = new StoreSubscriber(
    this,
    () =>
      pipe(
        this.documentStore.allWorkspaces,
        (map) => mapAndJoin(map as unknown as HoloHashMap<Uint8Array, WorkspaceStore<TextEditorState, TextEditorEphemeralState>>, (w) => w.name),
        (allWorkspaces) => {
          const workspace: [EntryHash, String] | undefined = Array.from(
            allWorkspaces.entries() as IterableIterator<[EntryHash, string]>
          ).find(([hash, name]) => name === this._workspaceName);

          if (!workspace) throw new Error(WORKSPACE_NOT_FOUND);
          return this.documentStore.workspaces.get(workspace[0]);
        },
        (workspaceStore) => workspaceStore!.session,
        (sessionStore, w) => {
          if (sessionStore) {
            return sessionStore;
          }
          
          // Only join session if not already joining
          if (!this._joiningSession) {
            this._joiningSession = true;
            console.log("joining session for workspace", this._workspaceName);
            
            const sessionPromise = w!.joinSession(SYN_CONFIG);
            sessionPromise.finally(() => {
              this._joiningSession = false;
            });
            
            return sessionPromise;
          }
          
          return undefined;
        },
        (s) => s?.state,
        (state, sessionStore) =>
          sessionStore && state ? [sessionStore, state] as [
            SessionStore<TextEditorState, TextEditorEphemeralState>,
            TextEditorState
          ] : undefined
      ),
    () => [this.documentStore, this._workspaceName]
  );

  @state()
  _workspaceName: string = "main";

  @state()
  _view: View = View.Both

  @state(hashState())
  _selectedCommitHash: ActionHash | undefined;

  @state()
  creatingWorkspace = false;

  @state()
  _joiningSession = false;

  @state()
  _editorHistoryState: EditorHistoryState = {
    canUndo: false,
    canRedo: false,
  };

  async createWorkspace(
    name: string,
    initialTipHash: EntryHash,
    sessionStore: SessionStore<TextEditorState, TextEditorEphemeralState>
  ) {
    if (this.creatingWorkspace) return;

    this.creatingWorkspace = true;

    await sessionStore.commitChanges();
    await sessionStore.leaveSession();
    console.log("left session, creating workspace");
    try {
      await this.documentStore.createWorkspace(name, initialTipHash);
      (
        this.shadowRoot?.getElementById("new-workspace-dialog") as SlDialog
      )?.hide();
      this._joiningSession = false;
      this._workspaceName = name;
    } catch (e) {
      notifyError(msg("Error creating the workspace"));
      console.error(e);
    }
    this.creatingWorkspace = false;
  }

  renderNewWorkspaceButton(
    sessionStore: SessionStore<TextEditorState, TextEditorEphemeralState>
  ) {
    return html` 
      <sl-button
        style="flex: 1"
        .disabled=${this._selectedCommitHash === undefined}
        variant="primary"
        @click=${() => {
        (
          this.shadowRoot?.getElementById("new-workspace-dialog") as SlDialog
        ).show();
      }}
      >
        ${msg("Create Workspace From This Commit")}
      </sl-button>

      <sl-dialog .label=${msg("Create Workspace")} id="new-workspace-dialog"
        ><form
          ${onSubmit((f) => {
            this.createWorkspace(
              f.name,
              this._selectedCommitHash!,
              sessionStore
            )
            this._historyTypes.workspaces = true;
          }
      )}
          id="new-workspace-form"
        >
          <sl-input
            .label=${msg("Name")}
            id="new-workspace-name"
            required
            name="name"
          ></sl-input>
        </form>

        <sl-button
          slot="footer"
          @click=${() =>
        (
          this.shadowRoot?.getElementById(
            "new-workspace-dialog"
          ) as SlDialog
        ).hide()}
        >
          ${msg("Cancel")}
        </sl-button>

        <sl-button
          slot="footer"
          type="submit"
          form="new-workspace-form"
          .loading=${this.creatingWorkspace}
        >
          ${msg("Create")}
        </sl-button>
      </sl-dialog>
    `;
  }

  get drawer() {
    return this.shadowRoot?.getElementById("drawer") as SlDrawer;
  }

  renderSelectedCommitDiff() {
    if (!this._selectedCommitHash)
      return html`<div class="column center-content" style="flex:1">
        <span>${msg("Select a commit to see its contents")}</span>
      </div>`;
    
    switch (this._session.value.status) {
      case "pending":
        return this.renderLoading();
      case "complete":
        const sessionValue = this._session.value.value;
        if (!sessionValue || !sessionValue[1]) {
          return this.renderLoading();
        }
        return html`
          <diff-viewer
            .selectedCommitHash=${this._selectedCommitHash}
            .currentState=${sessionValue[1]}
            style="flex: 1; height: 100%;"
          ></diff-viewer>
        `;
      case "error":
        return html`<div class="column center-content" style="flex:1">
          <span>${msg("Error loading session for diff")}</span>
        </div>`;
    }
  }

  renderSelectedCommit() {
    if (!this._selectedCommitHash)
      return html`<div class="column center-content" style="flex:1">
        <span>${msg("Select a commit to see its contents")}</span>
      </div>`;

    return html`${subscribe(
      asyncDerived(
        this.documentStore.commits.get(this._selectedCommitHash)!,
        // Commits may be deltas, so the state has to be resolved by walking
        // back to the nearest snapshot ancestor rather than read off the entry
        async (commit) => ({
          commit,
          state: (await this.documentStore.resolveCommitState(
            commit
          )) as TextEditorState,
        })
      ),
      renderAsyncStatus({
        complete: ({ commit, state }) => html` <div class="flex-scrollable-parent" style="height:100%; overflow-x: hidden;">
          <div class="flex-scrollable-y" style="width:100%; overflow-x: hidden;">
            <sl-card style="max-width: 100%; overflow-x: hidden;">
              <div slot="header">Commit: ${this._selectedCommitHash ? encodeHashToBase64(this._selectedCommitHash):""}</div>
              <div slot="header">
                <span style="display:flex;align-items:center">by ${subscribe(this.profilesStore.profiles.get(commit.action.header.author)!,
                renderAsyncStatus({
                  complete: (v) => html`<agent-avatar style="margin-left:5px;margin-right:5px;" size="20" .agentPubKey=${v?.action.header.author}></agent-avatar> ${v?.entry.nickname}`,
                  pending: () => this.renderLoading(),
                  error: (e) => html`<display-error
                    .headline=${msg("Error fetching the author")}
                    .error=${e}
                    ></display-error>`,
                    })
                  )}
                  on ${(new Date(commit.action.header.timestamp)).toLocaleDateString()} ${(new Date(commit.action.header.timestamp)).toLocaleTimeString()}
                </span>

              </div>

              <div class="commit-content">
                ${unsafeHTML(Marked.parse(state.text.join('')))}
              </div>
            </sl-card>
          </div>
        </div>`,
        pending: () => this.renderLoading(),
        error: (e) => html`<display-error
          .headline=${msg("Error fetching the commit")}
          .error=${e}
        ></display-error>`,
      })
    )}`;
  }

  renderVersionControlPanel(
    sessionStore: SessionStore<TextEditorState, TextEditorEphemeralState>
  ) {
    return html`<div class="row" style="flex: 1; height: 100%;">
      <div class="column" style="width: 100%;">
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px; background-color: white;">
          <div>
            <sl-button value="workspaces"
              @click=${() => {
                this._historyTypes = {
                  ...this._historyTypes,
                  workspaces: !this._historyTypes.workspaces,
                }
              }}
              class=${this._historyTypes.workspaces ? "active" : ""}
            >
            <sl-icon .src=${wrapPathInSvg(mdiEye)} style="margin-right: 4px;"></sl-icon>
            ${msg("Workspaces")}</sl-button>
            <sl-button value="linear"
              @click=${() => {
                this._historyTypes = {
                  ...this._historyTypes,
                  linear: !this._historyTypes.linear,
                }
              }}
              class=${this._historyTypes.linear ? "active" : ""}
            >
            <sl-icon .src=${wrapPathInSvg(mdiEye)} style="margin-right: 4px;"></sl-icon>
            ${msg("History")}</sl-button>
            <sl-button value="commit"
              @click=${() => {
                this._historyTypes = {
                  ...this._historyTypes,
                  commit: !this._historyTypes.commit,
                }
              }}
              class=${this._historyTypes.commit ? "active" : ""}
            >
            <sl-icon .src=${wrapPathInSvg(mdiEye)} style="margin-right: 4px;"></sl-icon>
            ${msg("Commit")}</sl-button>
          </div>

          <sl-icon-button
            .src=${wrapPathInSvg(mdiClose)}
            label=${msg("Close")}
            @click=${() => {
              this._renderDrawer = false;
            }}
          ></sl-icon-button>
        </div>

        <sl-split-panel position=${ this._historyTypes.workspaces && 
          (this._historyTypes.linear || this._historyTypes.commit) ? "20" : "100"} 
          style="flex: 1; height: 100%;"
        vertical>
          ${ this._historyTypes.workspaces ? html`
            <workspace-list
            slot="start"
            style="flex: 1; height: 100%;"
            .activeWorkspace=${this._workspaceName}
            @join-workspace=${async (e: CustomEvent) => {
              await sessionStore.commitChanges();
              await sessionStore.leaveSession();
              console.log("left session");
              this._joiningSession = false;
              this._workspaceName = e.detail.workspaceName;
            }}
            ></workspace-list>
          ` : ""}
          ${ (this._historyTypes.commit || this._historyTypes.linear) ? html`
            <div class="row" slot=${ this._historyTypes.workspaces ? "end" : "start" } style="height: 100%; overflow: hidden; z-index: 1;">
              <sl-split-panel position=${ this._historyTypes.commit && this._historyTypes.linear ? "60" : "100"}
              style="flex: 1; height: 100%;" >
                ${ this._historyTypes.linear ? html`
                  <div
                    slot="start"
                    style="height: 100%; overflow: hidden; display: flex; flex-direction: column;"
                  >
                    <xcommit-history
                    style="flex: 1; height: 0; min-height: 0;"
                    .selectedCommitHash=${this._selectedCommitHash ? encodeHashToBase64(this._selectedCommitHash): undefined}
                    @commit-selected=${(e: CustomEvent) => {
                      this._selectedCommitHash = e.detail.commitHash;
                      this._historyTypes = {
                        ...this._historyTypes,
                        commit: true,
                      }
                    }}
                    ></xcommit-history>
                  </div>
                ` : ""}
                ${ this._historyTypes.commit ? html`
                  <div slot=${ this._historyTypes.linear ? "end" : "start" } style="height: 100%; overflow: hidden; display: flex; flex-direction: column;">
                    <!-- toggle view/diff -->
                    <div class="row" style="align-items: center; gap: 1em; padding: 8px;">
                      Selected Commit
                      <sl-radio-group
                      size="small"
                        value=${this._diffView ? "2" : "1"}
                        @sl-change=${(e: SlChangeEvent)=>{
                          const s:SlRadioGroup = e.target as SlRadioGroup
                          this._diffView = s.value === "2"
                        }}>
                        <sl-radio-button value="1">${msg("View")}</sl-radio-button>
                        <sl-radio-button value="2">${msg("Diff")}</sl-radio-button>
                      </sl-radio-group>
                    </div>
                    
                    <div style="flex: 1; height: 0; min-height: 0; overflow: hidden;">
                      ${this._diffView ? html`
                        ${this.renderSelectedCommitDiff()}
                      `: html`
                        <div class="row" style="flex-shrink: 0;">${this.renderNewWorkspaceButton(sessionStore)}</div>
                        ${this.renderSelectedCommit()}
                      ` }
                    </div>
                  </div>
                ` : ""}
              </sl-split-panel>
            </div>
          ` : ""}
        </sl-split-panel>
      </div>
    </div> `;
  }

  copyWALToClipboard(documentHash: EntryHash) {
    const attachment: WAL = { hrl: [this.notebooksStore.dnaHash, documentHash], context: {} }
    this.notebooksStore.weaveClient?.assets.assetToPocket(attachment)
  }

  copyRenderedWALToPocket(documentHash: EntryHash) {
    const attachment: WAL = { hrl: [this.notebooksStore.dnaHash, documentHash], context: { view: "rendered" } }
    this.notebooksStore.weaveClient?.assets.assetToPocket(attachment)
  }

  async updateView(view: View) {
    if (this._view === view) return;

    this._view = view;
    await this.updateComplete;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const editor = this.shadowRoot?.querySelector('syn-md-editor') as {
          refreshEditor?: () => void;
          focusEditor?: () => void;
        } | null;

        editor?.refreshEditor?.();
        if (view !== View.View) {
          editor?.focusEditor?.();
        }
      });
    });
  }

  triggerUndo() {
    const editor = this.shadowRoot?.querySelector('syn-md-editor') as {
      onUndoShortcut?: () => void;
    } | null;

    editor?.onUndoShortcut?.();
  }

  triggerRedo() {
    const editor = this.shadowRoot?.querySelector('syn-md-editor') as {
      onRedoShortcut?: () => void;
    } | null;

    editor?.onRedoShortcut?.();
  }

  updateEditorHistoryState(event: CustomEvent<EditorHistoryState>) {
    this._editorHistoryState = event.detail;
  }

  renderNoteWorkspace(
    sessionStore: SessionStore<TextEditorState, TextEditorEphemeralState>,
    state: TextEditorState
  ) {
    return html`
    <sl-split-panel position=${this._renderDrawer ? "50" : "100"} style="flex: 1; height: 100%; ${this._renderDrawer ? "--divider-width: 20px;" : ""}" vertical>
    ${this._renderDrawer ? html`<sl-icon slot="divider" .src=${wrapPathInSvg(mdiDotsGrid)}></sl-icon>` : ""}
    ${ this._renderDrawer ? html`
      <div slot="end" id="drawer" style="--size: auto;z-index:1001; height: 100%;"
        @sl-hide=${()=>this._renderDrawer = false}>
        ${this.renderVersionControlPanel(sessionStore)}</div
      >
      ` : html``}
      <div slot="start" class="column" style="flex: 1; height: 100%;">
        <div
          class="row"
          style="align-items: center; background-color: white; padding: 8px;
          box-shadow: var(--sl-shadow-x-large); z-index: 10 height: 100%;"
        >
          <span class="controls">
            ${!this.standalone ? html`
            <sl-button
              style="margin-right:10px"
              size="small"
              circle
              @click=${() => {
                this.dispatchEvent(
                  new CustomEvent("close", {
                    detail: {},
                    composed: true,
                    bubbles: true,
                  })
                );
              }}
            ><sl-icon .src=${wrapPathInSvg(mdiArrowLeft)}></sl-icon></sl-button>`:""}
          
            <sl-button-group  label="View Options">
            <sl-button variant=${this._view === View.Edit ? "primary" : "neutral"} @click=${() => { this.updateView(View.Edit); }}><sl-icon .src=${wrapPathInSvg(mdiPencil)} label="Edit"></sl-icon></sl-button>
            <sl-button variant=${this._view === View.Both ? "primary" : "neutral"} @click=${() => { this.updateView(View.Both); }}><sl-icon .src=${wrapPathInSvg(mdiBookOpenOutline)} label="Both"></sl-icon></sl-button>
            <sl-button variant=${this._view === View.View ? "primary" : "neutral"} @click=${() => { this.updateView(View.View); }}><sl-icon .src=${wrapPathInSvg(mdiEye)} label="View"></sl-icon></sl-button>
            </sl-button-group>

            ${this._view !== View.View ? html`
            <sl-button-group 
              label="Edit History"
              style="margin-left: 16px;"
            >
            <sl-button
              ?disabled=${!this._editorHistoryState.canUndo}
              @click=${() => {
                this.triggerUndo();
              }}
            >
              <sl-icon .src=${wrapPathInSvg(mdiUndoVariant)}></sl-icon>
            </sl-button>

            <sl-button
              ?disabled=${!this._editorHistoryState.canRedo}
              @click=${() => {
                this.triggerRedo();
              }}
            >
              <sl-icon .src=${wrapPathInSvg(mdiRedoVariant)}></sl-icon>
            </sl-button>
            </sl-button-group>
            ` : html``}

            ${ isWeaveContext() ? html`
            <sl-button
              style="margin-left: 16px;"
              circle
              size="small"
              title=${msg("Copy note to pocket")}
              @click=${() => {
                this.copyWALToClipboard(this.documentStore.documentHash);
              }}
            >
            <sl-icon style="font-size:20px;vertical-align:middle"
            .src=${`data:image/svg+xml;charset=utf-8,${POCKET_ICON}`}

             label=${msg("Copy note to pocket")}>
            </sl-icon>`:""}
          </span>
          <session-status
            .sessionstore=${sessionStore}
          ></session-status>
          <span style="margin: 0 8px">${msg("Participants:")}</span>
          <session-participants
            direction="row"
            showOffline=true
            .sessionstore=${sessionStore}
          ></session-participants>
          <span>${msg("Active Workspace:")}</span>
          <sl-badge variant="primary" pill style="margin-left: 8px"
            >${this._workspaceName}</sl-badge
          >
          <sl-button
            style="margin-left: 16px;"
            @click=${() => {
              this._renderDrawer = !this._renderDrawer;
            }}
          >
            ${msg("Version Control")}
          </sl-button>
          <slot name="toolbar-action"></slot>
        </div>
        <div class="row" style="flex: 1;">
        <sl-split-panel position=${ this._view === View.Both ? "50" : this._view === View.View ? "0" : "100"} style="flex: 1; height: 100%; --divider-width: 8px;">
          <div slot="start" class="flex-scrollable-parent">
            <div class="flex-scrollable-container">
              <div class="flex-scrollable-y">
                <syn-md-editor
                  .slice=${sessionStore}
                  @history-state-changed=${(event: CustomEvent<EditorHistoryState>) => {
                    this.updateEditorHistoryState(event);
                  }}
                ></syn-md-editor>
              </div>
            </div>
          </div>

          <div slot="end" class="flex-scrollable-parent">
            ${isWeaveContext() ? html`
            <sl-button
              class="rendered-pocket"
              circle
              size="small"
              title=${msg("Copy rendered view to pocket")}
              @click=${() => {
                this.copyRenderedWALToPocket(this.documentStore.documentHash);
              }}
            >
              <sl-icon style="font-size:20px;vertical-align:middle"
                .src=${`data:image/svg+xml;charset=utf-8,${POCKET_ICON}`}
                label=${msg("Copy rendered view to pocket")}>
              </sl-icon>
            </sl-button>`:""}
            <div class="flex-scrollable-container">
              <div class="flex-scrollable-y">
                <div style="margin: 8px">
                  <sl-card style="width: 100%">
                  <div class="markd">
                    ${unsafeHTML(Marked.parse(state.text.join('')))}
                  </div>
                  </sl-card>
                </div>
              </div>
            </div>
          </div>
        </sl-split-panel>
        </div>
      </div>
    `;
  }

  renderLoading() {
    return html`
      <div
        class="row"
        style="flex: 1; align-items: center; justify-content: center"
      >
        <sl-spinner style="font-size: 2rem"></sl-spinner>
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
          >${msg(
      "The note was not found. Try again when one of its past contributors is online."
    )}</span
        >
      </div>
    `;
  }

  render() {
    switch (this._session.value.status) {
      case "pending":
        return this.renderLoading();
      case "complete":
        const sessionValue = this._session.value.value;
        if (!sessionValue || !sessionValue[0] || !sessionValue[1]) {
          return this.renderLoading();
        }
        return this.renderNoteWorkspace(
          sessionValue[0],
          sessionValue[1]
        );
      case "error":
        if (this._session.value.error.message === WORKSPACE_NOT_FOUND)
          return html`<div
            class="column center-content"
            style="flex: 1; gap: 16px"
          >
            <sl-spinner style="font-size: 16px"></sl-spinner>
            <span class="placeholder">${msg("Creating workspace...")}</span>
          </div>`;
        return this.renderNoRootFound();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._session.value.status === "complete" && this._session.value.value?.[0]) {
      this._session.value.value[0].commitChanges();
      this._session.value.value[0].leaveSession();
      console.log("left session on disconnect");
    }
  }

  static styles = [
    sharedStyles,
    css`
      .active::part(base) {
        background-color: var(--sl-color-primary-600);
        color: white;
      }
      .active::part(base):hover {
        background-color: var(--sl-color-primary-500);
        color: white;
      }
      sl-drawer::part(body) {
        display: flex;
      }
      :host {
        display: flex;
        flex: 1;
      }
      .controls {
        display: flex;
        flex: 1;
        flex-wrap: nowrap;
        align-items: center;
      }
      .rendered-pocket {
        position: absolute;
        top: 16px;
        right: 24px;
        z-index: 11;
      }
      .marked {
        display:block;
        word-wrap: normal;
      }
      .CodeMirror-wrap pre {
          word-break: break-word;
      }
      .tooltip::part(popup) {
        z-index: 10;
      }

      /* loaded from https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/vs.min.css */
      pre code.hljs{display:block;overflow-x:auto;padding:1em}code.hljs{padding:3px 5px}.hljs{background:#fff;color:#000}.hljs-comment,.hljs-quote,.hljs-variable{color:green}.hljs-built_in,.hljs-keyword,.hljs-name,.hljs-selector-tag,.hljs-tag{color:#00f}.hljs-addition,.hljs-attribute,.hljs-literal,.hljs-section,.hljs-string,.hljs-template-tag,.hljs-template-variable,.hljs-title,.hljs-type{color:#a31515}.hljs-deletion,.hljs-meta,.hljs-selector-attr,.hljs-selector-pseudo{color:#2b91af}.hljs-doctag{color:grey}.hljs-attr{color:red}.hljs-bullet,.hljs-link,.hljs-symbol{color:#00b0e8}.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:700}
    `,
  ];
}
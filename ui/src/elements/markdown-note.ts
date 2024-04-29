import { EntryRecord } from "@holochain-open-dev/utils";
import { consume } from "@lit/context";
import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  Workspace,
  DocumentStore,
  WorkspaceStore,
  stateFromCommit,
  SynStore,
  synContext,
  synDocumentContext,
  SessionStore,
} from "@holochain-syn/core";
import { MarkdownRenderer } from "@scoped-elements/markdown-renderer";

import "@holochain-syn/core/dist/elements/syn-context.js";
import "@holochain-syn/core/dist/elements/session-participants.js";
import "./commit-history";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";
import "@shoelace-style/shoelace/dist/components/input/input.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/icon-button/icon-button.js";
import "@shoelace-style/shoelace/dist/components/button-group/button-group.js";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/dialog/dialog.js";
import "@holochain-open-dev/profiles/dist/elements/agent-avatar.js";
import "./workspace-list";
import "@shoelace-style/shoelace/dist/components/badge/badge.js";
import "@shoelace-style/shoelace/dist/components/drawer/drawer.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import "./syn-md-editor";
import { Profile, ProfilesStore, profilesStoreContext } from '@holochain-open-dev/profiles';


import {
  hashState,
  notifyError,
  onSubmit,
  renderAsyncStatus,
  sharedStyles,
  wrapPathInSvg,
} from "@holochain-open-dev/elements";
import { ActionHash, encodeHashToBase64, EntryHash } from "@holochain/client";
import {
  completed,
  joinAsyncMap,
  mapAndJoin,
  pipe,
  StoreSubscriber,
  subscribe,
} from "@holochain-open-dev/stores";
import { SlDialog, SlDrawer } from "@shoelace-style/shoelace";
import { msg } from "@lit/localize";
import { decode } from "@msgpack/msgpack";
import { Marked } from "@ts-stack/markdown";
import { mdiBookOpenOutline, mdiEye, mdiPencil } from "@mdi/js";
import { isWeContext, WAL } from "@lightningrodlabs/we-applet";
import {
  TextEditorEphemeralState,
  TextEditorState,
} from "../grammar";
import { NoteMeta } from "../types.js";
import { notebooksContext, NotebooksStore } from "../store";

enum View {
  Edit,
  Both,
  View
}

const POCKET_ICON=`<svg width="20" height="20" viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M74.2273 83.9C71.7318 83.9 69.3386 84.8956 67.574 86.6678C65.8095 88.4401 64.8182 90.8437 64.8182 93.35V150.05C64.8182 172.607 73.74 194.239 89.6209 210.189C105.502 226.139 127.041 235.1 149.5 235.1C196.27 235.1 234.182 197.023 234.182 150.05V93.35C234.182 90.8437 233.191 88.4401 231.426 86.6678C229.661 84.8956 227.268 83.9 224.773 83.9H74.2273ZM54.2676 73.3035C59.5612 67.9869 66.7409 65 74.2273 65H224.773C232.259 65 239.439 67.9869 244.732 73.3035C250.026 78.6202 253 85.8311 253 93.35V150.05C253 207.461 206.663 254 149.5 254C122.05 254 95.7245 243.048 76.3144 223.554C56.9044 204.059 46 177.619 46 150.05V93.35C46 85.8311 48.9739 78.6202 54.2676 73.3035Z" fill="black"/><path d="M188.841 141.469H158.596V110.124C158.596 105.635 154.961 102 150.474 102C145.986 102 142.351 105.635 142.351 110.124V141.469H110.085C105.635 141.469 102 145.104 102 149.593C102 154.081 105.635 157.717 110.122 157.717H142.388V188.876C142.388 193.365 146.023 197 150.511 197C154.998 197 158.633 193.365 158.633 188.876V157.717H188.878C193.365 157.717 197 154.081 197 149.593C196.944 145.104 193.328 141.469 188.841 141.469Z" fill="black"/></svg>`
customElements.define("markdown-renderer", MarkdownRenderer);

const WORKSPACE_NOT_FOUND = "The requested workspace was not found";

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
        (map) => mapAndJoin(map, (w) => w.name),
        (allWorkspaces) => {
          const workspace: [EntryHash, String] | undefined = Array.from(
            allWorkspaces.entries()
          ).find(([hash, name]) => name === this._workspaceName);

          if (!workspace) throw new Error(WORKSPACE_NOT_FOUND);
          return this.documentStore.workspaces.get(workspace[0]);
        },
        (workspaceStore) => workspaceStore.session,
        (sessionStore, w) => (sessionStore ? sessionStore : w.joinSession()),
        (s) => s.state,
        (state, sessionStore) =>
          [sessionStore, state] as [
            SessionStore<TextEditorState, TextEditorEphemeralState>,
            TextEditorState
          ]
      ),
    () => [this.documentStore, this._workspaceName]
  );

  updated() {
    if (this._renderDrawer && this.drawer) {
      this.drawer.show()
    }
 }

  @state()
  _workspaceName: string = "main";

  @state()
  _view: View = View.Both

  @state(hashState())
  _selectedCommitHash: ActionHash | undefined;

  @state()
  creatingWorkspace = false;

  async createWorkspace(
    name: string,
    initialTipHash: EntryHash,
    sessionStore: SessionStore<TextEditorState, TextEditorEphemeralState>
  ) {
    if (this.creatingWorkspace) return;

    this.creatingWorkspace = true;

    await sessionStore.leaveSession();
    try {
      await this.documentStore.createWorkspace(name, initialTipHash);
      (this.shadowRoot?.getElementById("drawer") as SlDrawer).hide();
      (
        this.shadowRoot?.getElementById("new-workspace-dialog") as SlDialog
      ).hide();
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
    return html` <sl-button
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
          ${onSubmit((f) =>
        this.createWorkspace(
          f.name,
          this._selectedCommitHash!,
          sessionStore
        )
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
      </sl-dialog>`;
  }

  get drawer() {
    return this.shadowRoot?.getElementById("drawer") as SlDrawer;
  }

  renderSelectedCommit() {
    if (!this._selectedCommitHash)
      return html`<div class="column center-content" style="flex:1">
        <span>${msg("Select a commit to see its contents")}</span>
      </div>`;

    return html`${subscribe(
      this.documentStore.commits.get(this._selectedCommitHash),
      renderAsyncStatus({
        complete: (v) => html` <div class="flex-scrollable-parent">
          <div class="flex-scrollable-container">
            <div class="flex-scrollable-y" style="padding: 0 8px;">
              <sl-card>
                <div slot="header">Commit: ${this._selectedCommitHash ? encodeHashToBase64(this._selectedCommitHash):""}</div>
                <div slot="header">
                  <span style="display:flex;align-items:center">by ${subscribe(this.profilesStore.profiles.get(v.action.author),
                  renderAsyncStatus({
                    complete: (v) => html`<agent-avatar style="margin-left:5px;margin-right:5px;" size="20" .agentPubKey=${v?.action.author}></agent-avatar> ${v?.entry.nickname}`,
                    pending: () => this.renderLoading(),        
                    error: (e) => html`<display-error
                      .headline=${msg("Error fetching the author")}
                      .error=${e}
                      ></display-error>`,
                      })
                    )}
                    on ${(new Date(v.action.timestamp)).toLocaleDateString()} ${(new Date(v.action.timestamp)).toLocaleTimeString()}
                  </span>
                  
                </div>

                <div class="markd">
                  ${unsafeHTML(Marked.parse(
          (stateFromCommit(v.entry) as TextEditorState
          ).text.toString()))}
                </div>
              </sl-card>
            </div>
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
    return html`<div class="row" style="flex: 1;">
      <div class="column" style="width: 600px; margin-right: 16px">
        <workspace-list
          style="flex: 1; margin-bottom: 16px;"
          .activeWorkspace=${this._workspaceName}
          @join-workspace=${async (e: CustomEvent) => {
        await sessionStore.leaveSession();
        this.drawer.hide();
        this._workspaceName = e.detail.workspaceName;
      }}
        ></workspace-list>
        <xcommit-history
          style="flex: 1"
          .selectedCommitHash=${this._selectedCommitHash ? encodeHashToBase64(this._selectedCommitHash): undefined}
          @commit-selected=${(e: CustomEvent) => {
        this._selectedCommitHash = e.detail.commitHash;
      }}
        ></xcommit-history>
      </div>
      <div class="column" style="width: 800px">
        ${this.renderSelectedCommit()}
        <div class="row">${this.renderNewWorkspaceButton(sessionStore)}</div>
      </div>
    </div> `;
  }

  renderTitle() {
    if (this._meta.value.status !== "complete")
      return html`<sl-skeleton></sl-skeleton>`;
    const meta = this._meta.value.value;
    return html`<span style="margin-right: 8px">${meta.title}</span>
      ${meta.attachedToHrl
        ? html`<span>${msg(" for")}</span>
            <hrl-link .hrl=${meta.attachedToHrl}></hrl-link> `
        : html``} `;
  }

  copyWALToClipboard(documentHash: EntryHash) {
    const attachment: WAL = { hrl: [this.notebooksStore.dnaHash, documentHash], context: {} }
    this.notebooksStore.weClient?.walToPocket(attachment)
  }

  renderNoteWorkspace(
    sessionStore: SessionStore<TextEditorState, TextEditorEphemeralState>,
    state: TextEditorState
  ) {
    return html`
      ${ this._renderDrawer ? html`
      <sl-drawer id="drawer" style="--size: auto;z-index:1001"
        @sl-hide=${()=>this._renderDrawer = false}>
        ${this.renderVersionControlPanel(sessionStore)}</sl-drawer
      >
      ` : html``}
      <div class="column" style="flex: 1; height: 100%;">
        <div
          class="row"
          style="align-items: center; background-color: white; padding: 8px;
          box-shadow: var(--sl-shadow-x-large); z-index: 10"
        >
          ${this.standalone ? this.renderTitle() :""}
          <span class="controls">
          
            <sl-button-group  label="View Options">
            <sl-button variant=${this._view === View.Edit ? "primary" : "neutral"} @click=${() => { this._view = View.Edit }}><sl-icon .src=${wrapPathInSvg(mdiPencil)} label="Edit"></sl-icon></sl-button>
            <sl-button variant=${this._view === View.Both ? "primary" : "neutral"} @click=${() => { this._view = View.Both }}><sl-icon .src=${wrapPathInSvg(mdiBookOpenOutline)} label="Both"></sl-icon></sl-button>
            <sl-button variant=${this._view === View.View ? "primary" : "neutral"} @click=${() => { this._view = View.View }}><sl-icon .src=${wrapPathInSvg(mdiEye)} label="View"></sl-icon></sl-button>
            </sl-button-group>

            ${ isWeContext() ? html`
            <sl-button
              style="margin-left: 16px;"
              circle
              size="small"
              @click=${() => {
                this.copyWALToClipboard(this.documentStore.documentHash);
              }}
            > 
            <sl-icon style="font-size:20px;vertical-align:middle"
            .src=${`data:image/svg+xml;charset=utf-8,${POCKET_ICON}`}

             label="Edit">
            </sl-icon>`:""}
          </span>
          <span style="margin: 0 8px">${msg("Participants:")}</span>
          <session-participants
            direction="row"
            .sessionstore=${sessionStore}
          ></session-participants>
          <span>${msg("Active Workspace:")}</span>
          <sl-badge variant="primary" pill style="margin-left: 8px"
            >${this._workspaceName}</sl-badge
          >
          <sl-button
            style="margin-left: 16px;"
            @click=${() => {
              this._renderDrawer = true
            }}
          >
            ${msg("Version Control")}
          </sl-button>
          <slot name="toolbar-action"></slot>
        </div>
        <div class="row" style="flex: 1;">

          ${this._view === View.Both || this._view === View.Edit ? html`
          <div class="flex-scrollable-parent">
            <div class="flex-scrollable-container">
              <div class="flex-scrollable-y">
                <syn-md-editor
                  .slice=${sessionStore}
                ></syn-md-editor>
              </div>
            </div>
          </div>` : ""}

          ${this._view === View.Both || this._view === View.View ? html`
          <div class="flex-scrollable-parent">
            <div class="flex-scrollable-container">
              <div class="flex-scrollable-y">
                <div style="margin: 8px">
                  <sl-card style="width: 100%">
                  <div class="markd">
                    ${unsafeHTML(Marked.parse(state.text.toString()))}
                  </div>
                  </sl-card>
                </div>
              </div>
            </div>
          </div>` : ""}
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
        return this.renderNoteWorkspace(
          this._session.value.value[0],
          this._session.value.value[1]
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
    if (this._session.value.status === "complete")
      this._session.value.value[0].leaveSession();
  }

  static styles = [
    sharedStyles,
    css`
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
    `,
  ];
}

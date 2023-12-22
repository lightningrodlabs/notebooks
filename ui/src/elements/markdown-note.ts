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
import "@holochain-syn/core/dist/elements/commit-history.js";
import "@holochain-syn/text-editor/dist/elements/syn-markdown-editor.js";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";
import "@shoelace-style/shoelace/dist/components/input/input.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/dialog/dialog.js";
import "./workspace-list";
import "@shoelace-style/shoelace/dist/components/badge/badge.js";
import "@shoelace-style/shoelace/dist/components/drawer/drawer.js";

import {
  TextEditorEphemeralState,
  TextEditorState,
} from "@holochain-syn/text-editor";

import {
  hashState,
  notifyError,
  onSubmit,
  renderAsyncStatus,
  sharedStyles,
} from "@holochain-open-dev/elements";
import { ActionHash, EntryHash } from "@holochain/client";
import {
  mapAndJoin,
  pipe,
  StoreSubscriber,
  subscribe,
} from "@holochain-open-dev/stores";
import { SlDialog, SlDrawer } from "@shoelace-style/shoelace";
import { msg } from "@lit/localize";
import { decode } from "@msgpack/msgpack";

import { NoteMeta } from "../types.js";

customElements.define("markdown-renderer", MarkdownRenderer);

const WORKSPACE_NOT_FOUND = "The requested workspace was not found";

@customElement("markdown-note")
export class MarkdownNote extends LitElement {
  @consume({ context: synDocumentContext, subscribe: true })
  @property()
  documentStore!: DocumentStore<TextEditorState, TextEditorEphemeralState>;

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

  @state()
  _workspaceName: string = "main";

  @state(hashState())
  _selectedCommitHash: ActionHash | undefined;

  // _selectedCommit = new StoreSubscriber(
  //   this,
  //   () =>
  //     this._selectedCommitHash
  //       ? this.documentStore.commits.get(this._selectedCommitHash)
  //       : completed(undefined),
  //   () => [this._selectedCommitHash]
  // );

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
                <markdown-renderer
                  style="flex: 1;"
                  .markdown=${(
                    stateFromCommit(v.entry) as TextEditorState
                  ).text.toString()}
                ></markdown-renderer>
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
        <commit-history
          style="flex: 1"
          .selectedCommitHash=${this._selectedCommitHash}
          @commit-selected=${(e: CustomEvent) => {
            this._selectedCommitHash = e.detail.commitHash;
          }}
        ></commit-history>
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

  renderNoteWorkspace(
    sessionStore: SessionStore<TextEditorState, TextEditorEphemeralState>,
    state: TextEditorState
  ) {
    return html`
      <sl-drawer id="drawer" style="--size: auto">
        ${this.renderVersionControlPanel(sessionStore)}</sl-drawer
      >
      <div class="column" style="flex: 1; height: 100%;">
        <div
          class="row"
          style="align-items: center; background-color: white; padding: 8px;
          box-shadow: var(--sl-shadow-x-large); z-index: 10"
        >
          ${this.renderTitle()}
          <span style="flex: 1"></span>

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
              this.drawer.show();
            }}
          >
            ${msg("Version Control")}
          </sl-button>
          <slot name="toolbar-action"></slot>
        </div>
        <div class="row" style="flex: 1;">
          <div class="flex-scrollable-parent">
            <div class="flex-scrollable-container">
              <div class="flex-scrollable-y">
                <syn-markdown-editor
                  .slice=${sessionStore}
                ></syn-markdown-editor>
              </div>
            </div>
          </div>

          <div class="flex-scrollable-parent">
            <div class="flex-scrollable-container">
              <div class="flex-scrollable-y">
                <div style="margin: 8px">
                  <sl-card style="width: 100%">
                    <markdown-renderer
                      style="flex: 1; "
                      .markdown=${state.text.toString()}
                    ></markdown-renderer>
                  </sl-card>
                </div>
              </div>
            </div>
          </div>
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
    `,
  ];
}

import { EntryRecord } from "@holochain-open-dev/utils";
import { consume } from "@lit-labs/context";
import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  Workspace,
  RootStore,
  WorkspaceStore,
  stateFromCommit,
  SynStore,
  synContext,
} from "@holochain-syn/core";
import { MarkdownRenderer } from "@scoped-elements/markdown-renderer";
customElements.define("markdown-renderer", MarkdownRenderer);

import "@holochain-syn/core/dist/elements/syn-context.js";
import "@holochain-syn/core/dist/elements/syn-root-context.js";
import "@holochain-syn/core/dist/elements/workspace-participants.js";
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
  textEditorGrammar,
  TextEditorGrammar,
  TextEditorState,
} from "@holochain-syn/text-editor";
import Automerge from "automerge";

import {
  hashProperty,
  hashState,
  notifyError,
  onSubmit,
  sharedStyles,
} from "@holochain-open-dev/elements";
import { EntryHash } from "@holochain/client";
import {
  asyncDerived,
  asyncDeriveStore,
  AsyncStatus,
  derived,
  StoreSubscriber,
} from "@holochain-open-dev/stores";
import { SlDialog, SlDrawer } from "@shoelace-style/shoelace";
import { msg } from "@lit/localize";
import { decode } from "@msgpack/msgpack";
import { NoteMeta } from "../types";

@customElement("markdown-note")
export class MarkdownNote extends LitElement {
  @property(hashProperty("note-hash"))
  noteHash!: EntryHash;

  @consume({ context: synContext })
  _synStore!: SynStore;

  _stores = new StoreSubscriber(
    this,
    () =>
      asyncDeriveStore(
        this._synStore.commits.get(this.noteHash),
        (noteCommit) => {
          const rootStore = new RootStore(
            this._synStore,
            textEditorGrammar,
            noteCommit
          );

          return asyncDerived(
            rootStore.allWorkspaces,
            (allWorkspaces) =>
              [rootStore, allWorkspaces] as [
                RootStore<TextEditorGrammar>,
                Array<EntryRecord<Workspace>>
              ]
          );
        }
      ),
    () => [this.noteHash]
  );

  @state()
  _workspaceName: string = "main";

  _workspace = new StoreSubscriber(
    this,
    () =>
      asyncDeriveStore(
        this._stores.store()!,
        async ([rootStore, allWorkspaces]) => {
          const workspace: EntryRecord<Workspace> | undefined =
            allWorkspaces.find((w) => w.entry.name === this._workspaceName);

          if (!workspace)
            throw new Error("The requested workspace was not found");

          const workspaceStore = await rootStore.joinWorkspace(
            workspace.entryHash
          );

          return derived(
            [workspaceStore.state, workspaceStore.currentTip],
            ([state, tip]) =>
              ({
                status: "complete",
                value: [workspaceStore, state, tip],
              } as AsyncStatus<
                [
                  WorkspaceStore<TextEditorGrammar>,
                  Automerge.FreezeObject<TextEditorState>,
                  EntryHash
                ]
              >)
          );
        }
      ),
    () => [this._workspaceName]
  );

  @state(hashState())
  _selectedCommitHash: EntryHash | undefined;

  _selectedCommit = new StoreSubscriber(
    this,
    () =>
      this._selectedCommitHash
        ? this._synStore.commits.get(this._selectedCommitHash)
        : undefined,
    () => [this._selectedCommitHash]
  );

  @state()
  creatingWorkspace = false;

  async createWorkspace(
    name: string,
    initialTipHash: EntryHash,
    rootStore: RootStore<TextEditorGrammar>,
    workspaceStore: WorkspaceStore<TextEditorGrammar>
  ) {
    if (this.creatingWorkspace) return;

    this.creatingWorkspace = true;

    if (workspaceStore) await workspaceStore.leaveWorkspace();
    try {
      await rootStore.createWorkspace(name, initialTipHash);
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
    rootStore: RootStore<TextEditorGrammar>,
    workspaceStore: WorkspaceStore<TextEditorGrammar>
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
              rootStore,
              workspaceStore
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

    switch (this._selectedCommit.value.status) {
      case "pending":
        return this.renderLoading();
      case "complete":
        return html`
          <div class="flex-scrollable-parent">
            <div class="flex-scrollable-container">
              <div class="flex-scrollable-y" style="padding: 0 8px;">
                <sl-card>
                  <markdown-renderer
                    style="flex: 1;"
                    .markdown=${(
                      stateFromCommit(
                        this._selectedCommit.value.value.entry
                      ) as TextEditorState
                    ).text.toString()}
                  ></markdown-renderer>
                </sl-card>
              </div>
            </div>
          </div>
        `;
      case "error":
        return html`<display-error
          .headline=${msg("Error fetching the commit")}
          .error=${this._selectedCommit.value.error.data.data}
        ></display-error>`;
    }
  }

  renderVersionControlPanel(
    rootStore: RootStore<TextEditorGrammar>,
    workspaceStore: WorkspaceStore<TextEditorGrammar>
  ) {
    return html`<div class="row" style="flex: 1;">
      <div class="column" style="width: 600px; margin-right: 16px">
        <workspace-list
          style="flex: 1; margin-bottom: 16px;"
          .activeWorkspace=${this._workspaceName}
          @join-workspace=${async (e: CustomEvent) => {
            if (this._workspace.value) await workspaceStore.leaveWorkspace();
            this.drawer.hide();
            this._workspaceName = e.detail.workspace.entry.name;
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
        <div class="row">
          ${this.renderNewWorkspaceButton(rootStore, workspaceStore)}
        </div>
      </div>
    </div> `;
  }

  renderTitle(rootStore: RootStore<TextEditorGrammar>) {
    let meta = decode(rootStore.root.entry.meta!) as NoteMeta;
    return html`<span style="margin-right: 8px">${meta.title}</span>
      ${meta.attachedToHrl
        ? html`<span>${msg(", for")}</span>
            <hrl-link .hrl=${meta.attachedToHrl}></hrl-link> `
        : html``} `;
  }

  renderNoteWorkspace(rootStore: RootStore<TextEditorGrammar>) {
    switch (this._workspace.value.status) {
      case "pending":
        return this.renderLoading();
      case "complete":
        const workspaceStore = this._workspace.value.value[0];
        const state = this._workspace.value.value[1];
        return html`
          <syn-root-context .rootstore=${rootStore}>
            <sl-drawer id="drawer" style="--size: auto">
              ${this.renderVersionControlPanel(
                rootStore,
                workspaceStore
              )}</sl-drawer
            >
            <div class="column" style="flex: 1; height: 100%;">
              <div
                class="row"
                style="align-items: center; background-color: white; padding: 8px;
          box-shadow: var(--sl-shadow-x-large); z-index: 10"
              >
                ${this.renderTitle(rootStore)}
                <span style="flex: 1"></span>
                <span style="margin: 0 8px">${msg("Participants:")}</span>
                <workspace-participants
                  direction="row"
                  .workspacestore=${workspaceStore}
                ></workspace-participants>
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
              </div>
              <div class="row" style="flex: 1;">
                <div class="flex-scrollable-parent">
                  <div class="flex-scrollable-container">
                    <div class="flex-scrollable-y">
                      <syn-markdown-editor
                        .slice=${workspaceStore}
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
          </syn-root-context>
        `;

      case "error":
        return html`<display-error
          .headline=${msg("Error fetching the workspace for this note")}
          .error=${this._workspace.value.error.data.data}
        ></display-error>`;
    }
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
    switch (this._stores.value.status) {
      case "pending":
        return this.renderLoading();
      case "complete":
        const rootStore = this._stores.value.value[0];
        const workspaces = this._stores.value.value[1];
        if (workspaces && workspaces.length > 0)
          return this.renderNoteWorkspace(rootStore);
        return this.renderNoRootFound();
      case "error":
        return this.renderNoRootFound();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._workspace.value.status === "complete")
      this._workspace.value.value[0].leaveWorkspace();
  }
  static styles = [
    sharedStyles,
    css`
      sl-drawer::part(body) {
        display: flex;
      }
    `,
  ];
}

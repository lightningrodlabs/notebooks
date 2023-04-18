import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { consume } from "@lit-labs/context";
import { RootStore, synRootContext, Workspace } from "@holochain-syn/core";
import { TextEditorGrammar } from "@holochain-syn/text-editor";

import "@holochain-open-dev/profiles/dist/elements/agent-avatar.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/relative-time/relative-time.js";
import "@shoelace-style/shoelace/dist/components/skeleton/skeleton.js";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import { StoreSubscriber } from "@holochain-open-dev/stores";
import { localized, msg } from "@lit/localize";
import { sharedStyles } from "@holochain-open-dev/elements";
import { EntryRecord } from "@holochain-open-dev/utils";

@localized()
@customElement("workspace-list")
export class WorkspaceList extends LitElement {
  @consume({ context: synRootContext, subscribe: true })
  @property()
  rootStore!: RootStore<TextEditorGrammar>;

  _allWorkspaces = new StoreSubscriber(
    this,
    () => this.rootStore.allWorkspaces,
    () => []
  );

  renderWorkspace(workspace: EntryRecord<Workspace>) {
    return html`
      <div class="row" style="flex: 1; align-items: center">
        <span style="flex: 1;"> ${workspace.entry.name} </span>

        <sl-button
          @click=${() => {
            this.dispatchEvent(
              new CustomEvent("join-workspace", {
                detail: {
                  workspaceHash: workspace.entryHash,
                  workspace,
                },
                composed: true,
                bubbles: true,
              })
            );
          }}
          >${msg("Join")}</sl-button
        >
      </div>
    `;
  }

  render() {
    switch (this._allWorkspaces.value.status) {
      case "pending":
        return html`
          <sl-skeleton></sl-skeleton>
          <sl-skeleton></sl-skeleton>
          <sl-skeleton></sl-skeleton>
        `;

      case "complete":
        const workspaces = this._allWorkspaces.value.value;
        return html`
          <mwc-card style="flex: 1;">
            <div class="column" style="flex: 1;">
              <span class="title" style="margin: 16px; margin-bottom: 0;"
                >Workspaces</span
              >

              ${workspaces.length === 0
                ? html`
                    <div
                      class="row"
                      style="flex: 1; align-items: center; justify-content: center;"
                    >
                      <span class="placeholder">There are no workspaces</span>
                    </div>
                  `
                : html`
                    <div class="flex-scrollable-parent">
                      <div class="flex-scrollable-container">
                        <div class="flex-scrollable-y">
                          <mwc-list>
                            ${workspaces.map((workspace) =>
                              this.renderWorkspace(workspace)
                            )}
                          </mwc-list>
                        </div>
                      </div>
                    </div>
                  `}
            </div>
          </mwc-card>
        `;

      case "error":
        return html`<display-error
          .headline=${msg("Error fetching the workspaces")}
          .error=${this._allWorkspaces.value.error.data.data}
        ></display-error>`;
    }
  }

  static get styles() {
    return sharedStyles;
  }
}

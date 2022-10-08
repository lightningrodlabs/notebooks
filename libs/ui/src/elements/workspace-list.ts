import { ScopedElementsMixin } from '@open-wc/scoped-elements';
import { html, LitElement } from 'lit';
import { TaskSubscriber } from 'lit-svelte-stores';
import { property } from 'lit/decorators.js';
import { contextProvided } from '@lit-labs/context';
import {
  List,
  ListItem,
  Button,
  CircularProgress,
  Card,
} from '@scoped-elements/material-web';
import { RootStore, synRootContext, Workspace } from '@holochain-syn/core';
import { AgentAvatar } from '@holochain-open-dev/profiles';
import { EntryHash } from '@holochain/client';
import { SlRelativeTime } from '@scoped-elements/shoelace';
import { TextEditorGrammar } from '@holochain-syn/text-editor';

import { sharedStyles } from '../shared-styles';

export class WorkspaceList extends ScopedElementsMixin(LitElement) {
  @contextProvided({ context: synRootContext, subscribe: true })
  @property()
  rootStore!: RootStore<TextEditorGrammar>;

  _workspacesTask = new TaskSubscriber(this, () =>
    this.rootStore.fetchWorkspaces()
  );

  renderWorkspace(workspaceHash: EntryHash, workspace: Workspace) {
    return html`
      <div class="row" style="flex: 1; align-items: center">
        <mwc-list-item style="flex: 1;">
          ${workspace.name}
        </mwc-list-item>

        <mwc-button
          @click=${() => {
            this.dispatchEvent(
              new CustomEvent('join-workspace', {
                detail: {
                  workspaceHash,
                  workspace,
                },
                composed: true,
                bubbles: true,
              })
            );
          }}
          >Join</mwc-button
        >
      </div>
    `;
  }

  render() {
    return this._workspacesTask.render({
      pending: () => html`
        <div
          class="row"
          style="flex: 1; align-items: center; justify-content: center;"
        >
          <mwc-circular-progress indeterminate></mwc-circular-progress>
        </div>
      `,
      complete: workspaces => html`
        <mwc-card style="flex: 1;">
          <div class="column" style="flex: 1;">
            <span class="title" style="margin: 16px; margin-bottom: 0;"
              >Workspaces</span
            >

            ${workspaces.keys().length === 0
              ? html`
                  <div
                    class="row"
                    style="flex: 1; align-items: center; justify-content: center;"
                  >
                    <span class="placeholder"
                      >There are no workspaces</span
                    >
                  </div>
                `
              : html`
                  <div class="flex-scrollable-parent">
                    <div class="flex-scrollable-container">
                      <div class="flex-scrollable-y">
                        <mwc-list>
                          ${workspaces
                            .entries()
                            .map(([workspaceHash, workspace]) =>
                              this.renderWorkspace(workspaceHash, workspace)
                            )}
                        </mwc-list>
                      </div>
                    </div>
                  </div>
                `}
          </div>
        </mwc-card>
      `,
    });
  }

  static get scopedElements() {
    return {
      'mwc-list': List,
      'mwc-list-item': ListItem,
      'mwc-card': Card,
      'sl-relative-time': SlRelativeTime,
      'mwc-button': Button,
      'agent-avatar': AgentAvatar,
      'mwc-circular-progress': CircularProgress,
    };
  }

  static get styles() {
    return sharedStyles;
  }
}

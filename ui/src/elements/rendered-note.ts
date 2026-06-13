import { consume } from "@lit/context";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

import {
  DocumentStore,
  WorkspaceStore,
  synDocumentContext,
} from "@holochain-syn/core";

import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

import { sharedStyles } from "@holochain-open-dev/elements";
import { EntryHash, HoloHashMap } from "@holochain/client";
import {
  mapAndJoin,
  pipe,
  StoreSubscriber,
} from "@holochain-open-dev/stores";
import { msg } from "@lit/localize";
import { decode } from "@msgpack/msgpack";
import { Marked } from "@ts-stack/markdown";
import {
  TextEditorEphemeralState,
  TextEditorState,
} from "../grammar";
import { NoteMeta } from "../types.js";

const WORKSPACE_NOT_FOUND = "The requested workspace was not found";

/**
 * Read-only view of a note that displays only the rendered markdown.
 * It does not join the syn session: it follows the latest committed
 * state of the workspace instead.
 */
@customElement("rendered-note")
export class RenderedNote extends LitElement {
  @consume({ context: synDocumentContext, subscribe: true })
  @property()
  documentStore!: DocumentStore<TextEditorState, TextEditorEphemeralState>;

  @property()
  workspaceName: string = "main";

  _meta = new StoreSubscriber(
    this,
    () =>
      pipe(
        this.documentStore.record,
        (document) => decode(document.entry.meta!) as NoteMeta
      ),
    () => [this.documentStore]
  );

  _state = new StoreSubscriber(
    this,
    () =>
      pipe(
        this.documentStore.allWorkspaces,
        (map) => mapAndJoin(map as unknown as HoloHashMap<Uint8Array, WorkspaceStore<TextEditorState, TextEditorEphemeralState>>, (w) => w.name),
        (allWorkspaces) => {
          const workspace: [EntryHash, String] | undefined = Array.from(
            allWorkspaces.entries() as IterableIterator<[EntryHash, string]>
          ).find(([_hash, name]) => name === this.workspaceName);

          if (!workspace) throw new Error(WORKSPACE_NOT_FOUND);
          return this.documentStore.workspaces.get(workspace[0]);
        },
        (workspaceStore) => workspaceStore!.latestState
      ),
    () => [this.documentStore, this.workspaceName]
  );

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

  render() {
    switch (this._state.value.status) {
      case "pending":
        return this.renderLoading();
      case "complete":
        const state = this._state.value.value;
        if (!state) return this.renderLoading();
        if (
          this._meta.value.status === "complete" &&
          this._meta.value.value.editorType === "richtext"
        )
          return html`<div class="column center-content" style="flex: 1;">
            <span class="placeholder"
              >${msg(
                "The rendered view is only available for markdown notes."
              )}</span
            >
          </div>`;
        return html`
          <div class="flex-scrollable-parent">
            <div class="flex-scrollable-container">
              <div class="flex-scrollable-y">
                <div class="markd">
                  ${unsafeHTML(Marked.parse(Array.isArray(state.text) ? state.text.join("") : state.text as unknown as string))}
                </div>
              </div>
            </div>
          </div>
        `;
      case "error":
        return html`<div class="column center-content" style="flex: 1;">
          <span class="placeholder"
            >${msg(
              "The note was not found. Try again when one of its past contributors is online."
            )}</span
          >
        </div>`;
    }
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex: 1;
      }
      .markd {
        display: block;
        word-wrap: normal;
        background-color: white;
        padding: 16px;
        min-height: 100%;
        box-sizing: border-box;
      }

      /* loaded from https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/vs.min.css */
      pre code.hljs{display:block;overflow-x:auto;padding:1em}code.hljs{padding:3px 5px}.hljs{background:#fff;color:#000}.hljs-comment,.hljs-quote,.hljs-variable{color:green}.hljs-built_in,.hljs-keyword,.hljs-name,.hljs-selector-tag,.hljs-tag{color:#00f}.hljs-addition,.hljs-attribute,.hljs-literal,.hljs-section,.hljs-string,.hljs-template-tag,.hljs-template-variable,.hljs-title,.hljs-type{color:#a31515}.hljs-deletion,.hljs-meta,.hljs-selector-attr,.hljs-selector-pseudo{color:#2b91af}.hljs-doctag{color:grey}.hljs-attr{color:red}.hljs-bullet,.hljs-link,.hljs-symbol{color:#00b0e8}.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:700}
    `,
  ];
}

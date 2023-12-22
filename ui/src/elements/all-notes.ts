import {
  mapAndJoin,
  pipe,
  StoreSubscriber,
} from "@holochain-open-dev/stores";
import { EntryRecord } from "@holochain-open-dev/utils";
import { synContext, SynStore, Document } from "@holochain-syn/core";
import { consume } from "@lit/context";
import { css, html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { decode } from "@msgpack/msgpack";
import { localized, msg } from "@lit/localize";
import { sharedStyles } from "@holochain-open-dev/elements";
import { isWeContext } from "@lightningrodlabs/we-applet";

import "@holochain-open-dev/elements/dist/elements/display-error.js";
import "@holochain-open-dev/profiles/dist/elements/agent-avatar.js";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/relative-time/relative-time.js";
import "@shoelace-style/shoelace/dist/components/skeleton/skeleton.js";

import { sortByDescendantTimestamp } from "../utils";

@localized()
@customElement("all-notes")
export class AllNotes extends LitElement {
  @consume({ context: synContext, subscribe: true })
  synStore!: SynStore;

  allNotes = new StoreSubscriber(
    this,
    () =>
      pipe(this.synStore.documentsByTag.get("note"), (map) =>
        mapAndJoin(map, (d) => d.record)
      ),
    () => [this.synStore]
  );

  renderNote(note: EntryRecord<Document>) {
    return html`
      <sl-card class="note" title=${isWeContext() ? msg("Open in Tab") : undefined}>
        <div
          class="column"
          style="flex: 1; "
          tabindex="0"
          @click=${() =>
            this.dispatchEvent(
              new CustomEvent("note-selected", {
                bubbles: true,
                composed: true,
                detail: {
                  note,
                },
              })
            )}
          @keypress=${(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              this.dispatchEvent(
                new CustomEvent("note-selected", {
                  bubbles: true,
                  composed: true,
                  detail: {
                    noteHash: note.actionHash,
                  },
                })
              );
            }
          }}
        >
          <span style="font-size: 18px;"
            >${(decode(note.entry.meta!) as any).title}</span
          >
          <div style="flex: 1"></div>
          <div
            class="row"
            style="justify-content: center; align-items: center;"
          >
            <span class="placeholder" style="flex: 1;"
              >${msg("Created")}
              <sl-relative-time
                .date=${new Date(note.action.timestamp)}
              ></sl-relative-time
            ></span>
            <agent-avatar .agentPubKey=${note.action.author}></agent-avatar>
          </div>
        </div>
      </sl-card>
    `;
  }

  render() {
    switch (this.allNotes.value.status) {
      case "pending":
        return html` <div class="row" style="">
          ${Array(3).map(
            () => html`<sl-skeleton effect="pulse" class="note"></sl-skeleton>`
          )}
        </div>`;
      case "complete":
        if (this.allNotes.value.value.size === 0)
          return html`
            <div
              class="row"
              style="flex: 1; justify-content: center; align-items: center"
            >
              <span class="placeholder" style="margin: 24px;"
                >${msg("There are no notes yet.")}</span
              >
            </div>
          `;
        return html`
          <div class="row" style="flex: 1; flex-wrap: wrap; padding: 16px;">
            ${sortByDescendantTimestamp(
              Array.from(this.allNotes.value.value.values())
            ).map((note) => this.renderNote(note))}
          </div>
        `;
      case "error":
        return html`<display-error
          .headline=${msg("Error fetching the notes")}
          .error=${this.allNotes.value.error}
        ></display-error>`;
    }
  }

  static styles = [
    sharedStyles,
    css`
      .note {
        height: 125px;
        width: 250px;
        margin-right: 16px;
        margin-bottom: 16px;
        display: flex;
        cursor: pointer;
        border-radius: 5px;
      }
      .note:hover {
        box-shadow: 1px 1px 8px #a7a7a7;
      }
      sl-card::part(body) {
        display: flex;
        flex: 1;
      }
      :host {
        display: flex;
      }
    `,
  ];
}

import { ScopedElementsMixin } from '@open-wc/scoped-elements';
import { css, html, LitElement } from 'lit';
import { Card, Ripple } from '@scoped-elements/material-web';
import { property, state } from 'lit/decorators.js';
import { EntryHashB64 } from '@holochain-open-dev/core-types';
import { SlRelativeTime, SlSkeleton } from '@scoped-elements/shoelace';
import { AgentAvatar } from '@holochain-open-dev/profiles';

import { sharedStyles } from '../shared-styles';
import { Note } from '../types';
import { sortByDescendantTimestamp } from '../utils';

export class NoteCollection extends ScopedElementsMixin(LitElement) {
  @property()
  notes!: Record<EntryHashB64, Note>;

  renderNote(hash: EntryHashB64, note: Note) {
    return html`
      <mwc-card
        class="note"
        @click=${() =>
          this.dispatchEvent(
            new CustomEvent('note-selected', {
              bubbles: true,
              composed: true,
              detail: {
                noteHash: hash,
              },
            })
          )}
      >
        <div class="column" style="flex: 1; margin: 16px;">
          <span style="font-size: 18px;">${note.title}</span>
          <div style="flex: 1"></div>
          <div
            class="row"
            style="justify-content: center; align-items: center;"
          >
            <span class="placeholder" style="flex: 1;"
              >Created
              <sl-relative-time
                .date=${new Date(note.timestamp / 1000)}
              ></sl-relative-time
            ></span>
            <agent-avatar .agentPubKey=${note.creator}></agent-avatar>
          </div>
        </div>
      </mwc-card>
    `;
  }

  renderSkeleton() {
    return html`
      <div class="row" style="">
        ${Array(3).map(() => html`<sl-skeleton class="note"></sl-skeleton>`)}
      </div>
    `;
  }

  render() {
    if (!this.notes) return this.renderSkeleton();

    return html`
      <div class="flex-scrollable-parent">
        <div class="flex-scrollable-container">
          <div class="flex-scrollable-y">
            <div class="row" style="flex: 1; flex-wrap: wrap; padding: 16px;">
              ${sortByDescendantTimestamp(this.notes).map(([hash, note]) =>
                this.renderNote(hash, note)
              )}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  static get scopedElements() {
    return {
      'mwc-card': Card,
      'mwc-ripple': Ripple,
      'sl-skeleton': SlSkeleton,
      'sl-relative-time': SlRelativeTime,
      'agent-avatar': AgentAvatar,
    };
  }

  static styles = [
    sharedStyles,
    css`
      .note {
        height: 125px;
        width: 250px;
        margin-right: 16px;
        margin-bottom: 16px;
      }
    `,
  ];
}

import { ScopedElementsMixin } from '@open-wc/scoped-elements';
import { css, html, LitElement } from 'lit';
import { Card, Ripple } from '@scoped-elements/material-web';
import { property, state } from 'lit/decorators.js';

import { sharedStyles } from '../shared-styles';
import { Note } from '../types';
import { Dictionary, EntryHashB64 } from '@holochain-open-dev/core-types';
import { sortByDescendantTimestamp } from '../utils';
import { SlSkeleton } from '@scoped-elements/shoelace';

export class NoteCollection extends ScopedElementsMixin(LitElement) {
  @property()
  notes!: Dictionary<Note>;

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
        <span>${note.title}</span>
      </mwc-card>
    `;
  }

  renderSkeleton() {
    return html`
      <div class="row">
        ${Array(3).map(() => html`<sl-skeleton class="note"></sl-skeleton>`)}
      </div>
    `;
  }

  render() {
    if (!this.notes) return this.renderSkeleton();

    return html`
      <div class="row" style="flex: 1;">
        ${sortByDescendantTimestamp(this.notes).map(([hash, note]) =>
          this.renderNote(hash, note)
        )}
      </div>
    `;
  }

  static get scopedElements() {
    return {
      'mwc-card': Card,
      'mwc-ripple': Ripple,
      'sl-skeleton': SlSkeleton,
    };
  }

  static styles = [
    sharedStyles,
    css`
      .note {
        height: 80px;
        width: 80px;
      }
    `,
  ];
}

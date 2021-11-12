import {
  ProfilesStore,
  profilesStoreContext,
} from '@holochain-open-dev/profiles';
import { contextProvided } from '@lit-labs/context';
import { ScopedElementsMixin } from '@open-wc/scoped-elements';
import { Button } from '@scoped-elements/material-web';
import { css, html, LitElement } from 'lit';
import { StoreSubscriber } from 'lit-svelte-stores';
import { state } from 'lit/decorators.js';

import { notesStoreContext } from '../context';
import { NotesStore } from '../notes-store';
import { sharedStyles } from '../shared-styles';
import { NoteCollection } from './note-collection';

export class NotesCreatedByOthers extends ScopedElementsMixin(LitElement) {
  @contextProvided({ context: notesStoreContext })
  _notesStore!: NotesStore;

  _notesCreatedByOthers = new StoreSubscriber(
    this,
    () => this._notesStore.notesCreatedByOthers
  );

  @state()
  loading = true;

  async firstUpdated() {
    await this._notesStore.fetchAllNotes();
    this.loading = false;
  }

  render() {
    return html`
      <div class="column" style="flex: 1;">
        <span class="title">All Notes</span>

        ${!this.loading &&
        Object.keys(this._notesCreatedByOthers.value).length === 0
          ? html`
              <div
                class="row"
                style="flex: 1; justify-content: center; align-items: center"
              >
                <span class="placeholder"
                  >There are no notes created by other agents yet</span
                >
              </div>
            `
          : html`
              <note-collection
                style="flex: 1;"
                .notes=${this._notesCreatedByOthers.value}
              ></note-collection>
            `}
      </div>
    `;
  }

  static get scopedElements() {
    return {
      'note-collection': NoteCollection,
    };
  }

  static styles = sharedStyles;
}

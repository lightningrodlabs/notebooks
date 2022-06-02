import { contextProvided } from '@lit-labs/context';
import { ScopedElementsMixin } from '@open-wc/scoped-elements';
import { html, LitElement } from 'lit';
import { StoreSubscriber } from 'lit-svelte-stores';
import { state } from 'lit/decorators.js';

import { notesStoreContext } from '../context';
import { NotesStore } from '../notes-store';
import { sharedStyles } from '../shared-styles';
import { NoteCollection } from './note-collection';

export class NotesCreatedByMe extends ScopedElementsMixin(LitElement) {
  @contextProvided({ context: notesStoreContext })
  _notesStore!: NotesStore;

  _notesCreatedByMe = new StoreSubscriber(
    this,
    () => this._notesStore.notesCreatedByMe
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
        <span class="title">My Notes</span>

        ${!this.loading &&
        Object.keys(this._notesCreatedByMe.value).length === 0
          ? html`
              <div
                class="row"
                style="flex: 1; justify-content: center; align-items: center"
              >
                <span class="placeholder"
                  >You don't have created any notes yet</span
                >
              </div>
            `
          : html`
              <note-collection
                style="flex: 1;"
                .notes=${this._notesCreatedByMe.value}
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

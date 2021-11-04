import { contextProvided } from '@lit-labs/context';
import { ScopedElementsMixin } from '@open-wc/scoped-elements';
import { Button } from '@scoped-elements/material-web';
import { html, LitElement } from 'lit';
import { StoreSubscriber } from 'lit-svelte-stores';

import { notesStoreContext } from '../context';
import { NotesStore } from '../notes-store';
import { NoteCollection } from './note-collection';

export class NotesCreatedByMe extends ScopedElementsMixin(LitElement) {
  @contextProvided({ context: notesStoreContext })
  _notesStore!: NotesStore;

  _notesCreatedByMe = new StoreSubscriber(
    this,
    () => this._notesStore.notesCreatedByMe
  );

  async firstUpdated() {
    await this._notesStore.fetchAllNotes();
  }

  render() {
    return html`<note-collection
      .notes=${this._notesCreatedByMe.value}
    ></note-collection>`;
  }

  static get scopedElements() {
    return {
      'note-collection': NoteCollection,
    };
  }
}

import { EntryHashB64 } from '@holochain-open-dev/core-types';
import { contextProvided, provide } from '@lit-labs/context';
import { ScopedElementsMixin } from '@open-wc/scoped-elements';
import { html, LitElement, PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import { synContext, SynFolks, SynSessions } from '@syn/elements';
import { SynTextEditor } from '@syn/text-editor';
import { StoreSubscriber } from 'lit-svelte-stores';
import { readable } from 'svelte/store';
import { unnest } from '@syn/store';

import { notesStoreContext } from '../context';
import { NotesStore, NoteSynStore } from '../notes-store';
import { MarkdownRenderer } from '@scoped-elements/markdown-renderer';
import { sharedStyles } from '../shared-styles';
export class MarkdownNote extends ScopedElementsMixin(LitElement) {
  @property()
  noteHash!: EntryHashB64;

  @contextProvided({ context: notesStoreContext })
  _notesStore!: NotesStore;

  @state()
  _noteSynStore: NoteSynStore | undefined;

  _activeSession = new StoreSubscriber(
    this,
    () => this._noteSynStore?.activeSession
  );
  _content = new StoreSubscriber(
    this,
    () => this._activeSession.value?.content
  );

  updated(changedValues: PropertyValues) {
    console.log(this._activeSession)
    super.updated(changedValues);

    if (changedValues.has('noteHash') && this.noteHash) {
      this.connectSyn();
    }
  }

  async connectSyn() {
    if (this._noteSynStore) await this._noteSynStore.close();

    this._noteSynStore = await this._notesStore.openNote(this.noteHash);
  }

  render() {
    if (!this._noteSynStore) return html`Loading...`;
    return html`
      <div
        class="row"
        style="flex: 1;"
        ${provide(synContext, this._noteSynStore)}
      >
        <syn-text-editor
          style="flex: 1;"
          @change-requested=${(e: CustomEvent) =>
            this._activeSession.value?.requestChange([e.detail.delta])}
        ></syn-text-editor>
        <markdown-renderer
          style="flex: 1;"
          .markdown=${this._content.value}
        ></markdown-renderer>
        <syn-folks></syn-folks>
      </div>
    `;
  }

  static get scopedElements() {
    return {
      'markdown-renderer': MarkdownRenderer,
      'syn-text-editor': SynTextEditor,
      'syn-sessions': SynSessions,
      'syn-folks': SynFolks,
    };
  }

  static styles = [sharedStyles];
}

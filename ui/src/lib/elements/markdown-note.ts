import { EntryHashB64 } from '@holochain-open-dev/core-types';
import { contextProvided, provide } from '@lit-labs/context';
import { ScopedElementsMixin } from '@open-wc/scoped-elements';
import { html, LitElement, PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import { SynContext, synContext, SynFolks, SynSessions } from '@syn/elements';
import { SynTextEditor } from '@syn/text-editor';
import { StoreSubscriber } from 'lit-svelte-stores';
import { readable } from 'svelte/store';
import { unnest } from '@syn/store';

import { notesStoreContext } from '../context';
import { NotesStore, NoteSynStore } from '../notes-store';
import { MarkdownRenderer } from '@scoped-elements/markdown-renderer';
import { sharedStyles } from '../shared-styles';
import { ProfilesStore, profilesStoreContext } from '@holochain-open-dev/profiles';
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
    super.updated(changedValues);

    if (changedValues.has('noteHash') && this.noteHash) {
      this.connectSyn();
    }
    console.log(this._activeSession.value)
  }

  async connectSyn() {
    if (this._noteSynStore) await this._noteSynStore.close();

    this._noteSynStore = await this._notesStore.openNote(this.noteHash);
  }

  render() {
    if (!this._noteSynStore) return html`Loading...`;
    return html`
      <syn-context .store=${this._noteSynStore}>
        <div class="row" style="flex: 1;">
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
      </syn-context>
    `;
  }

  static get scopedElements() {
    return {
      'markdown-renderer': MarkdownRenderer,
      'syn-text-editor': SynTextEditor,
      'syn-sessions': SynSessions,
      'syn-folks': SynFolks,
      'syn-context': SynContext,
    };
  }

  static styles = [sharedStyles];
}

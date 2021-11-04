import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { AppWebsocket } from '@holochain/conductor-api';
import { CellClient, HolochainClient } from '@holochain-open-dev/cell-client';
import { EntryHashB64 } from '@holochain-open-dev/core-types';
import {
  AgentAvatar,
  ProfilePrompt,
  ProfilesStore,
} from '@holochain-open-dev/profiles';
import { Context, ContextProvider } from '@lit-labs/context';
import { StoreSubscriber } from 'lit-svelte-stores';
import { ScopedElementsMixin } from '@open-wc/scoped-elements';
import { IconButton, TopAppBar } from '@scoped-elements/material-web';

import { router } from './router';

import { MarkdownNote } from './lib/elements/markdown-note';
import { sharedStyles } from './lib/shared-styles';
import { NotesCreatedByMe } from './lib/elements/notes-created-by-me';
import { NotesCreatedByOthers } from './lib/elements/notes-created-by-others';

export class NotebooksApp extends ScopedElementsMixin(LitElement) {
  @state()
  _activeNoteHash: EntryHashB64 | undefined;
  @state()
  _loading = true;

  _profilesStore!: ContextProvider<Context<ProfilesStore>>;

  _myProfile = new StoreSubscriber(
    this,
    () => this._profilesStore?.value.myProfile
  );

  async connectToHolochain() {
    const appWebsocket = await AppWebsocket.connect(
      `ws://localhost:${process.env.HC_PORT}`
    );

    const appInfo = await appWebsocket.appInfo({
      installed_app_id: 'notebooks',
    });

    const cellData = appInfo.cell_data[0];

    return new HolochainClient(appWebsocket, cellData);
  }

  async firstUpdated() {
    await this.connectToHolochain();

    router
      .on('/game/:game', (params: any) => {
        this._activeNoteHash = params.data.game;
      })
      .on('/', () => {
        this._activeNoteHash = undefined;
      })
      .resolve();
    this._loading = false;
  }

  renderContent() {
    if (this._activeNoteHash)
      return html`<markdown-note
        .noteHash=${this._activeNoteHash}
      ></markdown-note>`;

    return html`
      <div class="column">
        <notes-created-by-me></notes-created-by-me>
        <notes-created-by-others></notes-created-by-others>
      </div>
    `;
  }

  renderMyProfile() {
    if (!this._myProfile.value) return html``;
    return html`
      <div class="row center-content" slot="actionItems">
        <agent-avatar
          .agentPubKey=${this._profilesStore.value.myAgentPubKey}
        ></agent-avatar>
        <span style="margin: 0 16px;">${this._myProfile.value.nickname}</span>
      </div>
    `;
  }

  render() {
    return html`
      <mwc-top-app-bar style="flex: 1; display: flex;">
        ${this._activeNoteHash
          ? html`
              <mwc-icon-button
                icon="arrow_back"
                slot="navigationIcon"
                @click=${() => router.navigate('/')}
              ></mwc-icon-button>
            `
          : html``}
        <div slot="title">Elemental Chess</div>
        <div class="fill row" style="width: 100vw; height: 100%;">
          <profile-prompt style="flex: 1;">
            ${this.renderContent()}
          </profile-prompt>
        </div>
        ${this.renderMyProfile()}
      </mwc-top-app-bar>
    `;
  }

  static get scopedElements() {
    return {
      'profile-prompt': ProfilePrompt,
      'agent-avatar': AgentAvatar,
      'mwc-top-app-bar': TopAppBar,
      'markdown-note': MarkdownNote,
      'notes-created-by-me': NotesCreatedByMe,
      'notes-created-by-others': NotesCreatedByOthers,
      'mwc-icon-button': IconButton,
    };
  }

  static styles = [
    css`
      :host {
        display: flex;
      }
    `,
    sharedStyles,
  ];
}

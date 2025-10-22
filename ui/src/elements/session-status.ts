import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { SessionStore } from '@holochain-syn/store';
import { sharedStyles } from '@holochain-open-dev/elements';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { mdiCached } from "@mdi/js";
import { wrapPathInSvg } from "@holochain-open-dev/elements";

@customElement('session-status')
export class SessionStatus extends LitElement {
  @property({ type: Object })
  sessionstore!: SessionStore<any, any>;
  
  @state() _copied = false;
  
  _status = new StoreSubscriber(
    this,
    () => this.sessionstore.sessionStatus,
    () => [this.sessionstore]
  );

  copyTextToClipboard(text: string) {
    console.log("Copying text to clipboard:", text);
    navigator.clipboard.writeText(text).catch((err) => {
      console.error('Could not copy text: ', err);
    });
    this._copied = true;
    setTimeout(() => {
      this._copied = false;
    }, 2000);
  }

  render() {
    const color = this._status.value.code === 'ok' ? '#2de273ff' : this._status.value.code === 'syncing' ? '#f09928' : 'var(--sl-color-danger-600)';
    const lastSave = this._status.value.lastSave ? new Date(this._status.value.lastSave).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : 0;
    const message = this._status.value.error ? this._status.value.error : lastSave === 0 ? "Nothing to save yet" : `${this._status.value.code === "syncing" ? "Syncing. " : ""}Last saved ${lastSave}`;
    return html`
        <sl-tooltip content=${this._copied ? "Copied" : message}>
            <span 
                class=${this._status.value.code === 'syncing' ? "spinning" : ""}
                style="color: ${color}; display: flex; cursor: ${this._status.value.error ? "cursor" : "default"};"
                @click=${() => {if (this._status.value.code === "error") this.copyTextToClipboard(message)}}
                @keydown=${(_e: KeyboardEvent) => {}}
                tabindex="0"
            >
                <sl-icon .src=${wrapPathInSvg(mdiCached)}></sl-icon>
            </span>
        </sl-tooltip>
    `;
  }

  static styles = [
    sharedStyles,
    css`
        @keyframes spin {
            0% {
                transform: rotate(0deg);
            }
            100% {
                transform: rotate(360deg);
            }
        }
        .spinning > sl-icon {
            animation: spin 1s linear infinite;
        }
    `,
  ];
}

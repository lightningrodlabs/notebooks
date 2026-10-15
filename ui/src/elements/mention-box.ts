import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { decodeHashFromBase64 } from '@holochain/client';
import '@holochain-open-dev/profiles/dist/elements/agent-avatar.js';
import { insertMention, matchPeople, mentionQuery, Person, pruneMentions } from '../comments/people';

/**
 * <mention-box>: a growing textarea where typing `@` pops up matching people.
 * Arrow keys move through the list, Enter or Tab inserts `@Name `, Escape
 * closes it; while it is open those keys never reach the host's own handlers.
 *
 * Emits `mention-input` {text, mentions} on every edit, where `mentions` are
 * the agents whose `@Name` is still in the text. Native focus, blur and
 * keydown events pass through for the host.
 */
@customElement('mention-box')
export class MentionBox extends LitElement {
  @property() value = '';

  /** Agents already mentioned in `value` (AgentPubKeyB64). */
  @property({ type: Array }) mentions: string[] = [];

  @property({ type: Array }) people: Person[] = [];

  @property() placeholder = '';

  @property({ type: Number }) rows = 1;

  @property({ attribute: 'box-class' }) boxClass = '';

  @state() private hits: Person[] = [];

  @state() private selected = 0;

  @query('textarea') private textarea!: HTMLTextAreaElement;

  private queryStart = -1;

  private current: string[] = [];

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('mentions')) this.current = [...this.mentions];
  }

  /** The live text (the property only reflects what the host last set). */
  get text(): string {
    return this.textarea?.value ?? this.value;
  }

  /** Focus the textarea, waiting for the first render if it has not happened yet. */
  focus() {
    if (this.textarea) this.textarea.focus();
    else this.updateComplete.then(() => this.textarea?.focus());
  }

  clear() {
    if (this.textarea) {
      this.textarea.value = '';
      this.textarea.style.height = 'auto';
    }
    this.current = [];
    this.close();
  }

  private names(): Map<string, string> {
    return new Map(this.people.map(p => [p.key, p.name]));
  }

  private emitInput() {
    const text = this.textarea.value;
    this.current = pruneMentions(text, this.current, this.names());
    this.dispatchEvent(new CustomEvent('mention-input', { detail: { text, mentions: [...this.current] }, bubbles: true, composed: true }));
  }

  private grow() {
    const t = this.textarea;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight}px`;
  }

  private refreshQuery() {
    const q = mentionQuery(this.textarea.value, this.textarea.selectionStart ?? 0);
    if (!q) return this.close();
    this.queryStart = q.start;
    this.hits = matchPeople(this.people, q.query);
    this.selected = 0;
  }

  private close() {
    this.hits = [];
    this.queryStart = -1;
  }

  private pick(p: Person) {
    const t = this.textarea;
    const r = insertMention(t.value, this.queryStart, t.selectionStart ?? t.value.length, p.name);
    t.value = r.text;
    t.setSelectionRange(r.caret, r.caret);
    if (!this.current.includes(p.key)) this.current.push(p.key);
    this.close();
    this.grow();
    this.emitInput();
    t.focus();
  }

  private onKeydown(e: KeyboardEvent) {
    if (this.hits.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const n = this.hits.length;
      this.selected = (this.selected + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      this.pick(this.hits[this.selected]);
    } else if (e.key === 'Escape') {
      this.close();
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  render() {
    return html`
      <textarea class=${this.boxClass} rows=${this.rows} .value=${this.value} placeholder=${this.placeholder}
        @input=${() => { this.grow(); this.refreshQuery(); this.emitInput(); }}
        @keydown=${this.onKeydown}
        @click=${() => this.refreshQuery()}
        @blur=${() => this.close()}></textarea>
      ${this.hits.length > 0
        ? html`<ul class="pop" role="listbox">
            ${this.hits.map((p, i) => html`<li role="option" aria-selected=${i === this.selected}
                class=${i === this.selected ? 'sel' : ''}
                @mousedown=${(e: MouseEvent) => { e.preventDefault(); this.pick(p); }}>
                <agent-avatar .agentPubKey=${decodeHashFromBase64(p.key)} size="18" disable-tooltip disable-copy></agent-avatar>
                <span>${p.name}</span>
              </li>`)}
          </ul>`
        : nothing}
    `;
  }

  static styles = css`
    :host {
      display: block;
      position: relative;
    }
    textarea {
      width: 100%;
      box-sizing: border-box;
      resize: none;
      border: 1px solid var(--sl-color-neutral-300);
      border-radius: 4px;
      padding: 4px 6px;
      font: inherit;
      overflow: hidden;
    }
    .pop {
      position: absolute;
      left: 0;
      right: 0;
      top: 100%;
      z-index: 10;
      margin: 2px 0 0;
      padding: 4px 0;
      list-style: none;
      background: white;
      border: 1px solid var(--sl-color-neutral-300);
      border-radius: 4px;
      box-shadow: var(--sl-shadow-medium);
      max-height: 200px;
      overflow-y: auto;
    }
    li {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      cursor: pointer;
    }
    li.sel,
    li:hover {
      background: var(--sl-color-primary-100);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'mention-box': MentionBox;
  }
}

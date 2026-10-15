import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import { decodeHashFromBase64 } from '@holochain/client';
import { msg } from '@lit/localize';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiCheck, mdiContentCopy, mdiDelete, mdiRestore } from '@mdi/js';
import '@holochain-open-dev/profiles/dist/elements/agent-mention.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/relative-time/relative-time.js';
import { fitCards } from '../comments/layout';
import { CommentCounts, headerLabel } from '../comments/counts';
import { MarginCard } from '../comments/controller';
import { Reply } from '../comments/types';

const GAP = 12;
const FALLBACK_HEIGHT = 80;

/**
 * <comment-margin>: the column of comment cards beside an editor. Cards sit
 * at their anchor when they can and are pushed apart by `fitCards` when they
 * collide; comments whose text was deleted stack at the bottom.
 *
 * Events (all `bubbles`, `composed`): comment-activate {id}, comment-change
 * {id, text}, comment-delete {id}, comment-resolve {id, resolved},
 * comment-reply {id, text}, reply-change {id, replyId, text}, reply-delete
 * {id, replyId}, toggle-resolved {show}, copy-markdown.
 */
@customElement('comment-margin')
export class CommentMargin extends LitElement {
  @property({ type: Array })
  cards: MarginCard[] = [];

  @property()
  activeId: string | null = null;

  @property()
  myPubKeyB64 = '';

  @property({ type: Boolean })
  showResolved = false;

  @property({ type: Object })
  counts: CommentCounts = { open: 0, resolved: 0 };

  @state()
  private tops = new Map<string, number>();

  private heights = new Map<string, number>();

  private pendingFocus: string | null = null;

  private emit(name: string, detail: unknown = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  /** Scroll to and focus the card's text box once it exists. */
  focusCard(id: string) {
    this.pendingFocus = id;
    this.requestUpdate();
  }

  updated() {
    this.relayout();
    if (this.pendingFocus) {
      const el = this.shadowRoot?.querySelector(`[data-card="${this.pendingFocus}"] textarea.body`) as HTMLTextAreaElement | null;
      if (el) {
        el.focus();
        this.pendingFocus = null;
      }
    }
  }

  private relayout() {
    const anchored = this.cards.filter(c => c.anchorTop !== null);
    const orphans = this.cards.filter(c => c.anchorTop === null);
    for (const card of Array.from(this.shadowRoot?.querySelectorAll<HTMLElement>('.card') ?? [])) {
      this.heights.set(card.dataset.card!, card.offsetHeight);
    }
    // Anchors are measured from the top of the editor row, which is also this
    // element's top; the cards box starts below the sticky header, so pull it
    // up by the header's height and keep every card below the header.
    const header = this.shadowRoot?.querySelector<HTMLElement>('.header');
    const headerHeight = header?.offsetHeight ?? 0;
    const cardsBox = this.shadowRoot?.querySelector<HTMLElement>('.cards');
    if (cardsBox) cardsBox.style.marginTop = `-${headerHeight}px`;
    const tops = fitCards(
      anchored.map(c => ({ id: c.id, anchorTop: Math.max(c.anchorTop!, headerHeight), height: this.heights.get(c.id) ?? FALLBACK_HEIGHT })),
      this.activeId,
      GAP
    );
    let bottom = 0;
    for (const [id, top] of tops) bottom = Math.max(bottom, top + (this.heights.get(id) ?? FALLBACK_HEIGHT));
    for (const o of orphans) {
      const top = bottom + GAP;
      tops.set(o.id, top);
      bottom = top + (this.heights.get(o.id) ?? FALLBACK_HEIGHT);
    }
    // Cards are absolutely positioned, so the column must claim their height itself.
    this.style.minHeight = `${Math.max(0, bottom) + GAP}px`;
    let changed = tops.size !== this.tops.size;
    for (const [id, top] of tops) if (this.tops.get(id) !== top) changed = true;
    if (changed) this.tops = tops;
  }

  private grow(e: Event) {
    const t = e.currentTarget as HTMLTextAreaElement;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight}px`;
    this.relayout();
  }

  private submitReply(id: string, box: HTMLTextAreaElement) {
    const text = box.value.trim();
    if (!text) return;
    this.emit('comment-reply', { id, text });
    box.value = '';
    box.style.height = 'auto';
  }

  private renderReply(cardId: string, r: Reply) {
    const mine = r.author === this.myPubKeyB64;
    return html`<div class="reply">
      <div class="by">
        <agent-mention .agentPubKey=${decodeHashFromBase64(r.author)} size="18"></agent-mention>
        <sl-relative-time .date=${new Date(r.created)}></sl-relative-time>
        ${mine
          ? html`<sl-icon-button .src=${wrapPathInSvg(mdiDelete)} label=${msg('Delete reply')} title=${msg('Delete reply')}
              @click=${() => this.emit('reply-delete', { id: cardId, replyId: r.id })}></sl-icon-button>`
          : nothing}
      </div>
      ${mine
        ? html`<textarea rows="1" .value=${r.text} @input=${(e: Event) => { this.grow(e); this.emit('reply-change', { id: cardId, replyId: r.id, text: (e.currentTarget as HTMLTextAreaElement).value }); }}></textarea>`
        : html`<div class="text">${r.text}</div>`}
    </div>`;
  }

  private renderCard(c: MarginCard) {
    const mine = c.author === this.myPubKeyB64;
    const top = this.tops.get(c.id) ?? c.anchorTop ?? 0;
    return html`<div class="card ${c.id === this.activeId ? 'active' : ''} ${c.resolved ? 'resolved' : ''}"
        data-card=${c.id} style=${styleMap({ top: `${top}px` })} role="group" tabindex="0"
        @click=${() => this.emit('comment-activate', { id: c.id })}
        @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter' && e.currentTarget === e.target) this.emit('comment-activate', { id: c.id }); }}>
      <div class="by">
        <agent-mention .agentPubKey=${decodeHashFromBase64(c.author)} size="20"></agent-mention>
        <sl-relative-time .date=${new Date(c.created)}></sl-relative-time>
        <span style="flex: 1"></span>
        <sl-icon-button .src=${wrapPathInSvg(c.resolved ? mdiRestore : mdiCheck)}
          label=${c.resolved ? msg('Reopen') : msg('Resolve')}
          title=${c.resolved ? msg('Reopen comment') : msg('Resolve comment')}
          @click=${(e: Event) => { e.stopPropagation(); this.emit('comment-resolve', { id: c.id, resolved: !c.resolved }); }}></sl-icon-button>
        ${mine
          ? html`<sl-icon-button .src=${wrapPathInSvg(mdiDelete)} label=${msg('Delete comment')} title=${msg('Delete comment')}
              @click=${(e: Event) => { e.stopPropagation(); this.emit('comment-delete', { id: c.id }); }}></sl-icon-button>`
          : nothing}
      </div>
      ${c.range
        ? html`<div class="quote" title=${msg('Show in the text')}>“${c.quote.length > 60 ? `${c.quote.slice(0, 60)}…` : c.quote}”</div>`
        : html`<div class="quote orphan">${msg('Original text was deleted:')} “${c.quote.slice(0, 60)}”</div>`}
      ${mine
        ? html`<textarea class="body" rows="2" .value=${c.text} placeholder=${msg('Your comment')}
            @focus=${() => this.emit('comment-activate', { id: c.id })}
            @input=${(e: Event) => { this.grow(e); this.emit('comment-change', { id: c.id, text: (e.currentTarget as HTMLTextAreaElement).value }); }}
            @blur=${(e: Event) => { if ((e.currentTarget as HTMLTextAreaElement).value.trim() === '' && c.replies.length === 0) this.emit('comment-delete', { id: c.id }); }}></textarea>`
        : html`<div class="text">${c.text}</div>`}
      ${c.replies.map(r => this.renderReply(c.id, r))}
      ${c.id === this.activeId
        ? html`<div class="reply-box">
            <textarea rows="1" placeholder=${msg('Reply…')}
              @input=${this.grow}
              @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submitReply(c.id, e.currentTarget as HTMLTextAreaElement); } }}></textarea>
            <sl-button size="small" @click=${(e: Event) => { const box = (e.currentTarget as HTMLElement).previousElementSibling as HTMLTextAreaElement; this.submitReply(c.id, box); }}>${msg('Reply')}</sl-button>
          </div>`
        : nothing}
    </div>`;
  }

  render() {
    return html`
      <div class="header">
        <span>${headerLabel(this.counts)}</span>
        <sl-switch size="small" ?checked=${this.showResolved}
          @sl-change=${(e: Event) => this.emit('toggle-resolved', { show: (e.currentTarget as HTMLInputElement).checked })}>${msg('Resolved')}</sl-switch>
        <sl-icon-button .src=${wrapPathInSvg(mdiContentCopy)} label=${msg('Copy as markdown with comments')} title=${msg('Copy as markdown with comments')}
          @click=${() => this.emit('copy-markdown')}></sl-icon-button>
      </div>
      ${this.counts.open === 0 && this.counts.resolved > 0 && !this.showResolved
        ? html`<div class="empty">
            ${msg('All comments resolved.')}
            <button class="link" @click=${() => this.emit('toggle-resolved', { show: true })}>${msg('Show resolved')}</button>
          </div>`
        : nothing}
      <div class="cards">
        ${repeat(this.cards, c => c.id, c => this.renderCard(c))}
      </div>
    `;
  }

  static styles = css`
    :host {
      display: block;
      width: 280px;
      flex: none;
      position: relative;
      font-size: 13px;
      line-height: 1.4;
      padding: 0 8px;
      box-sizing: border-box;
      background: var(--sl-color-neutral-50);
    }
    .header {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 6px 4px 8px;
      background: var(--sl-color-neutral-50);
      border-bottom: 1px solid var(--sl-color-neutral-200);
      font-size: 12px;
      color: var(--sl-color-neutral-600);
    }
    .header span:first-child {
      flex: 1;
    }
    .cards {
      position: relative;
      min-height: 100%;
    }
    .card {
      position: absolute;
      left: 0;
      right: 0;
      background: white;
      border: 1px solid var(--sl-color-neutral-200);
      border-radius: 6px;
      padding: 8px 10px;
      box-sizing: border-box;
      transition: top 200ms ease;
      cursor: pointer;
    }
    .card.active {
      border-color: var(--sl-color-primary-500);
      box-shadow: 0 0 0 2px var(--sl-color-primary-200);
      z-index: 1;
    }
    .card.resolved {
      opacity: 0.6;
    }
    .by {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--sl-color-neutral-500);
      margin-bottom: 4px;
    }
    .quote {
      color: var(--sl-color-neutral-500);
      font-style: italic;
      margin-bottom: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .quote.orphan {
      color: var(--sl-color-warning-700);
      white-space: normal;
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
    .text {
      white-space: pre-wrap;
      word-break: break-word;
    }
    .reply {
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid var(--sl-color-neutral-100);
    }
    .reply-box {
      display: flex;
      gap: 4px;
      align-items: flex-end;
      margin-top: 6px;
    }
    .reply-box textarea {
      flex: 1;
    }
    .empty {
      /* The cards box is pulled up under the header and would cover this. */
      position: relative;
      z-index: 2;
      padding: 16px 4px;
      color: var(--sl-color-neutral-600);
    }
    .link {
      background: none;
      border: 0;
      padding: 0;
      margin-left: 4px;
      font: inherit;
      color: var(--sl-color-primary-600);
      text-decoration: underline;
      cursor: pointer;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'comment-margin': CommentMargin;
  }
}

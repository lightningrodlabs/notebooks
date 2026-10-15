import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import { decodeHashFromBase64 } from '@holochain/client';
import { msg } from '@lit/localize';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiAccountArrowLeftOutline, mdiCheck, mdiContentCopy, mdiDelete, mdiRestore } from '@mdi/js';
import '@holochain-open-dev/profiles/dist/elements/agent-mention.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/relative-time/relative-time.js';
import '@shoelace-style/shoelace/dist/components/dropdown/dropdown.js';
import '@shoelace-style/shoelace/dist/components/menu/menu.js';
import '@shoelace-style/shoelace/dist/components/menu-item/menu-item.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';
import '@shoelace-style/shoelace/dist/components/radio-group/radio-group.js';
import '@shoelace-style/shoelace/dist/components/radio-button/radio-button.js';
import './mention-box.js';
import { MentionBox } from './mention-box.js';
import { Person } from '../comments/people';
import { CommentFilter } from '../comments/filters';
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
 * {id, text, mentions}, comment-delete {id}, comment-resolve {id, resolved},
 * comment-assign {id, agent | null}, comment-reply {id, text, mentions},
 * reply-change {id, replyId, text, mentions}, reply-delete {id, replyId},
 * toggle-resolved {show}, filter-change {filter}, copy-markdown.
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

  /** Everyone who can be mentioned or assigned. */
  @property({ type: Array })
  people: Person[] = [];

  @property()
  filter: CommentFilter = 'all';

  /** Mentions typed so far in each card's reply box, by comment id. */
  private replyMentions = new Map<string, string[]>();

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
      const el = this.shadowRoot?.querySelector(`[data-card="${this.pendingFocus}"] mention-box.body`) as MentionBox | null;
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

  private submitReply(id: string, box: MentionBox) {
    const text = box.text.trim();
    if (!text) return;
    this.emit('comment-reply', { id, text, mentions: this.replyMentions.get(id) ?? [] });
    this.replyMentions.delete(id);
    box.clear();
  }

  private nameOf(key: string): string | undefined {
    return this.people.find(p => p.key === key)?.name;
  }

  /** Text with each `@Name` of a mentioned person set off. */
  private renderText(text: string, mentions: string[] | undefined) {
    const names = (mentions ?? []).map(k => this.nameOf(k)).filter((n): n is string => !!n);
    if (names.length === 0) return text;
    const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
    const parts = text.split(new RegExp(`(@(?:${escaped.join('|')}))`, 'g'));
    return parts.map((part, i) => (i % 2 === 1 ? html`<span class="mention">${part}</span>` : part));
  }

  private renderAssign(c: MarginCard) {
    return html`<sl-dropdown hoist placement="bottom-end" @click=${(e: Event) => e.stopPropagation()}
        @sl-select=${(e: CustomEvent) => {
          const v = (e.detail.item as HTMLElement & { value: string }).value;
          this.emit('comment-assign', { id: c.id, agent: v === '' ? null : v });
        }}>
        <sl-icon-button slot="trigger" .src=${wrapPathInSvg(mdiAccountArrowLeftOutline)}
          label=${msg('Assign')} title=${c.assignee ? msg('Reassign') : msg('Assign')}></sl-icon-button>
        <sl-menu>
          ${this.people.map(p => html`<sl-menu-item value=${p.key} type="checkbox" ?checked=${c.assignee?.agent === p.key}>${p.name}</sl-menu-item>`)}
          ${c.assignee ? html`<sl-divider></sl-divider><sl-menu-item value="">${msg('Unassign')}</sl-menu-item>` : nothing}
        </sl-menu>
      </sl-dropdown>`;
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
        ? html`<mention-box .value=${r.text} .mentions=${r.mentions ?? []} .people=${this.people}
            @mention-input=${(e: CustomEvent) => { this.relayout(); this.emit('reply-change', { id: cardId, replyId: r.id, ...e.detail }); }}></mention-box>`
        : html`<div class="text">${this.renderText(r.text, r.mentions)}</div>`}
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
        ${this.renderAssign(c)}
        <sl-icon-button .src=${wrapPathInSvg(c.resolved ? mdiRestore : mdiCheck)}
          label=${c.resolved ? msg('Reopen') : msg('Resolve')}
          title=${c.resolved ? msg('Reopen comment') : msg('Resolve comment')}
          @click=${(e: Event) => { e.stopPropagation(); this.emit('comment-resolve', { id: c.id, resolved: !c.resolved }); }}></sl-icon-button>
        ${mine
          ? html`<sl-icon-button .src=${wrapPathInSvg(mdiDelete)} label=${msg('Delete comment')} title=${msg('Delete comment')}
              @click=${(e: Event) => { e.stopPropagation(); this.emit('comment-delete', { id: c.id }); }}></sl-icon-button>`
          : nothing}
      </div>
      ${c.assignee
        ? html`<div class="assignee">${msg('Assigned to')} <agent-mention .agentPubKey=${decodeHashFromBase64(c.assignee.agent)} size="16"></agent-mention></div>`
        : nothing}
      ${c.range
        ? html`<div class="quote" title=${msg('Show in the text')}>“${c.quote.length > 60 ? `${c.quote.slice(0, 60)}…` : c.quote}”</div>`
        : html`<div class="quote orphan">${msg('Original text was deleted:')} “${c.quote.slice(0, 60)}”</div>`}
      ${mine
        ? html`<mention-box class="body" rows="2" .value=${c.text} .mentions=${c.mentions ?? []} .people=${this.people}
            placeholder=${msg('Your comment — type @ to mention someone')}
            @focusin=${() => this.emit('comment-activate', { id: c.id })}
            @mention-input=${(e: CustomEvent) => { this.relayout(); this.emit('comment-change', { id: c.id, ...e.detail }); }}
            @focusout=${(e: Event) => { if ((e.currentTarget as MentionBox).text.trim() === '' && c.replies.length === 0) this.emit('comment-delete', { id: c.id }); }}></mention-box>`
        : html`<div class="text">${this.renderText(c.text, c.mentions)}</div>`}
      ${c.replies.map(r => this.renderReply(c.id, r))}
      ${c.id === this.activeId
        ? html`<div class="reply-box">
            <mention-box class="reply-input" placeholder=${msg('Reply…')} .people=${this.people}
              @mention-input=${(e: CustomEvent) => { this.replyMentions.set(c.id, e.detail.mentions); this.relayout(); }}
              @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submitReply(c.id, e.currentTarget as MentionBox); } }}></mention-box>
            <sl-button size="small" @click=${(e: Event) => { const box = (e.currentTarget as HTMLElement).previousElementSibling as unknown as MentionBox; this.submitReply(c.id, box); }}>${msg('Reply')}</sl-button>
          </div>`
        : nothing}
    </div>`;
  }

  private renderEmpty() {
    if (this.cards.length > 0) return nothing;
    if (this.filter !== 'all') {
      return html`<div class="empty">
        ${this.filter === 'assigned' ? msg('Nothing assigned to you.') : msg('Nothing you wrote, replied to, or are mentioned in.')}
        <button class="link" @click=${() => this.emit('filter-change', { filter: 'all' })}>${msg('Show all')}</button>
      </div>`;
    }
    if (this.counts.open === 0 && this.counts.resolved > 0 && !this.showResolved) {
      return html`<div class="empty">
        ${msg('All comments resolved.')}
        <button class="link" @click=${() => this.emit('toggle-resolved', { show: true })}>${msg('Show resolved')}</button>
      </div>`;
    }
    return nothing;
  }

  render() {
    return html`
      <div class="header">
        <span>${headerLabel(this.counts)}</span>
        <sl-switch size="small" ?checked=${this.showResolved}
          @sl-change=${(e: Event) => this.emit('toggle-resolved', { show: (e.currentTarget as HTMLInputElement).checked })}>${msg('Resolved')}</sl-switch>
        <sl-icon-button .src=${wrapPathInSvg(mdiContentCopy)} label=${msg('Copy as markdown with comments')} title=${msg('Copy as markdown with comments')}
          @click=${() => this.emit('copy-markdown')}></sl-icon-button>
        <sl-radio-group class="filters" size="small" value=${this.filter}
          @sl-change=${(e: Event) => this.emit('filter-change', { filter: (e.currentTarget as HTMLInputElement).value })}>
          <sl-radio-button value="all">${msg('All')}</sl-radio-button>
          <sl-radio-button value="assigned" title=${msg('Comments assigned to me')}>${msg('Assigned to me')}</sl-radio-button>
          <sl-radio-button value="mine" title=${msg('Comments I wrote, replied to, or am mentioned in')}>${msg('Mentions & mine')}</sl-radio-button>
        </sl-radio-group>
      </div>
      ${this.renderEmpty()}
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
    .header {
      flex-wrap: wrap;
    }
    .header span:first-child {
      flex: 1;
    }
    .filters {
      flex-basis: 100%;
    }
    .mention {
      color: var(--sl-color-primary-700);
      background: var(--sl-color-primary-50);
      border-radius: 3px;
      padding: 0 2px;
    }
    .assignee {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--sl-color-neutral-600);
      margin-bottom: 4px;
    }
    .cards {
      /* No height of its own: cards are absolutely positioned and the host
         claims their height (relayout), so a full-height box here would push
         the panel past the pane by whatever sits above it. */
      position: relative;
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
    .reply-box mention-box {
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

import { html, TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { CommentsController } from './controller';
import { Person } from './people';
import '../elements/comment-margin.js';

/** The divider and <comment-margin> both editors render beside their text, wired to the controller. */
export function commentMarginTemplate(
  c: CommentsController,
  people: Person[],
  nameOf: (author: string) => Promise<string | undefined>
): TemplateResult {
  return html`<div class="nb-divider" title="Drag to resize" @pointerdown=${(e: PointerEvent) => c.startResize(e)}></div>
    <comment-margin
      style=${styleMap({ width: `${c.marginWidth}px` })}
      .cards=${c.cards()}
      .activeId=${c.activeId}
      .myPubKeyB64=${c.myPubKeyB64}
      .showResolved=${c.showResolved}
      .counts=${c.counts}
      .people=${people}
      .filter=${c.filter}
      @comment-activate=${(e: CustomEvent) => c.activate(e.detail.id)}
      @comment-change=${(e: CustomEvent) => c.setText(e.detail.id, e.detail.text, e.detail.mentions)}
      @comment-delete=${(e: CustomEvent) => c.remove(e.detail.id)}
      @comment-resolve=${(e: CustomEvent) => c.resolve(e.detail.id, e.detail.resolved)}
      @comment-assign=${(e: CustomEvent) => c.assign(e.detail.id, e.detail.agent)}
      @comment-reply=${(e: CustomEvent) => c.reply(e.detail.id, e.detail.text, e.detail.mentions)}
      @reply-change=${(e: CustomEvent) => c.setReplyText(e.detail.id, e.detail.replyId, e.detail.text, e.detail.mentions)}
      @reply-delete=${(e: CustomEvent) => c.removeReply(e.detail.id, e.detail.replyId)}
      @toggle-resolved=${(e: CustomEvent) => c.setShowResolved(e.detail.show)}
      @filter-change=${(e: CustomEvent) => c.setFilter(e.detail.filter)}
      @copy-markdown=${() => c.copyCriticMarkup(nameOf)}
    ></comment-margin>`;
}

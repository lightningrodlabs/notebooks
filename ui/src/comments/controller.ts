import { ReactiveController, ReactiveControllerHost } from 'lit';
import * as Automerge from '@automerge/automerge';
import { encodeHashToBase64 } from '@holochain/client';
import { SliceStore } from '@holochain-syn/core';
import { TextEditorEphemeralState, TextEditorState, textEditorGrammar } from '../grammar';
import { textOf } from '../text';
import { CommentRange, Segment, segments } from './ranges';
import { commentsView, CommentView, visibleRanges } from './model';
import { toCriticMarkup } from './criticmarkup';

export interface MarginCard extends CommentView {
  /** px from the top of the editor row, or null for a comment whose text was deleted. */
  anchorTop: number | null;
}

/** What an editor element provides so the controller can paint and anchor comments. */
export interface CommentsHost extends ReactiveControllerHost {
  slice: SliceStore<TextEditorState, TextEditorEphemeralState>;
  /** Top of the character at `offset`, relative to the editor row; null when unknown. */
  anchorTop(offset: number): number | null;
  /** Draw (or clear) the highlight segments. */
  paint(segs: Segment[], activeId: string | null): void;
  /** The current selection in markdown offsets, or null when collapsed. */
  commentSelection(): { from: number; to: number } | null;
}

type Ops = ReturnType<typeof textEditorGrammar.changes>;

const WIDTH_KEY = 'nb-comment-margin-width';
const MIN_WIDTH = 200;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 280;

function storedWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
  } catch (e) {
    // storage unavailable: use the default
  }
  return DEFAULT_WIDTH;
}

/**
 * Shared by both editors: derives comments, ranges and segments from the live
 * Automerge doc, tracks the active comment, and funnels every mutation through
 * the grammar.
 */
export class CommentsController implements ReactiveController {
  activeId: string | null = null;

  showResolved = false;

  view: CommentView[] = [];

  ranges: CommentRange[] = [];

  segs: Segment[] = [];

  /** Total including resolved ones, for the header. */
  total = 0;

  /** Width of the margin column in px; dragged with the divider, remembered per browser. */
  marginWidth = storedWidth();

  private doc: Automerge.Doc<TextEditorState> | undefined;

  private unsubscribe: (() => void) | undefined;

  constructor(private host: CommentsHost) {
    host.addController(this);
  }

  hostConnected() {
    this.bind();
  }

  hostDisconnected() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** (Re)subscribe to the host's current slice; call again when the host's `slice` property changes. */
  bind() {
    this.unsubscribe?.();
    this.unsubscribe = this.host.slice.docState.subscribe(doc => {
      this.doc = doc;
      this.recompute();
    });
  }

  get myPubKeyB64(): string {
    return encodeHashToBase64(this.host.slice.myPubKey);
  }

  /** Re-derive from the doc and repaint; also used after the host re-renders its text. */
  recompute() {
    if (!this.doc) return;
    this.view = commentsView(this.doc, this.showResolved);
    this.ranges = visibleRanges(this.doc, this.showResolved);
    this.segs = segments(this.ranges);
    this.total = this.doc.comments ? Object.keys(this.doc.comments).length : 0;
    this.host.paint(this.segs, this.activeId);
    this.host.requestUpdate();
  }

  /** Repaint only (the host rebuilt its view and lost its decorations). */
  repaint() {
    this.host.paint(this.segs, this.activeId);
  }

  activate(id: string | null) {
    if (this.activeId === id) return;
    this.activeId = id;
    this.host.paint(this.segs, id);
    this.host.requestUpdate();
  }

  setShowResolved(show: boolean) {
    this.showResolved = show;
    this.recompute();
  }

  /** Creates an empty comment over the editor's selection and makes it active. */
  createFromSelection(): string | null {
    const sel = this.host.commentSelection();
    if (!sel || sel.from === sel.to) return null;
    const id = crypto.randomUUID();
    this.change(g => g.addComment({ id, from: sel.from, to: sel.to }));
    this.activeId = id;
    return id;
  }

  setText(id: string, text: string) {
    this.change(g => g.setCommentText(id, text));
  }

  remove(id: string) {
    this.change(g => g.deleteComment(id));
    if (this.activeId === id) this.activeId = null;
  }

  resolve(id: string, resolved: boolean) {
    this.change(g => g.setResolved(id, resolved));
  }

  reply(id: string, text: string) {
    this.change(g => g.addReply(id, { id: crypto.randomUUID(), text }));
  }

  setReplyText(id: string, replyId: string, text: string) {
    this.change(g => g.setReplyText(id, replyId, text));
  }

  removeReply(id: string, replyId: string) {
    this.change(g => g.deleteReply(id, replyId));
  }

  /** Every author key in the document (comments and replies). */
  authors(): string[] {
    const out = new Set<string>();
    for (const c of Object.values(this.doc?.comments ?? {})) {
      out.add(c.author);
      for (const r of c.replies) out.add(r.author);
    }
    return [...out];
  }

  criticMarkup(names: Map<string, string> = new Map()): string {
    if (!this.doc) return '';
    return toCriticMarkup(textOf(this.doc), Object.values(this.doc.comments ?? {}), this.ranges, names);
  }

  /** Copy the markdown with comments; `nameOf` turns an author key into a display name. */
  async copyCriticMarkup(nameOf?: (author: string) => Promise<string | undefined>): Promise<void> {
    const names = new Map<string, string>();
    if (nameOf) {
      for (const a of this.authors()) {
        try {
          const n = await nameOf(a);
          if (n) names.set(a, n);
        } catch (e) {
          // no profile: the key is shown instead
        }
      }
    }
    await navigator.clipboard.writeText(this.criticMarkup(names));
  }

  /** Pointer-down on the divider between text and margin: drag left to widen the margin. */
  startResize(e: PointerEvent) {
    const divider = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startWidth = this.marginWidth;
    const move = (ev: PointerEvent) => {
      this.marginWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + (startX - ev.clientX)));
      this.host.requestUpdate();
    };
    const up = () => {
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', up);
      divider.removeEventListener('pointercancel', up);
      try {
        localStorage.setItem(WIDTH_KEY, String(this.marginWidth));
      } catch (err) {
        // storage unavailable: the width lasts for this session
      }
    };
    divider.setPointerCapture(e.pointerId);
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
    divider.addEventListener('pointercancel', up);
    e.preventDefault();
  }

  /** The margin's cards, anchored through the host's geometry. Call after the host has rendered. */
  cards(): MarginCard[] {
    return this.view.map(c => ({ ...c, anchorTop: c.range ? this.host.anchorTop(c.range.start) : null }));
  }

  private change(fn: (g: Ops) => void) {
    const { slice } = this.host;
    slice.change((state, eph) => fn(textEditorGrammar.changes(slice.myPubKey, state, eph)));
  }
}

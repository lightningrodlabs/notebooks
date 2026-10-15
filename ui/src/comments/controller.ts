import { ReactiveController, ReactiveControllerHost } from 'lit';
import * as Automerge from '@automerge/automerge';
import { encodeHashToBase64 } from '@holochain/client';
import { SliceStore } from '@holochain-syn/core';
import { TextEditorEphemeralState, TextEditorState, textEditorGrammar } from '../grammar';
import { textOf } from '../text';
import { commentRanges, CommentRange, Segment, segments } from './ranges';
import { commentsView, CommentView } from './model';
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

  private doc: Automerge.Doc<TextEditorState> | undefined;

  private unsubscribe: (() => void) | undefined;

  constructor(private host: CommentsHost) {
    host.addController(this);
  }

  hostConnected() {
    this.unsubscribe = this.host.slice.docState.subscribe(doc => {
      this.doc = doc;
      this.recompute();
    });
  }

  hostDisconnected() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  get myPubKeyB64(): string {
    return encodeHashToBase64(this.host.slice.myPubKey);
  }

  /** Re-derive from the doc and repaint; also used after the host re-renders its text. */
  recompute() {
    if (!this.doc) return;
    this.view = commentsView(this.doc, this.showResolved);
    this.ranges = commentRanges(this.doc);
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

  criticMarkup(): string {
    if (!this.doc) return '';
    return toCriticMarkup(textOf(this.doc), Object.values(this.doc.comments ?? {}), this.ranges);
  }

  async copyCriticMarkup(): Promise<void> {
    await navigator.clipboard.writeText(this.criticMarkup());
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

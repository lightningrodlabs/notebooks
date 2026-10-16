import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SliceStore } from '@holochain-syn/core';
import '@vanillawc/wc-codemirror/index.js';
import * as Automerge from '@automerge/automerge';
import {
  AgentPubKey,
  decodeHashFromBase64,
  encodeHashToBase64,
} from '@holochain/client';
import { sharedStyles, wrapPathInSvg } from '@holochain-open-dev/elements';
import { derived, StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { ProfilesStore, profilesStoreContext } from '@holochain-open-dev/profiles';
import { toPromise } from '@holochain-open-dev/stores';
import { styleMap } from 'lit/directives/style-map.js';
import { query } from 'lit/decorators.js';
import { mdiCommentPlusOutline } from '@mdi/js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import { cursorToPosition } from '../utils.js';
import { textOf } from '../text.js';
import { CommentsController, CommentsHost } from '../comments/controller.js';
import { Segment } from '../comments/ranges.js';
import { commentAt } from '../comments/model.js';
import { placeAddButton } from '../comments/add-button.js';
import { commentStyles } from '../comments/styles.js';
import './comment-margin.js';
import { CommentMargin } from './comment-margin.js';
import { commentMarginTemplate } from '../comments/margin-template.js';
import { Person } from '../comments/people.js';
import {
  AgentSelection,
  TextEditorEphemeralState,
  TextEditorState,
  textEditorGrammar,
} from '../grammar.js';
import './agent-cursor.js';

type CodeMirrorPosition = {
  line: number;
  ch: number;
  sticky?: 'before' | 'after';
  xRel?: number;
};

type TextEditorChange = {
  canceled?: boolean;
  from: CodeMirrorPosition;
  to: CodeMirrorPosition;
  text: string[];
  removed?: string[];
  origin?: string;
  cancel(): void;
};

/** A position in the body that survives other people's edits: an Automerge cursor. */
type HistoryAnchor = {
  cursor: Automerge.Cursor | null;
};

type EditorChangePatch = {
  anchor: HistoryAnchor;
  deleteCount: number;
  insertText: string;
};

type LocalHistoryEntry = {
  undo: EditorChangePatch;
  redo: EditorChangePatch;
};

@customElement('syn-md-editor')
export class SynMarkdownEditor extends LitElement implements CommentsHost {
  private _editorHistoryKeyMap = {
    'Ctrl-Z': () => {
      this.onUndoShortcut();
    },
    'Cmd-Z': () => {
      this.onUndoShortcut();
    },
    'Shift-Ctrl-Z': () => {
      this.onRedoShortcut();
    },
    'Shift-Cmd-Z': () => {
      this.onRedoShortcut();
    },
    'Ctrl-Y': () => {
      this.onRedoShortcut();
    },
    'Cmd-Y': () => {
      this.onRedoShortcut();
    },
  };

  @property({ type: Object })
  slice!: SliceStore<TextEditorState, TextEditorEphemeralState>;

  @property({ type: Function})
  doSet = (val:string) => {
    const e = this.editorEl
    e.set(val)
  }

  @state()
  _localChanges: LocalHistoryEntry[] = [];

  @state()
  _localChangeCurrentIndex: number = -1;

  // docState (the live automerge doc), not state: cursor and undo anchors
  // resolve element ids via Automerge.getObjectId, which needs a real
  // document — on the materialized toJS snapshot it throws "must be the
  // document root" for every index past 0
  _state = new StoreSubscriber(
    this,
    () => this.slice.docState,
    () => [this.slice]
  );

  _cursors = new StoreSubscriber(
    this,
    () => this.slice.ephemeral,
    () => [this.slice]
  );

  _lastCursorPosition = 0;

  /** Comments: derived state, mutations and margin cards (see comments/controller.ts). */
  comments = new CommentsController(this);

  @consume({ context: profilesStoreContext, subscribe: true })
  profilesStore!: ProfilesStore;

  /** Everyone with a profile in the group, for mentions and assignment. */
  private _people = new StoreSubscriber(
    this,
    () => this.profilesStore.allProfiles,
    () => [this.profilesStore]
  );

  private people(): Person[] {
    const v = this._people.value;
    if (!v || v.status !== 'complete') return [];
    return Array.from(v.value.entries())
      .filter(([, profile]) => !!profile?.entry) // a profile still loading
      .map(([key, profile]) => ({ key: encodeHashToBase64(key), name: profile.entry.nickname }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Nickname for an author key, for the markdown copy. */
  private nameOf = async (author: string): Promise<string | undefined> => {
    if (!this.profilesStore) return undefined;
    const store = this.profilesStore.profiles.get(decodeHashFromBase64(author));
    if (!store) return undefined;
    const profile = await toPromise(store);
    return profile?.entry.nickname;
  };

  /** Whether the margin is shown; the note shell owns it and listens for `show-comments`. */
  @property({ type: Boolean })
  showComments = false;

  /** Card to focus once the margin is on screen (it may only appear after the shell re-renders). */
  private _pendingFocus: string | null = null;

  private requestShowComments() {
    this.dispatchEvent(new CustomEvent('show-comments', { bubbles: true, composed: true }));
  }

  @query('.nb-row') private rowEl!: HTMLDivElement;

  @query('.nb-text') private textEl!: HTMLDivElement;

  @query('comment-margin') private marginEl!: CommentMargin | null;

  /** CodeMirror TextMarkers currently painted for comments. */
  private _commentMarks: Array<{ clear(): void }> = [];

  /** Where the floating "+ Comment" button sits while there is a selection, relative to the text column. */
  @state() private _addButton: { left: number; top: number } | null = null;

  _cursorPosition = 0;

  editor: any;

  get editorEl() {
    return this.shadowRoot?.getElementById('editor')! as any;
  }

  refreshEditor() {
    if (!this.editor) return;

    this.editor.refresh();
    this.requestUpdate();
  }

  focusEditor() {
    if (!this.editor) return;

    this.editor.focus();
    this.editor.getInputField()?.focus();
  }

  get canUndo() {
    return this._localChangeCurrentIndex >= 0;
  }

  get canRedo() {
    return this._localChangeCurrentIndex < this._localChanges.length - 1;
  }

  private emitHistoryState() {
    this.dispatchEvent(
      new CustomEvent('history-state-changed', {
        detail: {
          canUndo: this.canUndo,
          canRedo: this.canRedo,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  private createHistoryAnchorForDoc(doc: TextEditorState, index: number): HistoryAnchor {
    try {
      return { cursor: Automerge.getCursor(doc as any, ['body'], index) };
    } catch (e) {
      return { cursor: null };
    }
  }

  private createHistoryAnchor(index: number): HistoryAnchor {
    const doc = this._state.value;
    return doc ? this.createHistoryAnchorForDoc(doc, index) : { cursor: null };
  }

  private resolveHistoryAnchorForDoc(doc: TextEditorState, anchor: HistoryAnchor): number | undefined {
    if (!anchor.cursor) return 0;
    return cursorToPosition(doc as any, anchor.cursor);
  }

  applyChange(change: EditorChangePatch | undefined) {
    if (!change) return undefined;

    let inverseChange: EditorChangePatch | undefined;

    this.slice.change((state, eph) => {
      const from = this.resolveHistoryAnchorForDoc(state, change.anchor);
      if (from === undefined) return;

      const deletedText = textOf(state).slice(from, from + change.deleteCount);
      const grammar = textEditorGrammar.changes(this.slice.myPubKey, state, eph);

      if (change.deleteCount > 0) {
        grammar.delete(from, change.deleteCount);
      }

      if (change.insertText.length > 0) {
        grammar.insert(from, change.insertText);
      }

      if (change.deleteCount > 0 || change.insertText.length > 0) {
        inverseChange = {
          anchor: this.createHistoryAnchorForDoc(state, from),
          deleteCount: change.insertText.length,
          insertText: deletedText,
        };
      }
    });

    return inverseChange;
  }

  onUndoShortcut() {
    if (this._localChangeCurrentIndex < 0) return;

    const historyIndex = this._localChangeCurrentIndex;
    const change = this._localChanges[historyIndex];
    const inverseChange = this.applyChange(change?.undo);
    if (!inverseChange) return;

    this._localChanges = this._localChanges.map((entry, index) =>
      index === historyIndex
        ? {
            ...entry,
            redo: inverseChange,
          }
        : entry
    );

    this._localChangeCurrentIndex -= 1;
    this.emitHistoryState();
  }

  onRedoShortcut() {
    if (this._localChangeCurrentIndex >= this._localChanges.length - 1) return;

    const nextIndex = this._localChangeCurrentIndex + 1;
    const change = this._localChanges[nextIndex];
    const inverseChange = this.applyChange(change?.redo);
    if (!inverseChange) return;

    this._localChanges = this._localChanges.map((entry, index) =>
      index === nextIndex
        ? {
            ...entry,
            undo: inverseChange,
          }
        : entry
    );

    this._localChangeCurrentIndex = nextIndex;
    this.emitHistoryState();
  }

  /** Subscribe the CodeMirror instance to the slice's state; re-run whenever `slice` changes. */
  private _sliceUnsub: (() => void) | undefined;

  private bindSlice() {
    if (!this.editor) return;
    // History anchors are cursors into the previous note; none of them may be replayed here.
    this._localChanges = [];
    this._localChangeCurrentIndex = -1;
    this.emitHistoryState();
    this._sliceUnsub?.();
    this._sliceUnsub = derived([this.slice.docState, this.slice.ephemeral], i => i).subscribe(
      ([state, cursors]) => {
        const stateText = textOf(state);
        const myAgentSelection =
          cursors[encodeHashToBase64(this.slice.myPubKey)];

        if (this.editor.doc.getValue() !== stateText) {
          // console.log("Setting State Text")
          this.editor.doc.setValue(stateText);
          // console.log("Done setting State Text")
          // setValue dropped the comment marks with the old text.
          this.comments.repaint();
        }
        if (myAgentSelection) {
          if (stateText.length > 0) {
            const position = cursorToPosition(state, myAgentSelection.cursor) ?? 0;

            this.editor.doc.setSelection(
              this.editor.posFromIndex(position),
              this.editor.posFromIndex(
                position + myAgentSelection.characterCount
              )
            );
          } else {
            this.editor.doc.setSelection(
              this.editor.posFromIndex(0),
              this.editor.posFromIndex(0)
            );
          }
        }
      }
    );
    this.comments.bind();
  }

  updated(changed: Map<string | number | symbol, unknown>) {
    if (changed.has('slice') && this.editor) this.bindSlice();
    if (this._pendingFocus && this.marginEl) {
      this.marginEl.focusCard(this._pendingFocus);
      this._pendingFocus = null;
    }
  }

  firstUpdated() {
    // CodeMirror draws inside <wc-codemirror>'s own shadow root, where this
    // element's styles do not reach: give it the comment highlight styles.
    const cmRoot = this.editorEl.shadowRoot as ShadowRoot | null;
    if (cmRoot && commentStyles.styleSheet) {
      cmRoot.adoptedStyleSheets = [...cmRoot.adoptedStyleSheets, commentStyles.styleSheet];
    }
    this.editor = this.editorEl.editor;
    this.editor.setOption('lineWrapping', true)
    this.editor.addKeyMap(this._editorHistoryKeyMap);
    this.emitHistoryState();

    setTimeout(() => {
      this.editor.getInputField().click();
    }, 500);

    this.bindSlice();

    this.editor.on('beforeChange', (_:any, e: TextEditorChange) => {
      if (e.origin === 'setValue') return;
      e.cancel();

      const fromIndex = this.editor.indexFromPos({
        line: e.from.line,
        ch: e.from.ch,
      });
      const toIndex = this.editor.indexFromPos({
        line: e.to.line,
        ch: e.to.ch,
      });
      const insertedText = e.text.join('\n');
      const removedText = e.removed ? e.removed.join('\n') : '';
      const redoStart = this.createHistoryAnchor(fromIndex);

      if (toIndex > fromIndex) {
        this.onTextDeleted(fromIndex, toIndex - fromIndex);
      }

      if (e.text[0] !== '' || e.text.length > 1) {
        this.onTextInserted(fromIndex, insertedText);
      }

      const historyEntry: LocalHistoryEntry = {
        redo: {
          anchor: redoStart,
          deleteCount: toIndex - fromIndex,
          insertText: insertedText,
        },
        undo: {
          anchor: redoStart,
          deleteCount: insertedText.length,
          insertText: removedText,
        },
      };

      if (e.origin !== 'undo' && e.origin !== 'redo') {
        if (this._localChangeCurrentIndex < this._localChanges.length - 1) {
          this._localChanges = this._localChanges.slice(0, this._localChangeCurrentIndex + 1);
        }

        this._localChanges = [...this._localChanges, historyEntry];
        this._localChangeCurrentIndex = this._localChanges.length - 1;
        this.emitHistoryState();
      }
    });

    this.editor.on('beforeSelectionChange', (_:any, e:any) => {
      if (e.origin !== undefined) {
        const ranges = e.ranges;
        // @ts-ignore
        const transformedRanges = ranges.map(r => ({
          from: this.editor.indexFromPos(r.anchor),
          to: this.editor.indexFromPos(r.head),
        }));
        this.onSelectionChanged(transformedRanges);
        this.updateAddButton(ranges[0]);
        // A click into commented text activates that comment and opens the
        // margin. CodeMirror swallows the native click, so the mouse-driven
        // caret move is the signal; keyboard moves only change the active card.
        const { from, to } = transformedRanges[0];
        if (from === to && (e.origin === '*mouse' || e.origin === '+move')) {
          const id = commentAt(this.comments.ranges, from);
          this.comments.activate(id);
          if (id && e.origin === '*mouse') this.requestShowComments();
        }
      }
    });
  }

  disconnectedCallback() {
    this.editor?.removeKeyMap(this._editorHistoryKeyMap);
    this._sliceUnsub?.();
    this._sliceUnsub = undefined;
    super.disconnectedCallback();
  }

  // ---- comments (CommentsHost) ----

  paint(segs: Segment[], activeId: string | null) {
    if (!this.editor) return;
    for (const m of this._commentMarks) m.clear();
    this._commentMarks = [];
    // Skip while the editor still shows older text than Syn: the state
    // subscriber repaints after setValue.
    if (this._state.value && this.editor.doc.getValue() !== textOf(this._state.value)) return;
    for (const seg of segs) {
      const active = activeId !== null && seg.ids.includes(activeId);
      const className = `nb-comment nb-depth-${Math.min(seg.ids.length, 3)}${active ? ' nb-comment-active' : ''}`;
      this._commentMarks.push(
        this.editor.markText(this.editor.posFromIndex(seg.start), this.editor.posFromIndex(seg.end), {
          className,
          attributes: { 'data-comment-ids': seg.ids.join(' ') },
        })
      );
    }
  }

  anchorTop(offset: number): number | null {
    if (!this.editor || !this.rowEl) return null;
    const coords = this.editor.charCoords(this.editor.posFromIndex(offset), 'window');
    return coords.top - this.rowEl.getBoundingClientRect().top;
  }

  commentSelection(): { from: number; to: number } | null {
    if (!this.editor) return null;
    const from = this.editor.indexFromPos(this.editor.getCursor('from'));
    const to = this.editor.indexFromPos(this.editor.getCursor('to'));
    return from < to ? { from, to } : null;
  }

  private updateAddButton(range: { anchor: CodeMirrorPosition; head: CodeMirrorPosition } | undefined) {
    if (!range || !this.textEl) {
      this._addButton = null;
      return;
    }
    const a = this.editor.indexFromPos(range.anchor);
    const h = this.editor.indexFromPos(range.head);
    if (a === h) {
      this._addButton = null;
      return;
    }
    const end = a > h ? range.anchor : range.head;
    const coords = this.editor.charCoords(end, 'window');
    this._addButton = placeAddButton(coords, this.textEl.getBoundingClientRect(), this.textEl.scrollTop, this.textEl.scrollLeft);
  }

  private addCommentFromSelection() {
    const id = this.comments.createFromSelection();
    this._addButton = null;
    if (!id) return;
    this._pendingFocus = id;
    this.requestShowComments();
    this.requestUpdate();
  }

  private renderMargin() {
    const c = this.comments;
    if (!this.showComments || c.total === 0) return html``;
    return commentMarginTemplate(c, this.people(), this.nameOf);
  }

  onTextInserted(from: number, text: string) {
    this.slice.change((state, eph) =>
      textEditorGrammar
        .changes(this.slice.myPubKey, state, eph)
        .insert(from, text)
    );
  }

  onTextDeleted(from: number, characterCount: number) {
    this.slice.change((state, eph) =>
      textEditorGrammar
        .changes(this.slice.myPubKey, state, eph)
        .delete(from, characterCount)
    );
  }

  onSelectionChanged(ranges: Array<{ from: number; to: number }>) {
    console.log("selectionChanged")
    this.slice.change((state, eph) =>
      textEditorGrammar
        .changes(this.slice.myPubKey, state, eph)
        .changeSelection(ranges[0].from, ranges[0].to - ranges[0].from)
    );
  }

  renderCursor(agent: AgentPubKey, agentSelection: AgentSelection) {
    const position = cursorToPosition(this._state.value, agentSelection.cursor);
    if (position === undefined) return html``;
    if (!this.editor) return html``;

    if (this.editorEl.value.length < position) return html``;

    const coords = this.editor.cursorCoords(
      this.editor.posFromIndex(position),
      'local'
    );

    if (!coords) return html``;

    return html`<agent-cursor
      style=${styleMap({
        left: `${coords.left + 30}px`,
        top: `${coords.top}px`,
      })}
      class="cursor"
      .agent=${agent}
    ></agent-cursor>`;
  }

  render() {
    if (this._state.value === undefined) return html``;

    return html`
      <div class="nb-row">
      <div class="nb-text"
        style="position: relative; overflow: auto; flex: 1; background-color: white;"
      >
        <wc-codemirror
          id="editor"
          mode="markdown"
          style="height: auto;"
          viewport-margin="infinity"
        >
        </wc-codemirror>

        ${Object.entries(this._cursors.value)
          .filter(
            ([pubKeyB64, _]) =>
              pubKeyB64 !== encodeHashToBase64(this.slice.myPubKey)
          )
          .map(([pubKeyB64, position]) =>
            this.renderCursor(decodeHashFromBase64(pubKeyB64), position)
          )}
        ${this._addButton ? html`<sl-button class="nb-add-comment" size="small" variant="primary" circle
            style=${styleMap({ left: `${this._addButton.left}px`, top: `${this._addButton.top}px` })}
            title="Add comment"
            @mousedown=${(e: MouseEvent) => e.preventDefault()}
            @click=${() => this.addCommentFromSelection()}>
            <sl-icon .src=${wrapPathInSvg(mdiCommentPlusOutline)}></sl-icon>
          </sl-button>` : ''}
      </div>
      ${this.renderMargin()}
      </div>
    `;
  }

  static styles = [
    sharedStyles,
    commentStyles,
    css`
      :host {
        display: flex;
        flex: 1;
        position: relative;
        min-height: 100%;
        box-sizing: border-box;
      }
      .cursor {
        position: absolute;
      }
    `,
  ];
}

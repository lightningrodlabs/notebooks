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
import { sharedStyles } from '@holochain-open-dev/elements';
import { derived, StoreSubscriber } from '@holochain-open-dev/stores';
import { styleMap } from 'lit/directives/style-map.js';
import { elemIdToPosition } from '../utils.js';
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

type HistoryAnchor = {
  beforeId: string | null;
  afterId: string | null;
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
export class SynMarkdownEditor extends LitElement {
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

  private historyText() {
    return this._state.value?.text ?? [];
  }

  private createHistoryAnchorForText(text: string[], index: number): HistoryAnchor {
    return {
      beforeId:
        index > 0 ? Automerge.getObjectId(text, index - 1) || null : null,
      afterId:
        index < text.length ? Automerge.getObjectId(text, index) || null : null,
    };
  }

  private createHistoryAnchor(index: number): HistoryAnchor {
    return this.createHistoryAnchorForText(this.historyText(), index);
  }

  private resolveHistoryAnchorForText(text: string[], anchor: HistoryAnchor) {
    if (!anchor.beforeId && !anchor.afterId) return 0;

    if (anchor.beforeId) {
      const position = elemIdToPosition(false, anchor.beforeId, text);
      if (position !== undefined) return position;
    }

    if (anchor.afterId) {
      const position = elemIdToPosition(true, anchor.afterId, text);
      if (position !== undefined) return position;
    }

    if (anchor.beforeId && !anchor.afterId) return text.length;
    if (!anchor.beforeId && anchor.afterId) return 0;

    return undefined;
  }

  private resolveHistoryAnchor(anchor: HistoryAnchor) {
    return this.resolveHistoryAnchorForText(this.historyText(), anchor);
  }

  applyChange(change: EditorChangePatch | undefined) {
    if (!change) return undefined;

    let inverseChange: EditorChangePatch | undefined;

    this.slice.change((state, eph) => {
      const from = this.resolveHistoryAnchorForText(state.text, change.anchor);
      if (from === undefined) return;

      const deletedText = state.text
        .slice(from, from + change.deleteCount)
        .join('');
      const grammar = textEditorGrammar.changes(this.slice.myPubKey, state, eph);

      if (change.deleteCount > 0) {
        grammar.delete(from, change.deleteCount);
      }

      if (change.insertText.length > 0) {
        grammar.insert(from, change.insertText);
      }

      if (change.deleteCount > 0 || change.insertText.length > 0) {
        inverseChange = {
          anchor: this.createHistoryAnchorForText(state.text, from),
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

  firstUpdated() {
    this.editor = this.editorEl.editor;
    this.editor.setOption('lineWrapping', true)
    this.editor.addKeyMap(this._editorHistoryKeyMap);
    this.emitHistoryState();

    setTimeout(() => {
      this.editor.getInputField().click();
    }, 500);

    derived([this.slice.docState, this.slice.ephemeral], i => i).subscribe(
      ([state, cursors]) => {
        const stateText = state.text.join('');
        const myAgentSelection =
          cursors[encodeHashToBase64(this.slice.myPubKey)];

        if (this.editor.doc.getValue() !== stateText) {
          // console.log("Setting State Text")
          this.editor.doc.setValue(stateText);
          // console.log("Done setting State Text")
        }
        if (myAgentSelection) {
          if (state.toString().length > 0) {
            const position = elemIdToPosition(
              myAgentSelection.left,
              myAgentSelection.position,
              state.text
            )!;

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
      }
    });
  }

  disconnectedCallback() {
    this.editor?.removeKeyMap(this._editorHistoryKeyMap);
    super.disconnectedCallback();
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
    const position = elemIdToPosition(
      agentSelection.left,
      agentSelection.position,
      this._state.value.text
    )!;
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
      <div
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
      </div>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex: 1;
        position: relative;
      }
      .cursor {
        position: absolute;
      }
    `,
  ];
}

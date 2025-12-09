import { LitElement, html, css } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { SliceStore } from '@holochain-syn/core';
import {
  AgentPubKey,
  decodeHashFromBase64,
  encodeHashToBase64,
} from '@holochain/client';
import { derived, StoreSubscriber } from '@holochain-open-dev/stores';
import { styleMap } from 'lit/directives/style-map.js';
import './agent-cursor.js';

// ProseMirror imports
import { EditorView } from 'prosemirror-view';
import { EditorState, Transaction, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Schema, Node as PMNode } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { exampleSetup } from 'prosemirror-example-setup';
import { defaultMarkdownParser, defaultMarkdownSerializer } from 'prosemirror-markdown';

import {
  AgentSelection,
  TextEditorEphemeralState,
  TextEditorState,
  textEditorGrammar,
} from '../grammar.js';
import { elemIdToPosition } from '../utils.js';

/**
 * <syn-pm-editor>
 * A ProseMirror-based collaborative editor that integrates directly with Holochain Syn.
 * Works like syn-md-editor but uses ProseMirror for rich text editing.
 */
@customElement('syn-pm-editor')
export class SynPmEditor extends LitElement {
  @property({ type: Object })
  slice!: SliceStore<TextEditorState, TextEditorEphemeralState>;

  @property({ type: Function})
  doSet = (val: string) => {
    this.setPlainTextContent(val);
  }

  _state = new StoreSubscriber(
    this,
    () => this.slice.state,
    () => [this.slice]
  );

  _cursors = new StoreSubscriber(
    this,
    () => this.slice.ephemeral,
    () => [this.slice]
  );

  private view: EditorView | null = null;

  private schema: Schema;

  @query('#editor') private editorEl!: HTMLDivElement;

  private isUpdatingFromSyn = false;

  constructor() {
    super();
    // Create schema with lists
    const mySchema = new Schema({
      nodes: addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block'),
      marks: basicSchema.spec.marks,
    });
    this.schema = mySchema;
  }

  firstUpdated() {
    this.initializeEditor();
  }

  private initializeEditor() {
    const synState = this._state.value;
    const initialText = synState ? synState.text.join('') : '';

    // Create initial doc
    const doc = this.createDocFromText(initialText);

    // Create editor state
    const state = EditorState.create({
      schema: this.schema,
      doc,
      plugins: [
        ...exampleSetup({ schema: this.schema }),
        keymap({ 'Mod-z': undo, 'Mod-y': redo }),
        this.createSynPlugin(),
      ],
    });

    // Create view
    this.view = new EditorView(this.editorEl, { state });

    // Subscribe to Syn changes
    this.subscribeToSynChanges();

    setTimeout(() => this.view?.focus(), 100);
  }

  private createDocFromText(text: string): PMNode {
    console.log('createDocFromText input:', JSON.stringify(text));
    if (!text) {
      return this.schema.node('doc', null, [this.schema.node('paragraph')]);
    }

    // Parse markdown to ProseMirror document
    const parsed = defaultMarkdownParser.parse(text);
    return parsed || this.schema.node('doc', null, [this.schema.node('paragraph')]);
  }

  private docToText(doc: PMNode): string {
    // Serialize ProseMirror document to markdown
    const markdown = defaultMarkdownSerializer.serialize(doc);
    console.log('docToText serialized:', JSON.stringify(markdown));
    return markdown;
  }

  private createSynPlugin(): Plugin {
    const self = this;

    return new Plugin({
      key: new PluginKey('syn-sync'),
      
      appendTransaction(transactions, oldState, newState) {
        if (self.isUpdatingFromSyn) return null;

        const docChanged = transactions.some(tr => tr.docChanged);
        if (docChanged) {
          self.syncDocumentToSyn(oldState.doc, newState.doc);
        }

        // Sync selection changes
        const selectionChanged = transactions.some(tr => tr.selectionSet);
        if (selectionChanged || docChanged) {
          const { from, to } = newState.selection;
          self.onSelectionChanged([{ from, to }]);
        }

        return null;
      },
    });
  }

  private syncDocumentToSyn(oldDoc: PMNode, newDoc: PMNode) {
    const oldText = this.docToText(oldDoc);
    const newText = this.docToText(newDoc);

    if (oldText === newText) return;

    const changes = this.diffTexts(oldText, newText);
    
    this.slice.change((state, eph) => {
      const grammar = textEditorGrammar.changes(this.slice.myPubKey, state, eph);
      
      for (const change of changes) {
        if (change.type === 'delete') {
          grammar.delete(change.position, change.length!);
        } else if (change.type === 'insert') {
          grammar.insert(change.position, change.text!);
        }
      }
      
      // Grammar methods mutate state, don't need to return anything
    });
  }

  private diffTexts(oldText: string, newText: string): Array<{type: 'insert' | 'delete', position: number, text?: string, length?: number}> {
    // Find common prefix
    let prefixLen = 0;
    while (prefixLen < oldText.length && prefixLen < newText.length && 
           oldText[prefixLen] === newText[prefixLen]) {
      prefixLen += 1;
    }

    // Find common suffix
    let suffixLen = 0;
    while (suffixLen < oldText.length - prefixLen && 
           suffixLen < newText.length - prefixLen &&
           oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]) {
      suffixLen += 1;
    }

    const changes: Array<{type: 'insert' | 'delete', position: number, text?: string, length?: number}> = [];

    // Deletion
    const deletedLen = oldText.length - prefixLen - suffixLen;
    if (deletedLen > 0) {
      changes.push({ type: 'delete', position: prefixLen, length: deletedLen });
    }

    // Insertion
    const insertedText = newText.substring(prefixLen, newText.length - suffixLen);
    if (insertedText.length > 0) {
      changes.push({ type: 'insert', position: prefixLen, text: insertedText });
    }

    return changes;
  }

  private subscribeToSynChanges() {
    derived([this.slice.state, this.slice.ephemeral], i => i).subscribe(
      ([state, cursors]) => {
        if (!this.view) return;

        const stateText = state.text.join('');
        const currentText = this.docToText(this.view.state.doc);

        console.log('Syn update:', {
          stateText: JSON.stringify(stateText),
          currentText: JSON.stringify(currentText),
          stateLen: stateText.length,
          currentLen: currentText.length,
          areEqual: stateText === currentText,
          isUpdating: this.isUpdatingFromSyn,
        });

        if (stateText !== currentText && !this.isUpdatingFromSyn) {
          console.log('Updating editor from Syn');
          this.isUpdatingFromSyn = true;
          
          const lines = stateText.split('\n');
          console.log('Split into lines:', lines.length, 'lines:', JSON.stringify(lines));
          
          const newDoc = this.createDocFromText(stateText);
          const newDocText = this.docToText(newDoc);
          console.log('Created doc, paragraphs:', newDoc.childCount, 'docToText:', JSON.stringify(newDocText), 'matches input:', newDocText === stateText);
          
          // Replace entire document
          const tr = this.view.state.tr.replaceWith(
            0, 
            this.view.state.doc.content.size,
            newDoc.content
          );
          
          // Try to preserve cursor position
          const myAgentSelection = cursors[encodeHashToBase64(this.slice.myPubKey)];
          if (myAgentSelection && state.text.length > 0) {
            const position = elemIdToPosition(
              myAgentSelection.left,
              myAgentSelection.position,
              state.text
            );
            if (position !== null && position !== undefined) {
              const docSize = tr.doc.content.size;
              const safePos = Math.max(0, Math.min(position, docSize));
              try {
                tr.setSelection(TextSelection.near(tr.doc.resolve(safePos)));
              } catch (e) {
                // Selection might be invalid, ignore
              }
            }
          }
          
          this.view.dispatch(tr);
          this.isUpdatingFromSyn = false;
        }
      }
    );
  }

  onSelectionChanged(ranges: Array<{ from: number; to: number }>) {
    if (this.isUpdatingFromSyn) return;
    
    this.slice.change((state, eph) =>
      textEditorGrammar
        .changes(this.slice.myPubKey, state, eph)
        .changeSelection(ranges[0].from, ranges[0].to - ranges[0].from)
    );
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.view?.destroy();
    this.view = null;
  }

  setPlainTextContent(text: string) {
    if (!this.view) return;
    const newDoc = this.createDocFromText(text);
    const tr = this.view.state.tr.replaceWith(0, this.view.state.doc.content.size, newDoc.content);
    this.view.dispatch(tr);
  }

  getPlainText(): string {
    return this.view ? this.docToText(this.view.state.doc) : '';
  }

  renderCursor(agent: AgentPubKey, agentSelection: AgentSelection) {
    const position = elemIdToPosition(
      agentSelection.left,
      agentSelection.position,
      this._state.value.text
    );
    
    if (!this.view || position === null || position === undefined) return html``;

    const plainText = this.getPlainText();
    if (plainText.length < position) return html``;

    const resolved = this.view.state.doc.resolve(Math.min(position, this.view.state.doc.content.size));
    const coords = this.view.coordsAtPos(resolved.pos);

    if (!coords) return html``;

    return html`<agent-cursor
      style=${styleMap({
        left: `${coords.left}px`,
        top: `${coords.top}px`,
      })}
      class="cursor"
      .agent=${agent}
    ></agent-cursor>`;
  }

  render() {
    if (this._state.value === undefined) return html``;

    return html`
      <div style="position: relative; overflow: auto; flex: 1; background-color: white;">
        <div id="editor"></div>
        ${Object.entries(this._cursors.value)
          .filter(([pubKeyB64, _]) => pubKeyB64 !== encodeHashToBase64(this.slice.myPubKey))
          .map(([pubKeyB64, position]) =>
            this.renderCursor(decodeHashFromBase64(pubKeyB64), position)
          )}
      </div>
    `;
  }

  static styles = css`
    :host {
      display: flex;
      flex: 1;
      position: relative;
    }
    .cursor {
      position: absolute;
      z-index: 10;
    }
    #editor {
      flex: 1;
      padding: 10px;
      overflow: auto;
    }

    .ProseMirror {
      word-wrap: break-word;
      white-space: pre-wrap;
      white-space: break-spaces;
      -webkit-font-variant-ligatures: none;
      font-variant-ligatures: none;
      font-feature-settings: "liga" 0; /* the above doesn't seem to work in Edge */
    }

    .ProseMirror pre {
      white-space: pre-wrap;
    }

    .ProseMirror li {
      position: relative;
    }

    .ProseMirror-hideselection *::selection { background: transparent; }
    .ProseMirror-hideselection *::-moz-selection { background: transparent; }
    .ProseMirror-hideselection { caret-color: transparent; }

    /* See https://github.com/ProseMirror/prosemirror/issues/1421#issuecomment-1759320191 */
    .ProseMirror [draggable][contenteditable=false] { user-select: text }

    .ProseMirror-selectednode {
      outline: 2px solid #8cf;
    }

    /* Make sure li selections wrap around markers */

    li.ProseMirror-selectednode {
      outline: none;
    }

    li.ProseMirror-selectednode:after {
      content: "";
      position: absolute;
      left: -32px;
      right: -2px; top: -2px; bottom: -2px;
      border: 2px solid #8cf;
      pointer-events: none;
    }

    /* Protect against generic img rules */

    img.ProseMirror-separator {
      display: inline !important;
      border: none !important;
      margin: 0 !important;
    }
    .ProseMirror-textblock-dropdown {
      min-width: 3em;
    }

    .ProseMirror-menu {
      margin: 0 -4px;
      line-height: 1;
    }

    .ProseMirror-tooltip .ProseMirror-menu {
      width: -webkit-fit-content;
      width: fit-content;
      white-space: pre;
    }

    .ProseMirror-menuitem {
      margin-right: 3px;
      display: inline-block;
    }

    .ProseMirror-menuseparator {
      border-right: 1px solid #ddd;
      margin-right: 3px;
    }

    .ProseMirror-menu-dropdown, .ProseMirror-menu-dropdown-menu {
      font-size: 90%;
      white-space: nowrap;
    }

    .ProseMirror-menu-dropdown {
      vertical-align: 1px;
      cursor: pointer;
      position: relative;
      padding-right: 15px;
    }

    .ProseMirror-menu-dropdown-wrap {
      padding: 1px 0 1px 4px;
      display: inline-block;
      position: relative;
    }

    .ProseMirror-menu-dropdown:after {
      content: "";
      border-left: 4px solid transparent;
      border-right: 4px solid transparent;
      border-top: 4px solid currentColor;
      opacity: .6;
      position: absolute;
      right: 4px;
      top: calc(50% - 2px);
    }

    .ProseMirror-menu-dropdown-menu, .ProseMirror-menu-submenu {
      position: absolute;
      background: white;
      color: #666;
      border: 1px solid #aaa;
      padding: 2px;
    }

    .ProseMirror-menu-dropdown-menu {
      z-index: 15;
      min-width: 6em;
    }

    .ProseMirror-menu-dropdown-item {
      cursor: pointer;
      padding: 2px 8px 2px 4px;
    }

    .ProseMirror-menu-dropdown-item:hover {
      background: #f2f2f2;
    }

    .ProseMirror-menu-submenu-wrap {
      position: relative;
      margin-right: -4px;
    }

    .ProseMirror-menu-submenu-label:after {
      content: "";
      border-top: 4px solid transparent;
      border-bottom: 4px solid transparent;
      border-left: 4px solid currentColor;
      opacity: .6;
      position: absolute;
      right: 4px;
      top: calc(50% - 4px);
    }

    .ProseMirror-menu-submenu {
      display: none;
      min-width: 4em;
      left: 100%;
      top: -3px;
    }

    .ProseMirror-menu-active {
      background: #eee;
      border-radius: 4px;
    }

    .ProseMirror-menu-disabled {
      opacity: .3;
    }

    .ProseMirror-menu-submenu-wrap:hover .ProseMirror-menu-submenu, .ProseMirror-menu-submenu-wrap-active .ProseMirror-menu-submenu {
      display: block;
    }

    .ProseMirror-menubar {
      border-top-left-radius: inherit;
      border-top-right-radius: inherit;
      position: relative;
      min-height: 1em;
      color: #666;
      padding: 1px 6px;
      top: 0; left: 0; right: 0;
      border-bottom: 1px solid silver;
      background: white;
      z-index: 10;
      -moz-box-sizing: border-box;
      box-sizing: border-box;
      overflow: visible;
    }

    .ProseMirror-icon {
      display: inline-block;
      line-height: .8;
      vertical-align: -2px; /* Compensate for padding */
      padding: 2px 8px;
      cursor: pointer;
    }

    .ProseMirror-menu-disabled.ProseMirror-icon {
      cursor: default;
    }

    .ProseMirror-icon svg {
      fill: currentColor;
      height: 1em;
    }

    .ProseMirror-icon span {
      vertical-align: text-top;
    }
    .ProseMirror-gapcursor {
      display: none;
      pointer-events: none;
      position: absolute;
    }

    .ProseMirror-gapcursor:after {
      content: "";
      display: block;
      position: absolute;
      top: -2px;
      width: 20px;
      border-top: 1px solid black;
      animation: ProseMirror-cursor-blink 1.1s steps(2, start) infinite;
    }

    @keyframes ProseMirror-cursor-blink {
      to {
        visibility: hidden;
      }
    }

    .ProseMirror-focused .ProseMirror-gapcursor {
      display: block;
    }
    /* Add space around the hr to make clicking it easier */

    .ProseMirror-example-setup-style hr {
      padding: 2px 10px;
      border: none;
      margin: 1em 0;
    }

    .ProseMirror-example-setup-style hr:after {
      content: "";
      display: block;
      height: 1px;
      background-color: silver;
      line-height: 2px;
    }

    .ProseMirror ul, .ProseMirror ol {
      padding-left: 30px;
    }

    .ProseMirror blockquote {
      padding-left: 1em;
      border-left: 3px solid #eee;
      margin-left: 0; margin-right: 0;
    }

    .ProseMirror-example-setup-style img {
      cursor: default;
    }

    .ProseMirror-prompt {
      background: white;
      padding: 5px 10px 5px 15px;
      border: 1px solid silver;
      position: fixed;
      border-radius: 3px;
      z-index: 11;
      box-shadow: -.5px 2px 5px rgba(0, 0, 0, .2);
    }

    .ProseMirror-prompt h5 {
      margin: 0;
      font-weight: normal;
      font-size: 100%;
      color: #444;
    }

    .ProseMirror-prompt input[type="text"],
    .ProseMirror-prompt textarea {
      background: #eee;
      border: none;
      outline: none;
    }

    .ProseMirror-prompt input[type="text"] {
      padding: 0 4px;
    }

    .ProseMirror-prompt-close {
      position: absolute;
      left: 2px; top: 1px;
      color: #666;
      border: none; background: transparent; padding: 0;
    }

    .ProseMirror-prompt-close:after {
      content: "âœ•";
      font-size: 12px;
    }

    .ProseMirror-invalid {
      background: #ffc;
      border: 1px solid #cc7;
      border-radius: 4px;
      padding: 5px 10px;
      position: absolute;
      min-width: 10em;
    }

    .ProseMirror-prompt-buttons {
      margin-top: 5px;
      display: none;
    }
    #editor, .editor {
      background: white;
      color: black;
      background-clip: padding-box;
      border-radius: 4px;
      border: 2px solid rgba(0, 0, 0, 0.2);
      padding: 5px 0;
      margin-bottom: 23px;
    }

    .ProseMirror p:first-child,
    .ProseMirror h1:first-child,
    .ProseMirror h2:first-child,
    .ProseMirror h3:first-child,
    .ProseMirror h4:first-child,
    .ProseMirror h5:first-child,
    .ProseMirror h6:first-child {
      margin-top: 10px;
    }

    .ProseMirror {
      padding: 4px 8px 4px 14px;
      line-height: 1.2;
      outline: none;
    }

    .ProseMirror p { margin-bottom: 1em }
  
  `;
}
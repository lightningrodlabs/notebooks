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
import { Schema, DOMParser as PMDOMParser, DOMSerializer } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { exampleSetup } from 'prosemirror-example-setup';
import { EditorState, TextSelection } from 'prosemirror-state';
import {
  AgentSelection,
  TextEditorEphemeralState,
  TextEditorState,
  textEditorGrammar,
} from '../grammar.js';
import { elemIdToPosition } from '../utils.js';

/**
 * <syn-pm-editor>
 * A ProseMirror-based collaborative editor that integrates with Holochain Syn
 * for real-time collaborative editing. Uses the same API as syn-md-editor
 * but with ProseMirror instead of CodeMirror.
 *
 * Usage:
 *   <syn-pm-editor .slice=${sliceStore}></syn-pm-editor>
 */
@customElement('syn-pm-editor')
export class SynPmEditor extends LitElement {
  @property({ type: Object })
  slice!: SliceStore<TextEditorState, TextEditorEphemeralState>;

  @property({ type: Function})
  doSet = (val: string) => {
    // For immediate sync compatibility, treat input as plain text primarily
    // But allow HTML if it contains formatting
    if (val.includes('<') && val.includes('>')) {
      this.setContent(val);
    } else {
      this.setPlainTextContent(val);
    }
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

  /** Holds the ProseMirror view instance. */
  private view: EditorView | null = null;

  /** ProseMirror schema (basic + lists). */
  private pmSchema = new Schema({
    nodes: addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block'),
    marks: basicSchema.spec.marks,
  });

  /** The editor's mount point in the shadow DOM. */
  @query('#editor') private editorEl!: HTMLDivElement;

  /** Flag to prevent infinite loops during sync */
  private isUpdatingFromSlice = false;

  /** Flag to track initial content load */
  private isInitialLoad = true;

  firstUpdated() {
    // Initialize with empty content initially
    const tmp = document.createElement('div');
    tmp.innerHTML = '';

    const state = EditorState.create({
      doc: PMDOMParser.fromSchema(this.pmSchema).parse(tmp),
      plugins: exampleSetup({ schema: this.pmSchema }),
    });

    this.view = new EditorView({ mount: this.editorEl }, {
      state,
      dispatchTransaction: (tr) => {
        // Always apply the transaction to update the view
        const view = this.view!;
        const newState = view.state.apply(tr);
        view.updateState(newState);
        
        // Handle changes similar to CodeMirror's beforeChange approach
        if (tr.docChanged && !this.isUpdatingFromSlice) {
          this.handleDocChange(tr, newState);
        }

        // Handle selection changes
        if (tr.selectionSet && !this.isUpdatingFromSlice) {
          this.handleSelectionChange(newState);
        }
      },
    });

    // Subscribe to slice changes - similar to CodeMirror approach
    derived([this.slice.state, this.slice.ephemeral], i => i).subscribe(
      ([state, cursors]) => {
        const stateText = state.text.join('');
        const myAgentSelection = cursors[encodeHashToBase64(this.slice.myPubKey)];

        // Parse the content - check if it's JSON (HTML) or plain text
        let expectedHTML = '';
        if (stateText) {
          try {
            expectedHTML = JSON.parse(stateText);
          } catch (e) {
            expectedHTML = this.convertPlainTextToHTML(stateText);
          }
        }

        // Update content if different (like CodeMirror's setValue check)
        if (this.getHTML() !== expectedHTML) {
          this.isUpdatingFromSlice = true;
          this.setContent(expectedHTML);
          this.isUpdatingFromSlice = false;
        }

        // Handle cursor positioning (like CodeMirror's setSelection)
        if (myAgentSelection) {
          if (state.text.length > 0) {
            const position = elemIdToPosition(
              myAgentSelection.left,
              myAgentSelection.position,
              state.text
            );

            if (position !== null && position !== undefined) {
              this.isUpdatingFromSlice = true;
              this.setCursorPosition(position, position + myAgentSelection.characterCount);
              this.isUpdatingFromSlice = false;
            }
          } else {
            this.isUpdatingFromSlice = true;
            this.setCursorPosition(0, 0);
            this.isUpdatingFromSlice = false;
          }
        }
      }
    );

    // Focus the editor after initialization
    setTimeout(() => {
      this.view?.focus();
    }, 500);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.view?.destroy();
    this.view = null;
  }

  /** Handle document changes - like CodeMirror's onTextInserted/onTextDeleted */
  private handleDocChange(tr: any, newState: EditorState) {
    // Get the new HTML content
    const newHTML = this.getHTMLFromState(newState);
    
    // Send the complete HTML content as JSON to Syn (similar to CodeMirror sending text)
    const serializedHTML = JSON.stringify(newHTML);
    this.slice.change((state, eph) => {
      const changes = textEditorGrammar.changes(this.slice.myPubKey, state, eph);
      // Replace all content with the serialized HTML
      if (state.text.join('').length > 0) {
        changes.delete(0, state.text.join('').length);
      }
      changes.insert(0, serializedHTML);
      return changes;
    });
  }

  /** Convert plain text to simple HTML paragraphs */
  private convertPlainTextToHTML(text: string): string {
    if (!text || text.trim() === '') return '<p></p>';
    
    // Split by newlines and create paragraphs
    const paragraphs = text.split('\n').map(line => 
      line.trim() === '' ? '<p><br></p>' : `<p>${line}</p>`
    ).join('');
    
    return paragraphs;
  }

  /** Set cursor position in the editor - like CodeMirror's setSelection */
  private setCursorPosition(from: number, to: number) {
    if (!this.view) return;
    
    try {
      const docSize = this.view.state.doc.content.size;
      const safeFrom = Math.max(0, Math.min(from, docSize));
      const safeTo = Math.max(safeFrom, Math.min(to, docSize));
      
      const tr = this.view.state.tr.setSelection(
        TextSelection.create(this.view.state.doc, safeFrom, safeTo)
      );
      this.view.dispatch(tr);
    } catch (e) {
      console.warn('Failed to set cursor position:', e);
    }
  }

  /** Get HTML from a specific editor state */
  private getHTMLFromState(state: EditorState): string {
    const frag = DOMSerializer.fromSchema(this.pmSchema).serializeFragment(state.doc.content);
    const div = document.createElement('div');
    div.appendChild(frag);
    return div.innerHTML;
  }

  /** Handle selection changes and sync to slice */
  private handleSelectionChange(state: EditorState) {
    const { from, to } = state.selection;
    this.onSelectionChanged([{ from, to }]);
  }

  /** Handle selection changes for collaborative editing - like CodeMirror */
  onSelectionChanged(ranges: Array<{ from: number; to: number }>) {
    console.log("selectionChanged");
    this.slice.change((state, eph) =>
      textEditorGrammar
        .changes(this.slice.myPubKey, state, eph)
        .changeSelection(ranges[0].from, ranges[0].to - ranges[0].from)
    );
  }

  /** Simple text diffing to detect changes */
  private diffText(oldText: string, newText: string): Array<{type: 'insert' | 'delete', position: number, text?: string, length?: number}> {
    const changes: Array<{type: 'insert' | 'delete', position: number, text?: string, length?: number}> = [];
    
    let i = 0;
    while (i < Math.max(oldText.length, newText.length)) {
      if (i >= oldText.length) {
        // Insertion at end
        changes.push({ type: 'insert', position: i, text: newText.slice(i) });
        break;
      } else if (i >= newText.length) {
        // Deletion at end
        changes.push({ type: 'delete', position: i, length: oldText.length - i });
        break;
      } else if (oldText[i] !== newText[i]) {
        // Find end of difference
        let oldEnd = i;
        let newEnd = i;
        
        // Simple approach: find next matching character
        for (let j = i + 1; j < Math.max(oldText.length, newText.length); j += 1) {
          if (j < oldText.length && j < newText.length && oldText[j] === newText[j]) {
            oldEnd = j;
            newEnd = j;
            break;
          }
          if (j >= oldText.length) oldEnd = oldText.length;
          if (j >= newText.length) newEnd = newText.length;
        }
        
        if (oldEnd > i) {
          changes.push({ type: 'delete', position: i, length: oldEnd - i });
        }
        if (newEnd > i) {
          changes.push({ type: 'insert', position: i, text: newText.slice(i, newEnd) });
        }
        
        i = Math.max(oldEnd, newEnd);
      } else {
        i += 1;
      }
    }
    
    return changes;
  }

  /** Get plain text from ProseMirror state */
  private getPlainText(state: EditorState): string {
    return state.doc.textContent;
  }

  /** Render cursor for remote agents */
  renderCursor(agent: AgentPubKey, agentSelection: AgentSelection) {
    const position = elemIdToPosition(
      agentSelection.left,
      agentSelection.position,
      this._state.value.text
    );
    
    if (!this.view || position === null || position === undefined) return html``;

    const plainText = this.getPlainText(this.view.state);
    if (plainText.length < position) return html``;

    // Get ProseMirror coordinates for the position
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

  /** Programmatically replace content with HTML - like CodeMirror's setValue */
  setContent(html: string) {
    if (!this.view) return;
    
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const doc = PMDOMParser.fromSchema(this.pmSchema).parse(tmp);
    const tr = this.view.state.tr.replaceWith(0, this.view.state.doc.content.size, doc.content);
    this.view.dispatch(tr);
    this.isInitialLoad = false;
  }

  /** Set content as plain text (for collaborative sync) */
  setPlainTextContent(text: string) {
    if (!this.view) return;
    
    // Create simple paragraphs from plain text
    const tmp = document.createElement('div');
    if (text.trim() === '') {
      tmp.innerHTML = '<p></p>';
    } else {
      // Split by newlines and create paragraphs
      const paragraphs = text.split('\n').map(line => 
        line.trim() === '' ? '<p><br></p>' : `<p>${line}</p>`
      ).join('');
      tmp.innerHTML = paragraphs;
    }
    
    const doc = PMDOMParser.fromSchema(this.pmSchema).parse(tmp);
    const tr = this.view.state.tr.replaceWith(0, this.view.state.doc.content.size, doc.content);
    this.view.dispatch(tr);
    this.isInitialLoad = false;
  }

  /** Extract current content as HTML string. */
  getHTML(): string {
    if (!this.view) return '';
    const frag = DOMSerializer.fromSchema(this.pmSchema).serializeFragment(this.view.state.doc.content);
    const div = document.createElement('div');
    div.appendChild(frag);
    return div.innerHTML;
  }

  /** Extract current content as ProseMirror JSON. */
  getJSON() {
    return this.view?.state.doc.toJSON() ?? null;
  }

  /** Focus the editor. */
  focus() {
    this.view?.focus();
  }

  /** Get content for external storage (preserves formatting) */
  getContentForStorage(): string {
    return this.getHTML();
  }

  /** Get collaborative content (plain text for immediate sync) */
  getCollaborativeContent(): string {
    return this.view ? this.getPlainText(this.view.state) : '';
  }

  /** Force save current content to Syn */
  saveToSyn() {
    // For immediate sync mode, we can force update the plain text content
    const plainText = this.view ? this.getPlainText(this.view.state) : '';
    this.slice.change((state, eph) => {
      const changes = textEditorGrammar.changes(this.slice.myPubKey, state, eph);
      // Delete all existing content
      if (state.text.join('').length > 0) {
        changes.delete(0, state.text.join('').length);
      }
      // Insert the current plain text content
      changes.insert(0, plainText);
      return changes;
    });
  }

  /** Check if there are unsaved changes */
  hasUnsavedChanges(): boolean {
    if (!this._state.value || !this.view) return false;
    const synContent = this._state.value.text.join('');
    const currentContent = this.getPlainText(this.view.state);
    return synContent !== currentContent;
  }

  render() {
    if (this._state.value === undefined) return html``;

    return html`
      <div
        style="position: relative; overflow: auto; flex: 1; background-color: white;"
      >
        <div id="editor"></div>

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
    css`
        .ProseMirror {
  position: relative;
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

    `
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'syn-pm-editor': SynPmEditor;
  }
}
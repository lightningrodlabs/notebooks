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
import { EditorState, TextSelection } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';

// Automerge ProseMirror integration
import { init } from '@automerge/prosemirror';
import * as Automerge from '@automerge/automerge';

// Basic ProseMirror setup 
import { exampleSetup } from 'prosemirror-example-setup';

import {
  AgentSelection,
  TextEditorEphemeralState,
  TextEditorState,
  textEditorGrammar,
} from '../grammar.js';
import { elemIdToPosition } from '../utils.js';
import { 
  synToAutomerge, 
  getAutomergeTextContent, 
  updateAutomergeText,
  createEmptyAutomergeDoc,
  htmlToText 
} from './automerge-bridge.js';

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

  /** Automerge document for collaborative editing */
  private automergeDoc: any = null;

  /** ProseMirror plugin from @automerge/prosemirror */
  private automergePlugin: any = null;

  /** The editor's mount point in the shadow DOM. */
  @query('#editor') private editorEl!: HTMLDivElement;

  /** Flag to prevent infinite loops during sync */
  private isUpdatingFromSyn = false;

  firstUpdated() {
    this.initializeAutomergeEditor();
  }

  private async initializeAutomergeEditor() {
    // Create proper Automerge document for rich text
    const synState = this._state.value;
    
    if (synState && synState.text.length > 0) {
      this.automergeDoc = synToAutomerge(synState);
    } else {
      this.automergeDoc = createEmptyAutomergeDoc();
    }

    try {
      // Create a proper DocHandle that @automerge/prosemirror expects
      const docHandle = {
        doc: () => this.automergeDoc,
        change: (changeFn: any) => {
          // Apply changes directly to the document
          const newDoc = Automerge.change(this.automergeDoc, changeFn);
          this.automergeDoc = newDoc;
          
          // Sync changes back to Syn (debounced to avoid loops)
          setTimeout(() => {
            if (!this.isUpdatingFromSyn) {
              this.syncToSyn();
            }
          }, 0);
        },
        on: (event: string, callback: any) => {
          // Mock event handling for now
          console.log('DocHandle.on called with:', event);
        },
        off: (event: string, callback: any) => {
          // Mock event handling for now
          console.log('DocHandle.off called with:', event);
        },
      };

      // Initialize @automerge/prosemirror
      // Use ['content'] as the path to the content field which contains text
      const { schema, pmDoc, plugin } = init(docHandle, ['content']);
      
      this.automergePlugin = plugin;

      // Create ProseMirror state with Automerge plugin
      const state = EditorState.create({
        doc: pmDoc,
        plugins: [
          plugin,
          keymap(baseKeymap),
          // Add basic toolbar
          ...exampleSetup({ schema }),
        ],
      });

      // Create ProseMirror view
      this.view = new EditorView(this.editorEl, {
        state,
        dispatchTransaction: (tr) => {
          const newState = this.view!.state.apply(tr);
          this.view!.updateState(newState);
          
          // Handle selection changes for collaborative cursors
          if (tr.selectionSet && !this.isUpdatingFromSyn) {
            this.handleSelectionChange(newState);
          }
        },
      });

      // Subscribe to Syn changes
      this.subscribeToSynChanges();

      // Focus the editor
      setTimeout(() => {
        this.view?.focus();
      }, 100);

    } catch (error) {
      console.error('Failed to initialize Automerge editor:', error);
      throw error; // Don't fall back, let the error surface
    }
  }

  private subscribeToSynChanges() {
    // Subscribe to slice changes - Automerge-only approach
    derived([this.slice.state, this.slice.ephemeral], i => i).subscribe(
      ([state, cursors]) => {
        if (!this.view || !this.automergeDoc) return;

        const stateText = state.text.join('');
        const currentContent = getAutomergeTextContent(this.automergeDoc);
        
        // Update Automerge document if Syn content changed
        if (stateText !== currentContent && !this.isUpdatingFromSyn) {
          this.isUpdatingFromSyn = true;
          this.automergeDoc = updateAutomergeText(this.automergeDoc, stateText);
          // The @automerge/prosemirror plugin will automatically update the editor
          this.isUpdatingFromSyn = false;
        }

        // Handle cursor positioning for remote users
        const myAgentSelection = cursors[encodeHashToBase64(this.slice.myPubKey)];
        if (myAgentSelection && state.text.length > 0) {
          const position = elemIdToPosition(
            myAgentSelection.left,
            myAgentSelection.position,
            state.text
          );

          if (position !== null && position !== undefined) {
            this.isUpdatingFromSyn = true;
            this.setCursorPosition(position, position + myAgentSelection.characterCount);
            this.isUpdatingFromSyn = false;
          }
        }
      }
    );
  }

  private syncToSyn() {
    if (!this.automergeDoc) return;

    const content = getAutomergeTextContent(this.automergeDoc);
    
    // Convert any rich text back to plain text for Syn storage
    const plainText = htmlToText(content);
    
    this.slice.change((state, eph) => {
      const changes = textEditorGrammar.changes(this.slice.myPubKey, state, eph);
      
      // Replace all content
      if (state.text.length > 0) {
        changes.delete(0, state.text.length);
      }
      if (plainText) {
        changes.insert(0, plainText);
      }
      
      return changes;
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.view?.destroy();
    this.view = null;
    this.automergeDoc = null;
  }

  /** Set cursor position in the editor */
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

  /** Handle selection changes and sync to slice */
  private handleSelectionChange(state: EditorState) {
    const { from, to } = state.selection;
    this.onSelectionChanged([{ from, to }]);
  }

  /** Handle selection changes for collaborative editing */
  onSelectionChanged(ranges: Array<{ from: number; to: number }>) {
    console.log("selectionChanged");
    this.slice.change((state, eph) =>
      textEditorGrammar
        .changes(this.slice.myPubKey, state, eph)
        .changeSelection(ranges[0].from, ranges[0].to - ranges[0].from)
    );
  }

  /** Simple text diffing to detect changes - kept for compatibility but not used with Automerge */
  private diffText(oldText: string, newText: string): Array<{type: 'insert' | 'delete', position: number, text?: string, length?: number}> {
    // This method is kept for compatibility but not used with Automerge integration
    return [];
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

  /** Programmatically replace content - Automerge-only */
  setContent(content: string) {
    if (!this.automergeDoc) return;
    
    this.automergeDoc = updateAutomergeText(this.automergeDoc, content);
    // The @automerge/prosemirror plugin will automatically update the editor
  }

  /** Set content as plain text */
  setPlainTextContent(text: string) {
    this.setContent(text);
  }

  /** Extract current content as HTML string */
  getHTML(): string {
    if (!this.view) return '';
    
    // Return the plain text content for now
    // In a full implementation, you'd extract rich HTML from ProseMirror
    return this.getPlainText(this.view.state);
  }

  /** Extract current content as ProseMirror JSON */
  getJSON() {
    return this.view?.state.doc.toJSON() ?? null;
  }

  /** Focus the editor */
  focus() {
    this.view?.focus();
  }

  /** Get content for external storage (preserves formatting) */
  getContentForStorage(): string {
    return this.getHTML();
  }

  /** Get collaborative content (plain text for sync) */
  getCollaborativeContent(): string {
    return this.view ? this.getPlainText(this.view.state) : '';
  }

  /** Force save current content to Syn */
  saveToSyn() {
    this.syncToSyn();
  }

  /** Check if there are unsaved changes - Automerge-only */
  hasUnsavedChanges(): boolean {
    if (!this._state.value || !this.automergeDoc) return false;
    
    const synContent = this._state.value.text.join('');
    const currentContent = getAutomergeTextContent(this.automergeDoc);
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
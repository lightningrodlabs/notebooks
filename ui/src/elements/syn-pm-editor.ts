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

  // Cache for the last state text to avoid unnecessary rebuilds
  private lastStateText: string = '';

  // Cache for position mapping between ProseMirror and markdown
  private pmToMarkdownMap: Map<number, number> = new Map();

  private markdownToPmMap: Map<number, number> = new Map();

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
    // console.log('createDocFromText input:', JSON.stringify(text));
    if (!text) {
      return this.schema.node('doc', null, [this.schema.node('paragraph')]);
    }

    // Parse lines and group consecutive list items
    const lines = text.split('\n');
    const nodes: PMNode[] = [];
    let i = 0;
    
    while (i < lines.length) {
      const line = lines[i];
      let handled = false;
      
      if (!line) {
        // Empty line = empty paragraph
        nodes.push(this.schema.node('paragraph'));
        i += 1;
      } else {
        // Check for heading
        const headingMatch = line.match(/^(#{1,6})\s(.+)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const content = this.schema.text(headingMatch[2]);
          nodes.push(this.schema.node('heading', { level }, content));
          i += 1;
          handled = true;
        }
        
        // Check for blockquote - group consecutive lines
        if (!handled) {
          const quoteMatch = line.match(/^>\s?(.*)$/);
          if (quoteMatch) {
            const paragraphs: PMNode[] = [];
            while (i < lines.length) {
              const itemMatch = lines[i].match(/^>\s?(.*)$/);
              if (!itemMatch) break;
              const content = this.parseInlineFormatting(itemMatch[1]);
              paragraphs.push(this.schema.node('paragraph', null, content));
              i += 1;
            }
            nodes.push(this.schema.node('blockquote', null, paragraphs));
            handled = true;
          }
        }
        
        // Check for bullet list - group consecutive items
        if (!handled) {
          const bulletMatch = line.match(/^[-*]\s(.+)$/);
          if (bulletMatch) {
            const listItems: PMNode[] = [];
            while (i < lines.length) {
              const itemMatch = lines[i].match(/^[-*]\s(.+)$/);
              if (!itemMatch) break;
              const content = this.parseInlineFormatting(itemMatch[1]);
              listItems.push(this.schema.node('list_item', null, [
                this.schema.node('paragraph', null, content)
              ]));
              i += 1;
            }
            nodes.push(this.schema.node('bullet_list', null, listItems));
            handled = true;
          }
        }
        
        // Check for ordered list - group consecutive items
        if (!handled) {
          const orderedMatch = line.match(/^(\d+)\.\s(.+)$/);
          if (orderedMatch) {
            const listItems: PMNode[] = [];
            const startOrder = parseInt(orderedMatch[1], 10);
            while (i < lines.length) {
              const itemMatch = lines[i].match(/^\d+\.\s(.+)$/);
              if (!itemMatch) break;
              const content = this.parseInlineFormatting(itemMatch[1]);
              listItems.push(this.schema.node('list_item', null, [
                this.schema.node('paragraph', null, content)
              ]));
              i += 1;
            }
            nodes.push(this.schema.node('ordered_list', { order: startOrder }, listItems));
            handled = true;
          }
        }
        
        // Regular paragraph
        if (!handled) {
          const content = this.parseInlineFormatting(line);
          nodes.push(this.schema.node('paragraph', null, content));
          i += 1;
        }
      }
    }

    return this.schema.node('doc', null, nodes);
  }

  private parseInlineFormatting(text: string): PMNode[] | undefined {
    if (!text) return undefined;
    
    const nodes: PMNode[] = [];
    let i = 0;
    
    while (i < text.length) {
      let handled = false;
      
      // Check for links [text](url)
      if (!handled && text[i] === '[') {
        const closeBracket = text.indexOf(']', i + 1);
        if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
          const closeParen = text.indexOf(')', closeBracket + 2);
          if (closeParen !== -1) {
            const linkText = text.substring(i + 1, closeBracket);
            const href = text.substring(closeBracket + 2, closeParen);
            const mark = this.schema.marks.link.create({ href });
            nodes.push(this.schema.text(linkText, [mark]));
            i = closeParen + 1;
            handled = true;
          }
        }
      }
      
      // Check for bold+italic (*** or ***)
      if (!handled && text.substring(i, i + 3) === '***') {
        const end = text.indexOf('***', i + 3);
        if (end !== -1) {
          const content = text.substring(i + 3, end);
          const marks = [this.schema.marks.strong.create(), this.schema.marks.em.create()];
          nodes.push(this.schema.text(content, marks));
          i = end + 3;
          handled = true;
        }
      }
      
      // Check for bold (** or **)
      if (!handled && text.substring(i, i + 2) === '**') {
        const end = text.indexOf('**', i + 2);
        if (end !== -1) {
          const content = text.substring(i + 2, end);
          const mark = this.schema.marks.strong.create();
          nodes.push(this.schema.text(content, [mark]));
          i = end + 2;
          handled = true;
        }
      }
      
      // Check for italic (* or *)
      if (!handled && text[i] === '*') {
        const end = text.indexOf('*', i + 1);
        if (end !== -1 && text[end - 1] !== '*' && (end === i + 1 || text[i + 1] !== '*')) {
          const content = text.substring(i + 1, end);
          const mark = this.schema.marks.em.create();
          nodes.push(this.schema.text(content, [mark]));
          i = end + 1;
          handled = true;
        }
      }
      
      // Check for code (` or `)
      if (!handled && text[i] === '`') {
        const end = text.indexOf('`', i + 1);
        if (end !== -1) {
          const content = text.substring(i + 1, end);
          const mark = this.schema.marks.code.create();
          nodes.push(this.schema.text(content, [mark]));
          i = end + 1;
          handled = true;
        }
      }
      
      // Plain text - collect until next special character
      if (!handled) {
        let plainEnd = i + 1;
        while (plainEnd < text.length && text[plainEnd] !== '*' && text[plainEnd] !== '`' && text[plainEnd] !== '[') {
          plainEnd += 1;
        }
        nodes.push(this.schema.text(text.substring(i, plainEnd)));
        i = plainEnd;
      }
    }
    
    return nodes.length > 0 ? nodes : undefined;
  }

  private docToText(doc: PMNode): string {
    // Custom serialization: use single newlines between paragraphs, not double
    const lines: string[] = [];
    
    doc.forEach((node) => {
      if (node.type.name === 'paragraph') {
        // Serialize the paragraph content to markdown (for bold, italic, etc.)
        let text = '';
        node.forEach((child) => {
          if (child.isText) {
            let prefix = '';
            let suffix = '';
            
            // Check for link mark first
            const linkMark = child.marks.find(m => m.type.name === 'link');
            if (linkMark) {
              // Link format: [text](url)
              prefix = '[';
              suffix = `](${linkMark.attrs.href})`;
            }
            
            // Check for both strong and em marks (bold + italic)
            const hasStrong = child.marks.some(m => m.type.name === 'strong');
            const hasEm = child.marks.some(m => m.type.name === 'em');
            const hasCode = child.marks.some(m => m.type.name === 'code');
            
            if (hasStrong && hasEm) {
              // Both bold and italic = ***
              prefix += '***';
              suffix = '***' + suffix;
            } else if (hasStrong) {
              // Just bold = **
              prefix += '**';
              suffix = '**' + suffix;
            } else if (hasEm) {
              // Just italic = *
              prefix += '*';
              suffix = '*' + suffix;
            } else if (hasCode) {
              // Code = `
              prefix += '`';
              suffix = '`' + suffix;
            }
            
            text += prefix + (child.text || '') + suffix;
          }
        });
        lines.push(text); // Empty string for empty paragraphs
      } else if (node.type.name === 'heading') {
        const level = node.attrs.level || 1;
        const hashes = '#'.repeat(level);
        // Serialize heading content with inline formatting
        let text = '';
        node.forEach((child) => {
          if (child.isText) {
            let prefix = '';
            let suffix = '';
            
            // Check for link mark first
            const linkMark = child.marks.find(m => m.type.name === 'link');
            if (linkMark) {
              prefix = '[';
              suffix = `](${linkMark.attrs.href})`;
            }
            
            const hasStrong = child.marks.some(m => m.type.name === 'strong');
            const hasEm = child.marks.some(m => m.type.name === 'em');
            const hasCode = child.marks.some(m => m.type.name === 'code');
            
            if (hasStrong && hasEm) {
              prefix += '***';
              suffix = '***' + suffix;
            } else if (hasStrong) {
              prefix += '**';
              suffix = '**' + suffix;
            } else if (hasEm) {
              prefix += '*';
              suffix = '*' + suffix;
            } else if (hasCode) {
              prefix += '`';
              suffix = '`' + suffix;
            }
            
            text += prefix + (child.text || '') + suffix;
          }
        });
        lines.push(`${hashes} ${text}`);
      } else if (node.type.name === 'blockquote') {
        // Blockquote: serialize each paragraph on its own line with >
        node.forEach((child) => {
          if (child.type.name === 'paragraph') {
            let text = '';
            child.forEach((textNode) => {
              if (textNode.isText) {
                let prefix = '';
                let suffix = '';
                
                // Check for link mark first
                const linkMark = textNode.marks.find(m => m.type.name === 'link');
                if (linkMark) {
                  prefix = '[';
                  suffix = `](${linkMark.attrs.href})`;
                }
                
                const hasStrong = textNode.marks.some(m => m.type.name === 'strong');
                const hasEm = textNode.marks.some(m => m.type.name === 'em');
                const hasCode = textNode.marks.some(m => m.type.name === 'code');
                
                if (hasStrong && hasEm) {
                  prefix += '***';
                  suffix = '***' + suffix;
                } else if (hasStrong) {
                  prefix += '**';
                  suffix = '**' + suffix;
                } else if (hasEm) {
                  prefix += '*';
                  suffix = '*' + suffix;
                } else if (hasCode) {
                  prefix += '`';
                  suffix = '`' + suffix;
                }
                
                text += prefix + (textNode.text || '') + suffix;
              }
            });
            lines.push(`> ${text}`);
          }
        });
      } else if (node.type.name === 'bullet_list') {
        // Bullet list: each item on its own line with -
        node.forEach((listItem) => {
          if (listItem.type.name === 'list_item') {
            // Serialize the paragraph content inside the list item
            let itemText = '';
            listItem.descendants((child) => {
              if (child.isText) {
                let prefix = '';
                let suffix = '';
                
                // Check for link mark first
                const linkMark = child.marks.find(m => m.type.name === 'link');
                if (linkMark) {
                  prefix = '[';
                  suffix = `](${linkMark.attrs.href})`;
                }
                
                const hasStrong = child.marks.some(m => m.type.name === 'strong');
                const hasEm = child.marks.some(m => m.type.name === 'em');
                const hasCode = child.marks.some(m => m.type.name === 'code');
                
                if (hasStrong && hasEm) {
                  prefix += '***';
                  suffix = '***' + suffix;
                } else if (hasStrong) {
                  prefix += '**';
                  suffix = '**' + suffix;
                } else if (hasEm) {
                  prefix += '*';
                  suffix = '*' + suffix;
                } else if (hasCode) {
                  prefix += '`';
                  suffix = '`' + suffix;
                }
                
                itemText += prefix + (child.text || '') + suffix;
              }
            });
            lines.push(`- ${itemText}`);
          }
        });
      } else if (node.type.name === 'ordered_list') {
        // Ordered list: each item on its own line with number
        const order = node.attrs.order || 1;
        let itemNum = order;
        node.forEach((listItem) => {
          if (listItem.type.name === 'list_item') {
            // Serialize the paragraph content inside the list item
            let itemText = '';
            listItem.descendants((child) => {
              if (child.isText) {
                let prefix = '';
                let suffix = '';
                
                // Check for link mark first
                const linkMark = child.marks.find(m => m.type.name === 'link');
                if (linkMark) {
                  prefix = '[';
                  suffix = `](${linkMark.attrs.href})`;
                }
                
                child.marks.forEach((mark) => {
                  if (mark.type.name === 'strong') {
                    prefix += '**';
                    suffix = '**' + suffix;
                  } else if (mark.type.name === 'em') {
                    prefix += '*';
                    suffix = '*' + suffix;
                  } else if (mark.type.name === 'code') {
                    prefix += '`';
                    suffix = '`' + suffix;
                  }
                });
                itemText += prefix + (child.text || '') + suffix;
              }
            });
            lines.push(`${itemNum}. ${itemText}`);
            itemNum += 1;
          }
        });
      } else {
        // Fallback for other node types
        lines.push(node.textContent);
      }
    });
    
    const markdown = lines.join('\n');
    // console.log('docToText serialized:', JSON.stringify(markdown));
    
    // Build position mapping by walking the doc and the markdown in parallel
    this.buildPositionMaps(doc, markdown);
    
    return markdown;
  }

  private buildPositionMaps(doc: PMNode, markdown: string) {
    this.pmToMarkdownMap.clear();
    this.markdownToPmMap.clear();
    
    // Walk through the document and match it to the markdown string
    let markdownIndex = 0;
    
    doc.forEach((node, offset) => {
      const nodeStart = offset;
      
      if (node.type.name === 'heading') {
        const level = node.attrs.level || 1;
        const prefix = '#'.repeat(level) + ' ';
        markdownIndex += prefix.length; // Skip "# " or "## " etc.
        
        this.mapTextContent(node, nodeStart + 1, markdown, markdownIndex);
        markdownIndex += node.textContent.length;
        
      } else if (node.type.name === 'blockquote') {
        markdownIndex += 2; // Skip "> "
        
        // Blockquote contains a paragraph, so we need to go deeper
        node.forEach((child, childOffset) => {
          if (child.type.name === 'paragraph') {
            this.mapTextContent(child, nodeStart + childOffset + 2, markdown, markdownIndex);
            markdownIndex += child.textContent.length;
          }
        });
        
      } else if (node.type.name === 'bullet_list') {
        node.forEach((listItem, listItemOffset) => {
          if (listItem.type.name === 'list_item') {
            markdownIndex += 2; // Skip "- "
            
            // List item contains a paragraph
            listItem.forEach((child, childOffset) => {
              if (child.type.name === 'paragraph') {
                // PM position = nodeStart (bullet_list) + listItemOffset (list_item) + childOffset (paragraph) + 3
                // +1 for bullet_list open, +1 for list_item open, +1 for paragraph open
                const pmPos = nodeStart + listItemOffset + childOffset + 3;
                this.mapTextContent(child, pmPos, markdown, markdownIndex);
                markdownIndex += child.textContent.length;
              }
            });
            
            // Account for newline after list item
            if (markdownIndex < markdown.length && markdown[markdownIndex] === '\n') {
              markdownIndex += 1;
            }
          }
        });
        return; // Already handled newline
        
      } else if (node.type.name === 'ordered_list') {
        let itemNum = 1;
        node.forEach((listItem, listItemOffset) => {
          if (listItem.type.name === 'list_item') {
            const prefix = `${itemNum}. `;
            markdownIndex += prefix.length; // Skip "1. " or "2. " etc.
            
            // List item contains a paragraph
            listItem.forEach((child, childOffset) => {
              if (child.type.name === 'paragraph') {
                const pmPos = nodeStart + listItemOffset + childOffset + 3;
                this.mapTextContent(child, pmPos, markdown, markdownIndex);
                markdownIndex += child.textContent.length;
              }
            });
            
            // Account for newline after list item
            if (markdownIndex < markdown.length && markdown[markdownIndex] === '\n') {
              markdownIndex += 1;
            }
            
            itemNum += 1;
          }
        });
        return; // Already handled newline
        
      } else if (node.type.name === 'paragraph') {
        this.mapTextContent(node, nodeStart + 1, markdown, markdownIndex);
        markdownIndex += node.textContent.length;
      }
      
      // Account for newline after this node
      if (markdownIndex < markdown.length && markdown[markdownIndex] === '\n') {
        markdownIndex += 1;
      }
    });
    
    // console.log('Built position maps:', {
    //   totalMappings: this.pmToMarkdownMap.size,
    //   pmToMd: Array.from(this.pmToMarkdownMap.entries()).slice(0, 20),
    //   mdToPm: Array.from(this.markdownToPmMap.entries()).slice(0, 20),
    //   markdown: JSON.stringify(markdown.substring(0, 100)),
    // });
  }

  private mapTextContent(node: PMNode, pmStart: number, markdown: string, mdStart: number) {
    let markdownIndex = mdStart;
    
    node.descendants((child, pos) => {
      if (child.isText && child.text) {
        const pmPos = pmStart + pos;
        
        // For each character in the text, map to markdown position
        for (let i = 0; i < child.text.length; i += 1) {
          const charPmPos = pmPos + i;
          const char = child.text[i];
          
          // Skip markdown syntax characters (**,  *, `)
          while (markdownIndex < markdown.length && 
                 (markdown[markdownIndex] === '*' || markdown[markdownIndex] === '`')) {
            markdownIndex += 1;
          }
          
          // Find this character in the markdown
          if (markdownIndex < markdown.length && markdown[markdownIndex] === char) {
            this.pmToMarkdownMap.set(charPmPos, markdownIndex);
            this.markdownToPmMap.set(markdownIndex, charPmPos);
            markdownIndex += 1;
          }
        }
        
        // Skip closing markdown syntax characters
        while (markdownIndex < markdown.length && 
               (markdown[markdownIndex] === '*' || markdown[markdownIndex] === '`')) {
          markdownIndex += 1;
        }
      }
      return true;
    });
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
    // Subscribe to state separately from ephemeral (cursors)
    // This way cursor changes don't trigger document rebuilds
    this.slice.state.subscribe((state) => {
      if (!this.view) return;

      const stateText = state.text.join('');
      
      // Only rebuild if the text actually changed
      if (stateText === this.lastStateText) {
        return; // Text hasn't changed, don't rebuild
      }
      
      this.lastStateText = stateText;
      const currentText = this.docToText(this.view.state.doc);

      if (stateText !== currentText && !this.isUpdatingFromSyn) {
        // console.log('Updating editor from Syn - text changed');
        this.isUpdatingFromSyn = true;
          
          const lines = stateText.split('\n');
          // console.log('Split into lines:', lines.length, 'lines:', JSON.stringify(lines));
          
          const newDoc = this.createDocFromText(stateText);
          const newDocText = this.docToText(newDoc);
          // console.log('Created doc, paragraphs:', newDoc.childCount, 'docToText:', JSON.stringify(newDocText), 'matches input:', newDocText === stateText);
          
          // Replace entire document
          const tr = this.view.state.tr.replaceWith(
            0, 
            this.view.state.doc.content.size,
            newDoc.content
          );
          
          // Try to preserve cursor position
          const cursors = this._cursors.value;
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
    
    // Convert ProseMirror positions to markdown positions before storing in Syn
    const markdownFrom = this.proseMirrorPosToMarkdownPos(ranges[0].from);
    const markdownTo = this.proseMirrorPosToMarkdownPos(ranges[0].to);
    
    // console.log('Selection changed:', {
    //   pmFrom: ranges[0].from,
    //   pmTo: ranges[0].to,
    //   markdownFrom,
    //   markdownTo,
    //   markdown: this.getPlainText(),
    // });
    
    this.slice.change((state, eph) =>
      textEditorGrammar
        .changes(this.slice.myPubKey, state, eph)
        .changeSelection(markdownFrom, markdownTo - markdownFrom)
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
    // Return markdown text to match what's stored in Syn
    return this.view ? this.docToText(this.view.state.doc) : '';
  }

  // Map a character position in markdown text to a ProseMirror document position
  private markdownPosToProseMirrorPos(markdownPos: number): number {
    if (!this.view) return 0;
    
    // Use cached mapping if available
    const pmPos = this.markdownToPmMap.get(markdownPos);
    if (pmPos !== undefined) {
      return pmPos + 1; // +1 for document opening
    }
    
    // Fallback: find closest mapped position
    let closestMd = markdownPos;
    while (closestMd > 0 && !this.markdownToPmMap.has(closestMd)) {
      closestMd -= 1;
    }
    const closestPm = this.markdownToPmMap.get(closestMd) || 0;
    return closestPm + (markdownPos - closestMd) + 1;
  }

  // Map a ProseMirror document position to markdown text position
  private proseMirrorPosToMarkdownPos(pmPos: number): number {
    if (!this.view) return 0;
    
    // Adjust for document structure
    const adjustedPmPos = pmPos - 1;
    
    // Use cached mapping if available
    const mdPos = this.pmToMarkdownMap.get(adjustedPmPos);
    // console.log('PM to MD mapping:', { pmPos, adjustedPmPos, mdPos, hasMapping: mdPos !== undefined });
    
    if (mdPos !== undefined) {
      return mdPos;
    }
    
    // Fallback: find closest mapped position
    let closestPm = adjustedPmPos;
    while (closestPm > 0 && !this.pmToMarkdownMap.has(closestPm)) {
      closestPm -= 1;
    }
    const closestMd = this.pmToMarkdownMap.get(closestPm) || 0;
    const result = closestMd + (adjustedPmPos - closestPm);
    // console.log('PM to MD fallback:', { closestPm, closestMd, result });
    return result;
  }

  renderCursor(agent: AgentPubKey, agentSelection: AgentSelection) {
    // Don't render cursors while we're updating from Syn to avoid flickering
    if (this.isUpdatingFromSyn) return html``;
    
    if (!this.view) return html``;
    
    // Get the current document text and verify it matches Syn state
    const markdown = this.getPlainText();
    const stateText = this._state.value.text.join('');
    
    // If document and state are out of sync, don't render cursor (will flicker)
    if (markdown !== stateText) {
      // console.log('Skipping cursor render - doc/state mismatch');
      return html``;
    }
    
    const position = elemIdToPosition(
      agentSelection.left,
      agentSelection.position,
      this._state.value.text
    );
    
    if (position === null || position === undefined) return html``;
    if (markdown.length < position) return html``;

    // Map markdown position to ProseMirror position
    const pmPos = this.markdownPosToProseMirrorPos(position);
    
    // console.log('Render cursor:', {
    //   markdownPos: position,
    //   pmPos,
    //   markdownChar: markdown[position],
    //   docSize: this.view.state.doc.content.size,
    // });
    
    // Clamp position to valid range
    const clampedPos = Math.max(0, Math.min(pmPos, this.view.state.doc.content.size));
    
    const coords = this.view.coordsAtPos(clampedPos);

    if (!coords) return html``;

    // Get editor container position to make cursor relative
    const editorRect = this.editorEl.getBoundingClientRect();

    return html`<agent-cursor
      style=${styleMap({
        left: `${coords.left - editorRect.left}px`,
        top: `${coords.top - editorRect.top}px`,
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
      margin: 0 !important;
      padding: 0 !important;
      box-sizing: border-box;
      border: 1px solid #ddd;
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

    .ProseMirror p:first-child,
    .ProseMirror h1:first-child,
    .ProseMirror h2:first-child,
    .ProseMirror h3:first-child,
    .ProseMirror h4:first-child,
    .ProseMirror h5:first-child,
    .ProseMirror h6:first-child {
      margin: 6px 0;
    }

    .ProseMirror {
      padding: 4px 8px 4px 14px;
      line-height: 1.2;
      outline: none;
      height: calc(100vh - 131px);
    }

    .ProseMirror p { margin: 6px 0;}
  
  `;
}
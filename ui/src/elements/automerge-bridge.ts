import * as Automerge from '@automerge/automerge';
import { TextEditorState } from '../grammar.js';

/**
 * Bridge utilities to convert between Syn's text array format and Automerge rich text documents
 * This allows us to use @automerge/prosemirror while maintaining compatibility with Holochain Syn
 */

export interface AutomergeDocument {
  content: any; // Will be an Automerge text object
}

/**
 * Convert Syn text editor state to Automerge document format
 */
export function synToAutomerge(textEditorState: TextEditorState): any {
  console.log('Converting Syn to Automerge:', textEditorState);
  
  // Get text content from Syn (it's stored as an array of characters)
  const textContent = textEditorState.text.join('');
  console.log('Text content:', textContent);
  
  // Create Automerge document with text object using the change pattern
  // This creates a proper text object that supports spans for @automerge/prosemirror
  let doc = Automerge.init();
  doc = Automerge.change(doc, 'Initialize content', (draft: any) => {
    draft.content = textContent || '';
  });
  
  console.log('Created Automerge doc:', doc);
  return doc;
}

/**
 * Extract content from Automerge document
 */
export function getAutomergeTextContent(doc: any): string {
  try {
    if (typeof doc.content === 'string') {
      return doc.content;
    }
    if (doc.content && typeof doc.content.toString === 'function') {
      return doc.content.toString();
    }
    return doc.content || '';
  } catch (e) {
    console.warn('Failed to get content from Automerge document:', e);
    return '';
  }
}

/**
 * Update Automerge document with new content
 */
export function updateAutomergeText(doc: any, content: string): any {
  return Automerge.change(doc, 'Update content', (draft: AutomergeDocument) => {
    // Replace the entire content
    draft.content = content;
  });
}

/**
 * Create empty Automerge document with proper structure for @automerge/prosemirror
 */
export function createEmptyAutomergeDoc(): any {
  // Create document with text object using the change pattern
  let doc = Automerge.init();
  doc = Automerge.change(doc, 'Initialize empty content', (draft: any) => {
    draft.content = '';
  });
  
  return doc;
}

/**
 * Convert plain text to basic HTML paragraphs for ProseMirror
 */
export function textToHTML(text: string): string {
  if (!text || text.trim() === '') return '<p></p>';
  
  // Split by double newlines for paragraphs, single newlines for breaks
  const paragraphs = text.split('\n\n').map(paragraph => {
    const lines = paragraph.split('\n').join('<br>');
    return lines.trim() === '' ? '<p><br></p>' : `<p>${lines}</p>`;
  }).join('');
  
  return paragraphs;
}

/**
 * Convert HTML back to plain text for Syn storage
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  
  // Create a temporary div to parse HTML
  const div = document.createElement('div');
  div.innerHTML = html;
  
  // Extract text content and normalize line breaks
  return div.textContent || div.innerText || '';
}
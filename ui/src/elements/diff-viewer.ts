import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { ActionHash } from '@holochain/client';
import { Commit, DocumentStore, synDocumentContext } from '@holochain-syn/core';
import { EntryRecord } from '@holochain-open-dev/utils';
import { TextEditorState, TextEditorEphemeralState } from '@holochain-syn/text-editor';
import { msg } from '@lit/localize';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiFileCompare } from '@mdi/js';

@customElement('diff-viewer')
export class DiffViewer extends LitElement {
  @consume({ context: synDocumentContext, subscribe: true })
  @property()
  documentStore!: DocumentStore<TextEditorState, TextEditorEphemeralState>;

  @property()
  selectedCommitHash?: ActionHash;

  @property()
  currentState?: TextEditorState;

  @state()
  private _loading: boolean = false;

  @state()
  private _originalText: string = '';

  @state()
  private _modifiedText: string = '';

  @state()
  private _diffLines: Array<{original: string, modified: string, type: 'equal' | 'insert' | 'delete' | 'change'}> = [];

  private _resizeObserver?: ResizeObserver;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
    }

    .diff-container {
      flex: 1;
      height: 100%;
      width: 100%;
      border: 1px solid var(--sl-color-neutral-200);
      border-radius: var(--sl-border-radius-medium);
      overflow-y: scroll;
      position: relative;
      min-height: 0;
      background: white;
    }

    .custom-diff-view {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      grid-auto-rows: auto;
      height: 100%;
      max-height: 600px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      font-size: 14px;
      line-height: 1.6;
      overflow-y: auto;
    }

    .diff-side-header {
      font-weight: bold;
      padding: 0.75rem;
      background-color: var(--sl-color-neutral-100);
      border-bottom: 1px solid var(--sl-color-neutral-200);
      text-align: center;
      z-index: 1;
      position: sticky;
      top: 0;
    }

    .diff-side-header:first-child {
      border-right: 1px solid var(--sl-color-neutral-200);
    }

    .diff-line {
      margin: 0;
      padding: 8px 12px;
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow-wrap: break-word;
      border-left: 3px solid transparent;
      border-radius: 4px;
      line-height: 1.6;
      display: flex;
      align-items: flex-start;
      min-width: 0;
      width: 100%;
      box-sizing: border-box;
    }

    .diff-line span {
      width: 100%;
      word-wrap: break-word;
      overflow-wrap: break-word;
      white-space: pre-wrap;
    }

    .diff-line:nth-child(odd) {
      border-right: 1px solid var(--sl-color-neutral-200);
    }

    .diff-line-equal {
      background-color: transparent;
    }

    .diff-line-insert {
      background-color: #e6ffed;
      border-left-color: #28a745;
    }

    .diff-line-delete {
      background-color: #ffeef0;
      border-left-color: #d73a49;
    }

    .diff-line-change {
      background-color: #fff3cd;
      border-left-color: #ffc107;
    }

    .diff-line-empty {
      background-color: #f8f9fa;
      color: #6c757d;
      font-style: italic;
      text-align: center;
      padding: 12px;
      border: 1px dashed #dee2e6;
      border-radius: 4px;
      justify-content: center;
    }

    .loading-container,
    .error-container,
    .no-selection-container {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      flex-direction: column;
      gap: 1rem;
      /* color: var(--sl-color-neutral-600); */
    }

    .diff-header {
      padding: 1rem;
      border-bottom: 1px solid var(--sl-color-neutral-200);
      background-color: var(--sl-color-neutral-50);
      font-weight: 500;
    }

    .diff-legend {
      display: flex;
      gap: 1rem;
      align-items: center;
      font-size: 0.875rem;
      margin-top: 0.5rem;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .legend-color {
      width: 12px;
      height: 12px;
      border-radius: 2px;
    }

    .legend-added {
      background-color: #4caf50;
    }

    .legend-removed {
      background-color: #f44336;
    }
  `;

  firstUpdated() {
    // Load content if commit is already selected
    if (this.selectedCommitHash) {
      this.loadDiffContent();
    }
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    if (changedProperties.has('selectedCommitHash') || changedProperties.has('currentState')) {
      this.loadDiffContent();
    }
  }

  private computeDiff(originalText: string, modifiedText: string) {
    // Split text into semantic chunks (paragraphs, then sentences, then words)
    const originalChunks = this.splitIntoChunks(originalText);
    const modifiedChunks = this.splitIntoChunks(modifiedText);
    
    // Use a simple LCS (Longest Common Subsequence) algorithm for semantic diffing
    const diffResult = this.computeLCS(originalChunks, modifiedChunks);
    this._diffLines = this.formatDiffOutput(diffResult);
  }

  private splitIntoChunks(text: string): string[] {
    // Handle empty text
    if (!text || text.trim().length === 0) {
      return [];
    }

    // Split by paragraphs first (double newlines or markdown-style breaks)
    const paragraphs = text.split(/\n/).filter(p => p.trim().length > 0);
    const chunks: string[] = [];
    
    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();
      
      // Check if it's a markdown heading, list item, or other special format
      if (trimmed.match(/^#+\s/) || // Headings
          trimmed.match(/^[*-]\s/) || // List items
          trimmed.match(/^\d+\.\s/) || // Numbered lists
          trimmed.match(/^>\s/) || // Blockquotes
          trimmed.match(/^```/) || // Code blocks
          trimmed.length < 100) { // Short paragraphs
        chunks.push(trimmed);
      } else {
        // For longer paragraphs, split by sentences but try to keep logical groups
        const sentences = trimmed.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(s => s.trim().length > 0);
        
        if (sentences.length <= 2) {
          chunks.push(trimmed);
        } else {
          // Group sentences into logical chunks (max 2-3 sentences per chunk)
          let currentChunk = '';
          let sentenceCount = 0;
          
          for (const sentence of sentences) {
            if (sentenceCount === 0) {
              currentChunk = sentence.trim();
              sentenceCount = 1;
            } else if (sentenceCount < 2 || sentence.length < 50) {
              currentChunk += ' ' + sentence.trim();
              sentenceCount += 1;
            } else {
              chunks.push(currentChunk);
              currentChunk = sentence.trim();
              sentenceCount = 1;
            }
          }
          
          if (currentChunk.trim().length > 0) {
            chunks.push(currentChunk);
          }
        }
      }
    }
    
    return chunks.length > 0 ? chunks : [text.trim()]; // Fallback to original text if no chunks
  }

  private computeLCS(original: string[], modified: string[]): Array<{
    type: 'equal' | 'insert' | 'delete';
    original?: string;
    modified?: string;
  }> {
    const m = original.length;
    const n = modified.length;
    
    // Create LCS table
    const lcs: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    // Fill LCS table
    for (let i = 1; i <= m; i += 1) {
      for (let j = 1; j <= n; j += 1) {
        if (original[i - 1] === modified[j - 1]) {
          lcs[i][j] = lcs[i - 1][j - 1] + 1;
        } else {
          lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
        }
      }
    }
    
    // Backtrack to find the diff
    const result: Array<{
      type: 'equal' | 'insert' | 'delete';
      original?: string;
      modified?: string;
    }> = [];
    
    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && original[i - 1] === modified[j - 1]) {
        result.unshift({
          type: 'equal',
          original: original[i - 1],
          modified: modified[j - 1]
        });
        i -= 1;
        j -= 1;
      } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
        result.unshift({
          type: 'insert',
          modified: modified[j - 1]
        });
        j -= 1;
      } else if (i > 0) {
        result.unshift({
          type: 'delete',
          original: original[i - 1]
        });
        i -= 1;
      }
    }
    
    return result;
  }

  private formatDiffOutput(diffResult: Array<{
    type: 'equal' | 'insert' | 'delete';
    original?: string;
    modified?: string;
  }>): Array<{original: string, modified: string, type: 'equal' | 'insert' | 'delete' | 'change'}> {
    const formatted: Array<{original: string, modified: string, type: 'equal' | 'insert' | 'delete' | 'change'}> = [];
    
    for (const item of diffResult) {
      if (item.type === 'equal') {  
        formatted.push({
          original: item.original || '',
          modified: item.modified || '',
          type: 'equal'
        });
      } else if (item.type === 'insert') {
        formatted.push({
          original: '',
          modified: item.modified || '',
          type: 'insert'
        });
      } else if (item.type === 'delete') {
        formatted.push({
          original: item.original || '',
          modified: '',
          type: 'delete'
        });
      }
    }
    
    return formatted;
  }

  private async loadDiffContent() {
    if (!this.selectedCommitHash) {
      return;
    }

    this._loading = true;
    
    try {
      // Get the selected commit content
      const selectedCommitStore = this.documentStore.commits.get(this.selectedCommitHash);
      const selectedCommit = await new Promise((resolve, reject) => {
        let cleanup: (() => void) | null = null;
        
        cleanup = selectedCommitStore!.subscribe(value => {
          if (value.status === 'complete') {
            if (cleanup) cleanup();
            resolve(value.value);
          } else if (value.status === 'error') {
            if (cleanup) cleanup();
            reject(value.error);
          }
        });
      });

      if (!selectedCommit) {
        return;
      }

      // Commits may be deltas, so the state has to be resolved by walking
      // back to the nearest snapshot ancestor rather than read off the entry
      const selectedState = (await this.documentStore.resolveCommitState(
        selectedCommit as EntryRecord<Commit>
      )) as TextEditorState;
      const selectedText = selectedState.text.join('');

      // Use the provided current state or empty string as fallback
      const currentText = this.currentState ? this.currentState.text.join('') : '';

      // Store the texts and compute diff
      this._originalText = selectedText;
      this._modifiedText = currentText;
      this.computeDiff(selectedText, currentText);
      
    } catch (error) {
      console.error('Error loading diff content:', error);
    } finally {
      this._loading = false;
    }
  }

  private renderCustomDiff() {
    if (this._diffLines.length === 0) {
      return html`
        <div class="no-selection-container">
          <span>${msg('No differences to display')}</span>
        </div>
      `;
    }

    return html`
      <div class="custom-diff-view">
        <div class="diff-side-header">${msg('Selected Commit')}</div>
        <div class="diff-side-header">${msg('Current Version')}</div>
        ${this._diffLines.map(line => {
          const leftEmpty = !line.original || line.original.trim() === '';
          const rightEmpty = !line.modified || line.modified.trim() === '';
          
          const leftCssClass = line.type === 'insert' ? 'diff-line-empty' : 
                              line.type === 'delete' ? 'diff-line-delete' :
                              line.type === 'change' ? 'diff-line-change' : 'diff-line-equal';
          
          const rightCssClass = line.type === 'delete' ? 'diff-line-empty' : 
                                line.type === 'insert' ? 'diff-line-insert' :
                                line.type === 'change' ? 'diff-line-change' : 'diff-line-equal';
          
          return html`
            <div class="diff-line ${leftCssClass}">
              <span>${leftEmpty ? '(no content)' : line.original}</span>
            </div>
            <div class="diff-line ${rightCssClass}">
              <span>${rightEmpty ? '(no content)' : line.modified}</span>
            </div>
          `;
        })}
      </div>
    `;
  }

  private renderDiffHeader() {
    if (!this.selectedCommitHash) return '';

    return html`
      <div class="diff-header">
        <div>${msg('Comparing selected commit with current version')}</div>
        <div class="diff-legend">
          <div class="legend-item">
            <div class="legend-color legend-removed"></div>
            <span>${msg('Removed content')}</span>
          </div>
          <div class="legend-item">
            <div class="legend-color legend-added"></div>
            <span>${msg('Added content')}</span>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    if (!this.selectedCommitHash) {
      return html`
        <div class="no-selection-container">
          <sl-icon .src=${wrapPathInSvg(mdiFileCompare)} style="font-size: 3rem; color: var(--sl-color-neutral-400);"></sl-icon>
          <span>${msg('Select a commit to view differences')}</span>
        </div>
      `;
    }

    if (this._loading) {
      return html`
        <div class="loading-container">
          <sl-spinner style="font-size: 3rem;"></sl-spinner>
          <span>${msg('Loading diff...')}</span>
        </div>
      `;
    }

    return html`
      ${this.renderDiffHeader()}
      <div class="diff-container">
        ${this.renderCustomDiff()}
      </div>
    `;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    
    // Clean up resize observer
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'diff-viewer': DiffViewer;
  }
}

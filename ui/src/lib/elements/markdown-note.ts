import { ScopedElementsMixin } from '@open-wc/scoped-elements';
import { html, LitElement } from 'lit';

export class MarkdownNote extends ScopedElementsMixin(LitElement) {
  render() {
    return html`<prism-markdown-element></prism-markdown-element>`;
  }
}

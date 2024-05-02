import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiArrowDown, mdiArrowUp } from '@mdi/js';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';


export enum SortDirection {
    None = "",
    Ascending = "a",
    Descending = "d",
}
  
@customElement('column-label')
export class ColumnLabel extends LitElement {
  @property()
  direction: SortDirection = SortDirection.Descending

  doSelect() {
    this.direction = (this.direction === SortDirection.Descending) ?  SortDirection.Ascending : SortDirection.Descending
    this.dispatchEvent(
      new CustomEvent("column-selected", {
        bubbles: true,
        composed: true,
        detail: {
            direction: this.direction
        }
      })
    )}

    renderDirection() {
        if (this.direction === SortDirection.None) return html``
        return html`
            <sl-icon
            .src=${wrapPathInSvg(this.direction === SortDirection.Ascending ? mdiArrowUp : mdiArrowDown)}
        ></sl-icon>`
    }
    
    render() {
    return html`
    <div class="label"
        @click=${()=>{this.doSelect()}}
        @keypress=${(e: KeyboardEvent) => {
        if (e.key === "Enter") {
            this.doSelect()
        }
        }}>

      <slot></slot>
      ${this.renderDirection()}
    </div>
    `;
  }

  static styles = css`
    .label {
      cursor:pointer;
    }
  `;
}

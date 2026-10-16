import { css, html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { msg } from "@lit/localize";
import { wrapPathInSvg } from "@holochain-open-dev/elements";
import { mdiMagnify } from "@mdi/js";
import SlInput from "@shoelace-style/shoelace/dist/components/input/input.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import "@shoelace-style/shoelace/dist/components/icon-button/icon-button.js";
import { findHits, Reveal } from "../search.js";

/** Something to search: a note's title and markdown text. */
export interface SearchSource {
  id: string;
  title: string;
  text: string;
  archived?: boolean;
}

/** What was clicked in the results: a note, and the hit in it if a hit was clicked. */
export interface SearchPick {
  id: string;
  reveal?: Reveal;
}

/** Hits listed per note, when searching several, before the rest are summarised as a count. */
const HITS_PER_NOTE = 20;

/** Query and panel state by `memory` key, so they survive the element being re-created. */
const remembered = new Map<string, { query: string; open: boolean }>();

/**
 * A search input with its results in a panel that hangs below it, right-aligned,
 * over whatever is underneath. Clicking a result fires `search-pick`; clicking
 * outside the panel or pressing Escape closes it. Up/Down move through the hits
 * and Enter picks the current one. With `stayOpen` (searching the open note)
 * the panel stays up after a pick and Up/Down pick as they move; otherwise a
 * pick closes it. With one source the per-note headings are left out.
 */
@customElement("search-box")
export class SearchBox extends LitElement {
  @property({ attribute: false })
  sources: SearchSource[] = [];

  /** Key under which the query and open state are kept; empty keeps nothing. */
  @property()
  memory = "";

  @property()
  placeholder = "";

  /** The area the panel may cover: it runs down to this rect's bottom and stays within its sides. */
  @property({ attribute: false })
  bounds: () => DOMRect | undefined = () => undefined;

  /** Narrowest the panel likes to be, and how much of the area it leaves showing on the left. */
  @property({ type: Number })
  minPanelWidth = 420;

  @property({ type: Number })
  leave = 140;

  /** Keep the panel open after a pick, and pick on Up/Down. */
  @property({ type: Boolean })
  stayOpen = false;

  /** Show just a search button until it is clicked (or Ctrl/Cmd+F); fold back when left empty. */
  @property({ type: Boolean })
  collapsible = false;

  @state()
  expanded = false;

  /** Ctrl/Cmd+F focuses this box. */
  @property({ type: Boolean })
  findKey = false;

  @state()
  query = "";

  @state()
  open = false;

  /** Index of the current hit in `picks`, or -1. */
  @state()
  active = -1;

  /** The hits as listed, in order, from the last render. */
  private picks: SearchPick[] = [];

  @query("sl-input")
  private input!: SlInput;

  connectedCallback() {
    super.connectedCallback();
    const r = remembered.get(this.memory);
    if (this.memory && r) {
      this.query = r.query;
      this.open = r.open;
    }
    this.expanded = !!this.query.trim();
    window.addEventListener("resize", this.onResize);
    document.addEventListener("pointerdown", this.onPointerDown);
    document.addEventListener("keydown", this.onKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("pointerdown", this.onPointerDown);
    document.removeEventListener("keydown", this.onKeyDown);
    super.disconnectedCallback();
  }

  async focus() {
    if (!this.expanded) {
      this.expanded = true;
      await this.updateComplete;
    }
    this.input?.focus();
    this.input?.select();
  }

  updated() {
    this.toggleAttribute("collapsed", this.collapsible && !this.expanded);
  }

  private remember() {
    if (this.memory) remembered.set(this.memory, { query: this.query, open: this.open });
  }

  private setQuery(query: string) {
    this.query = query;
    this.active = -1;
    this.setOpen(!!query.trim());
  }

  private setOpen(open: boolean) {
    this.open = open;
    this.remember();
  }

  private onResize = () => {
    if (this.open) this.requestUpdate();
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.open && !e.composedPath().includes(this)) this.setOpen(false);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.findKey && e.key.toLowerCase() === "f" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      this.focus();
      this.setOpen(!!this.query.trim());
    } else if (e.key === "Escape" && this.open) {
      this.setOpen(false);
    }
  };

  private pick(p: SearchPick, index = -1) {
    this.active = index;
    if (!this.stayOpen) this.setOpen(false);
    this.dispatchEvent(new CustomEvent<SearchPick>("search-pick", { detail: p, bubbles: true, composed: true }));
  }

  /**
   * Fixed to the window rather than placed in the layout, so long results
   * scroll inside the panel instead of stretching whatever scrolls around it.
   * It fits its results, growing at most to the bottom of `bounds`.
   */
  private panelStyle() {
    const s = this.input?.getBoundingClientRect();
    if (!s) return "";
    const area = this.bounds();
    const left = (area ? area.left : 0) + 16;
    const right = area ? Math.min(s.right, area.right - 16) : s.right;
    const bottom = area ? area.bottom : window.innerHeight;
    const available = right - left;
    const width = Math.max(0, Math.min(Math.max(available / 2, this.minPanelWidth), available - this.leave));
    return `top:${s.bottom + 8}px; left:${right - width}px; width:${width}px; max-height:${Math.max(120, bottom - s.bottom - 24)}px;`;
  }

  private step(by: number) {
    const n = this.picks.length;
    if (n === 0) return;
    const next = this.active < 0 ? (by > 0 ? 0 : n - 1) : (this.active + by + n) % n;
    if (this.stayOpen) this.pick(this.picks[next], next);
    else this.active = next;
    this.updateComplete.then(() => {
      this.shadowRoot?.querySelector(".hit.active")?.scrollIntoView({ block: "nearest" });
    });
  }

  private onPanelKeys = (e: KeyboardEvent) => {
    if (!this.open || !this.query.trim()) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      this.step(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter" && this.picks.length > 0) {
      e.preventDefault();
      const i = this.active < 0 ? 0 : this.active;
      this.pick(this.picks[i], i);
    }
  };

  private renderResults() {
    const query = this.query.trim();
    const single = this.sources.length === 1;
    const results = this.sources
      .map(source => ({ source, ...findHits(source.text, query, single ? Infinity : HITS_PER_NOTE) }))
      .filter(r => r.total > 0 || (!single && r.source.title.toLowerCase().includes(query.toLowerCase())));
    const total = results.reduce((n, r) => n + r.total, 0);
    const picks: SearchPick[] = [];
    this.picks = picks;
    const matches = (n: number) => `${n} ${n === 1 ? msg("match") : msg("matches")}`;
    if (results.length === 0) return html`<div class="summary">${msg("No matches.")}</div>`;
    return html`
      <div class="summary">
        ${single ? matches(total) : html`${matches(total)} ${msg("in")} ${results.length} ${results.length === 1 ? msg("note") : msg("notes")}`}
      </div>
      ${results.map(r => html`
        <div class="note">
          ${single ? "" : html`
            <div class="title" tabindex="0"
              @click=${() => this.pick({ id: r.source.id })}
              @keypress=${(e: KeyboardEvent) => { if (e.key === "Enter") this.pick({ id: r.source.id }); }}
            >
              <span>${r.source.title}</span>
              ${r.source.archived ? html`<span class="archived">${msg("Archived")}</span>` : ""}
              <span class="count">${matches(r.total)}</span>
            </div>
          `}
          ${r.hits.map(hit => {
            const p: SearchPick = { id: r.source.id, reveal: { query, offset: hit.offset } };
            const index = picks.push(p) - 1;
            return html`
            <div class="hit ${single ? "single" : ""} ${index === this.active ? "active" : ""}" tabindex="-1"
              @click=${() => this.pick(p, index)}
              @keypress=${(e: KeyboardEvent) => { if (e.key === "Enter") this.pick(p, index); }}
            >${hit.before}<mark>${hit.match}</mark>${hit.after}</div>
          `;
          })}
          ${r.total > r.hits.length ? html`<div class="more">${msg("and")} ${r.total - r.hits.length} ${msg("more")}</div>` : ""}
        </div>
      `)}
    `;
  }

  render() {
    if (this.collapsible && !this.expanded)
      return html`<sl-icon-button
        .src=${wrapPathInSvg(mdiMagnify)}
        label=${this.placeholder || msg("Search")}
        title=${this.placeholder || msg("Search")}
        @click=${() => this.focus()}
      ></sl-icon-button>`;
    return html`
      <div @keydown=${this.onPanelKeys}>
      <sl-input
        size="small"
        clearable
        .placeholder=${this.placeholder || msg("Search")}
        .value=${this.query}
        @sl-input=${(e: CustomEvent) => this.setQuery((e.target as SlInput).value)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            this.setQuery("");
          }
        }}
        @sl-focus=${() => this.setOpen(!!this.query.trim())}
        @sl-blur=${() => { if (!this.query.trim()) this.expanded = false; }}
      >
        <sl-icon slot="prefix" .src=${wrapPathInSvg(mdiMagnify)}></sl-icon>
      </sl-input>
      ${this.open && this.query.trim() ? html`<div class="panel" style=${this.panelStyle()}>${this.renderResults()}</div>` : ""}
      </div>
    `;
  }

  static styles = css`
    :host {
      display: block;
      width: 320px;
      min-width: 140px;
      flex-shrink: 1;
    }
    :host([collapsed]) {
      width: auto;
      min-width: 0;
      flex-shrink: 0;
    }
    sl-icon-button {
      font-size: 20px;
    }
    .panel {
      position: fixed;
      overflow-y: auto;
      z-index: 1000;
      box-sizing: border-box;
      padding: 10px 12px;
      background: white;
      border: solid 1px #ccc;
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
      text-align: left;
      font-size: 16px;
    }
    .summary {
      color: #666;
      margin-bottom: 8px;
    }
    .note {
      border-bottom: solid 1px #ccc;
      padding: 8px 5px;
    }
    .title {
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 18px;
      margin-bottom: 4px;
    }
    .count {
      color: #666;
      font-size: 13px;
    }
    .hit {
      cursor: pointer;
      padding: 3px 8px;
      margin-left: 12px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 13px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .hit.single {
      margin-left: 0;
    }
    .hit:hover, .title:hover {
      background: #eef4f8;
    }
    .hit.active {
      background: #dbeafe;
      outline: solid 1px #93c5fd;
    }
    .hit mark {
      background: #fde68a;
      border-radius: 2px;
    }
    .more {
      color: #666;
      font-size: 13px;
      margin-left: 20px;
      padding: 3px 0;
    }
    .archived {
      background-color: lightgray;
      border-radius: 10px;
      font-size: 80%;
      padding: 5px;
    }
  `;
}

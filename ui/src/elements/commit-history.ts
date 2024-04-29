import { css, html, LitElement } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { consume, createContext } from '@lit/context';
import type { NodeDefinition, EdgeDefinition } from 'cytoscape';

import {
  encodeHashToBase64,
  decodeHashFromBase64,
  ActionHashB64,
} from '@holochain/client';
import { EntryRecord, RecordBag } from '@holochain-open-dev/utils';

import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import SlSwitch from "@shoelace-style/shoelace/dist/components/switch/switch.js";
import '@shoelace-style/shoelace/dist/components/range/range.js';
import SlRange from "@shoelace-style/shoelace/dist/components/range/range.js";
import '@holochain-open-dev/elements/dist/elements/display-error.js';

import { Commit, DocumentStore } from '@holochain-syn/core';
import { joinAsync, pipe, StoreSubscriber } from '@holochain-open-dev/stores';
import { sharedStyles } from '@holochain-open-dev/elements';
import { localized, msg, str } from '@lit/localize';
import { createGitgraph } from "@gitgraph/js";
import { Profile, ProfilesStore, profilesStoreContext } from '@holochain-open-dev/profiles';
import '@scoped-elements/cytoscape';


function getCommitGraph(
  commits: RecordBag<Commit>
): Array<NodeDefinition | EdgeDefinition> {
  const elements: Array<NodeDefinition | EdgeDefinition> = [];

  for (const commitHash of commits.actionMap.keys()) {
    const strCommitHash = encodeHashToBase64(commitHash);
    elements.push({
      data: {
        id: strCommitHash,
      },
    });

    for (const parentCommitHash of commits.entryRecord(commitHash)?.entry
      .previous_commit_hashes || []) {
      const strParentCommitHash = encodeHashToBase64(parentCommitHash);

      elements.push({
        data: {
          id: `${strParentCommitHash}->${strCommitHash}`,
          source: strParentCommitHash,
          target: strCommitHash,
        },
      });
    }
  }

  return elements;
}


export const synDocumentContext = createContext<DocumentStore<any, any>>(
  'syn-document-context'
);
@localized()
@customElement('xcommit-history')
export class CommitHistory extends LitElement {
  @consume({ context: synDocumentContext, subscribe: true })
  @property()
  documentstore!: DocumentStore<any, any>;

  @consume({ context: profilesStoreContext, subscribe: true })
  profilesStore!: ProfilesStore;

  private _profiles = new StoreSubscriber(
    this,
    () => this.profilesStore.allProfiles,
    () => []
  );

  @property()
  selectedCommitHash: ActionHashB64 | undefined;

  @query("#graph")
  graph: HTMLElement|undefined

  updated() {
    if (!this._cytoscape && this.graph && this._allCommits.value.status === "complete"  ) {
      const allCommits:RecordBag<Commit> = new RecordBag(this._allCommits.value.value.map(er => er.record))
      this.drawGraph(allCommits)
    }
  }

  commitClick (commit:any) {
    this.selectedCommitHash = commit.hash;
    console.log("clicked", commit)
    this.dispatchEvent(
      new CustomEvent('commit-selected', {
        bubbles: true,
        composed: true,
        detail: {
          commitHash: decodeHashFromBase64(commit.hash),
        },
      })
    );
  }

  drawGraph (commits: RecordBag<Commit>) {

    let profiles : ReadonlyMap<Uint8Array, EntryRecord<Profile>> | undefined 
    if (this._profiles.value.status === "complete") {
      profiles = this._profiles.value.value
    }

    let branchNum = 0
    const c = {}
    const e:any = []
    const branches: {[key:number]: any} ={}
    const tips: {[key:string]: number} ={}
    let i = 0;
    const container = this.graph
        // Instantiate the graph.
    if (container) {
      const options = {
        author:" ",
      }
      container.innerHTML = ""
      const gitgraph = createGitgraph(container,options);

      for (const [commitHash, entry] of commits.actionMap.entries()) {
        const strCommitHash = encodeHashToBase64(commitHash);
        const prevCommits = commits.entryRecord(commitHash)?.entry.previous_commit_hashes || []
        let author: string = ""
        if (profiles) {
          const profileEntry = profiles.get(entry.author)
          if (profileEntry) {
            author = profileEntry.entry.nickname
          }
        }
        if (!author) author = encodeHashToBase64(entry.author)
        const data = {
          hash: strCommitHash,
          author,
          timestamp: entry.timestamp,
          prevCommits: prevCommits.map(h=>encodeHashToBase64(h)),
        }
        // @ts-ignore
        c[strCommitHash] = data

        e.push(data)
      }  
      for (i = 0; i< e.length; i+=1) {
        const d = e[i]
        const date = new Date(d.timestamp)
        const commitOptions: any = {
          hash: d.hash,
          author: d.author,
          subject: `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`,
          onClick: (commit:any)=>this.commitClick(commit),
          onMessageClick: (commit:any)=>this.commitClick(commit),
        }
        if (this.selectedCommitHash === d.hash) {
          commitOptions.tag = "."
        }
        let branch: any
        let newBranch = false
        if (d.prevCommits.length === 0) {
          console.log("no prev commits")
          newBranch = true
        } else  if(d.prevCommits.length === 1){
          const hash = d.prevCommits[0]
          console.log("single prev commit", hash, tips)
          const bn = tips[hash]
          branch = branches[bn]
          if (branch) {
            console.log("prev commit is tip for branch, advancing", bn)
            // advance the tip
            delete tips[hash]
            tips[d.hash] = bn
          } else {
            console.log("prev commit is not tip for branch, creating new")
            newBranch = true
          }
        } else {
          console.log("merge", d.prevCommits.length)

          const mainBranchHash = d.prevCommits[0]
          const mainBranchNum = tips[mainBranchHash]
          branch = branches[mainBranchNum]

          for (let i = 1; i < d.prevCommits.length; i+=1) {
            const hash = d.prevCommits[i]
            const mergeBranchNum = tips[hash]
            console.log("merging", mergeBranchNum, "into", mainBranchNum)
            const b = branches[mergeBranchNum]
            branch.merge({
              branch: b,
              commitOptions 
            })
          }
          // advance the mainBranch tip
          delete tips[mainBranchHash]
          tips[d.hash] = mainBranchNum
          branch = undefined
        }
        if (newBranch) {
          branchNum += 1
          console.log("Creating branch", branchNum)
          branch = gitgraph.branch(`${branchNum}`);
          branches[branchNum] = branch
          tips[d.hash] = branchNum
        }
        if (branch) {
          console.log("committing", commitOptions)
          branch.commit(commitOptions);
        }
      }    
    }
  }

  async firstUpdated() {
  }

  @state()
  _cytoscape = false

  @state()
  _zoom = 100

  private _allCommits = new StoreSubscriber(
    this,
    () =>
      pipe(this.documentstore.allCommits, c =>
        joinAsync(Array.from(c.values()))
      ),
    () => []
  );

  onNodeSelected(nodeId: string) {
    this.selectedCommitHash = nodeId;
    this.dispatchEvent(
      new CustomEvent('commit-selected', {
        bubbles: true,
        composed: true,
        detail: {
          commitHash: decodeHashFromBase64(nodeId),
        },
      })
    );
  }

  get selectedNodeIds() {
    return this.selectedCommitHash ? [this.selectedCommitHash] : [];
  }


  renderContent(allCommits: RecordBag<Commit>) {
    if (this._cytoscape) {
      const elements = getCommitGraph(allCommits);
      if (elements.length === 0)
        return html` <div
          class="row"
          style="flex: 1; align-items: center; justify-content: center;"
        >
          <span class="placeholder"> There are no commits yet </span>
        </div>`;
      
      return html`<cytoscape-dagre
      style="flex: 1;"
      .fixed=${true}
      .options=${{
        style: `
          edge {
            target-arrow-shape: triangle;
            width: 2px;
          }
        `,
      }}
      .selectedNodesIds=${this.selectedNodeIds}
      .elements=${elements}
      .dagreOptions=${{
        rankDir: 'BT',
      }}
      @node-selected=${(e: CustomEvent) => this.onNodeSelected(e.detail.id())}
    ></cytoscape-dagre>`
    }
    if (Array.from(allCommits.actionMap.keys()).length === 0)
      return html` <div
        class="row"
        style="flex: 1; align-items: center; justify-content: center;"
      >
        <span class="placeholder"> There are no commits yet </span>
      </div>`;
    
    return html`
    <div id="graph" style="transform: scale(${this._zoom/100})"></div>
    `
  }

  render() {
    switch (this._allCommits.value.status) {
      case 'pending':
        return html`
          <div
            class="row"
            style="flex: 1; align-items: center; justify-content: center;"
          >
            <sl-spinner style="font-size: 2rem"></sl-spinner>
          </div>
        `;
      case 'complete':
        const allCommits:RecordBag<Commit> = new RecordBag(this._allCommits.value.value.map(er => er.record))

        return html`<sl-card style="flex: 1;">
          <span slot="header" class="title">${msg('Commit History')}</span>
          <span slot="header" style="margin-left:5px">(${this._allCommits.value.value.length} commits)</span>
          <sl-switch style="margin-left:10px;" slot="header" size=small @sl-change=${(e:MouseEvent)=>{
            if (e.target) {
              const s:SlSwitch = e.target as SlSwitch
              this._cytoscape = s.checked
            }
          }}>
          ${this._cytoscape ? "graph" : "commits"} 
          </sl-switch>
          ${this._cytoscape ? "" : html`
          <sl-range slot="header" label="Zoom" min="0" max="100" value=${this._zoom}
            @sl-input=${(e:MouseEvent)=>{
              if (e.target) {
                const s:SlRange = e.target as SlRange
                this._zoom = s.value
              }
            }}
          ></sl-range>
          `} 
          ${this.renderContent(allCommits) }
        </sl-card>`;
      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching the commit history')}
          .error=${this._allCommits.value.error}
        ></display-error>`;
    }
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        overflow: scroll;
      }
      sl-card::part(body) {
        padding: 0;
      }
      #graph {
      }
    `,
  ];
}


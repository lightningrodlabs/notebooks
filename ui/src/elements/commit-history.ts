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
import '@shoelace-style/shoelace/dist/components/radio-group/radio-group.js';
import '@shoelace-style/shoelace/dist/components/radio-button/radio-button.js';
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
import SlRadioGroup from '@shoelace-style/shoelace/dist/components/radio-group/radio-group.js';


function getCommitGraph(
  commits: RecordBag<Commit>
): Array<NodeDefinition | EdgeDefinition> {
  const elements: Array<NodeDefinition | EdgeDefinition> = [];
  const nodeIds = new Set<string>();

  // First pass: create all nodes and collect their IDs
  for (const commitHash of commits.actionMap.keys()) {
    const strCommitHash = encodeHashToBase64(commitHash);
    nodeIds.add(strCommitHash);
    elements.push({
      data: {
        id: strCommitHash,
      },
    });
  }

  // Second pass: create edges only if both source and target nodes exist
  for (const commitHash of commits.actionMap.keys()) {
    const strCommitHash = encodeHashToBase64(commitHash);

    for (const parentCommitHash of commits.entryRecord(commitHash)?.entry
      .previous_commit_hashes || []) {
      const strParentCommitHash = encodeHashToBase64(parentCommitHash);

      // Only create edge if both nodes exist in the graph
      if (nodeIds.has(strParentCommitHash) && nodeIds.has(strCommitHash)) {
        elements.push({
          data: {
            id: `${strParentCommitHash}->${strCommitHash}`,
            source: strParentCommitHash,
            target: strCommitHash,
          },
        });
      }
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
    const startTime = new Date()
    // console.log("Starting draw graph @", startTime.toLocaleTimeString()) 
    let profiles : ReadonlyMap<Uint8Array, EntryRecord<Profile>> | undefined 
    if (this._profiles.value.status === "complete") {
      profiles = this._profiles.value.value
    }

    let branchNum = 0
    const c = {}
    const e:any = []
    const branches: {[key:number]: any} ={}
    const tips: {[key:string]: number} ={}
    const commitBranchMap: {[key:string]: number} = {}
    let i = 0;
    const container = this.graph
    // Instantiate the graph.
    if (container) {
      const options = {
        author:" ",
      }
      container.innerHTML = ""
      const gitgraph = createGitgraph(container,options);

      // First pass: build commit data and detect forks
      const childrenMap: {[key: string]: string[]} = {}
      
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

        // Build children map to detect forks
        for (const parentHash of data.prevCommits) {
          if (!childrenMap[parentHash]) {
            childrenMap[parentHash] = []
          }
          childrenMap[parentHash].push(strCommitHash)
        }

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
          newBranch = true
        } else  if(d.prevCommits.length === 1){
          const hash = d.prevCommits[0]
          const bn = tips[hash]
          branch = branches[bn]
          if (branch) {
            // Check if this is a fork (parent has multiple children)
            const parentChildren = childrenMap[hash] || []
            if (parentChildren.length > 1) {
              // This is a fork - create a new branch for this child
              newBranch = true
            } else {
              // advance the tip
              delete tips[hash]
              tips[d.hash] = bn
              commitBranchMap[d.hash] = bn
            }
          } else {
            newBranch = true
          }
        } else {
          const mainBranchHash = d.prevCommits[0]
          const mainBranchNum = tips[mainBranchHash] || commitBranchMap[mainBranchHash]
          branch = branches[mainBranchNum]

          if (branch) {
            for (let i = 1; i < d.prevCommits.length; i+=1) {
              const hash = d.prevCommits[i]
              const mergeBranchNum = tips[hash] || commitBranchMap[hash]
              const b = branches[mergeBranchNum]
              if (b) {
                branch.merge({
                  branch: b,
                  commitOptions 
                })
              }
            }
            // advance the mainBranch tip
            delete tips[mainBranchHash]
            tips[d.hash] = mainBranchNum
            commitBranchMap[d.hash] = mainBranchNum
            branch = undefined
          } else {
            // If we can't find the main branch, create a new one
            newBranch = true
          }
        }
        if (newBranch) {
          branchNum += 1
          branch = gitgraph.branch(`branch-${branchNum}`);
          branches[branchNum] = branch
          tips[d.hash] = branchNum
          commitBranchMap[d.hash] = branchNum
        }
        if (branch) {
          branch.commit(commitOptions);
        }
      }    
    }
    const endTime = new Date()
    // console.log("Ending draw graph @", endTime.toLocaleTimeString())
    // console.log(`Elapsed: ${endTime.getTime()-startTime.getTime()} ms`)
  }

  async firstUpdated() {
  }

  @state()
  _cytoscape = false

  @state()
  _zoom = 75

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
          style="flex: 1; align-items: center; justify-content: center; height: 100%;"
        >
          <span class="placeholder"> There are no commits yet </span>
        </div>`;
      
      return html`
      <div
        style="display: flex; flex: 1; height: 100%;"
      >
        <cytoscape-dagre
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
        ></cytoscape-dagre>
      </div>`
    }
    if (Array.from(allCommits.actionMap.keys()).length === 0)
      return html` <div
        class="row"
        style="flex: 1; align-items: center; justify-content: center; height: 100%;"
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
            style="flex: 1; align-items: center; justify-content: center; height: 100%;"
          >
            <sl-spinner style="font-size: 2rem"></sl-spinner>
          </div>
        `;
      case 'complete':
        const allCommits:RecordBag<Commit> = new RecordBag(this._allCommits.value.value.map(er => er.record))

        return html`<sl-card>
          <div slot="header" style="display: flex; gap: 1em; align-items: center;">
            <span class="title">
              ${msg('Commit History')}
              (${this._allCommits.value.value.length} ${msg('commits')})
            </span>
            <span>
              <sl-radio-group size="small" 
                value=${this._cytoscape ? "2" : "1"}
                @sl-change=${(e:MouseEvent)=>{
                  if (e.target) {
                    const s:SlRadioGroup = e.target as SlRadioGroup
                    this._cytoscape = s.value === "2"
                  }
                }}
              >
                <sl-radio-button value="1">Linear</sl-radio-button>
                <sl-radio-button value="2">Graph</sl-radio-button>
              </sl-radio-group>
            </span>
            </div>

            ${this._cytoscape ? "" : html`
            <sl-range label="Zoom" min="0" max="100" value=${this._zoom}
              @sl-change=${(e:MouseEvent)=>{
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
        flex-direction: column;
        height: 100%;
        min-height: 200px;
        max-height: 800px;
      }
      sl-card {
        flex: 1;
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow-y: scroll;
      }
      sl-card::part(body) {
        padding: 0;
        display: flex;
        flex: 1;
        flex-direction: column;
        height: 100%;
      }
      sl-range::part(form-control) {
        display: flex;
        gap: 1em;
        margin: 10px;
      }
      #graph {
        height: 100%;
        width: 100%;
        transform-origin: top left;
      }
    `,
  ];
}


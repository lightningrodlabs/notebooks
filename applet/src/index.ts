import {
  AppAgentClient,
  CellType,
  DnaHash,
  EntryHash,
} from "@holochain/client";
import { html, render, TemplateResult } from "lit";
import { msg } from "@lit/localize";
import {
  wrapPathInSvg,
  wrapPathInSvgWithoutPrefix,
} from "@holochain-open-dev/elements";
import { NoteMeta } from "@lightningrodlabs/notebooks";
import { decode } from "@msgpack/msgpack";

import {
  Hrl,
  AppletViews,
  CrossAppletViews,
  WeApplet,
  WeServices,
} from "@lightningrodlabs/we-applet";

import "@lightningrodlabs/notebooks/dist/elements/all-notes.js";
import "@lightningrodlabs/notebooks/dist/elements/markdown-note.js";
import "@holochain-open-dev/profiles/dist/elements/profiles-context.js";
import "@lightningrodlabs/we-applet/dist/elements/we-services-context.js";
import "@lightningrodlabs/we-applet/dist/elements/hrl-link.js";
import "@lightningrodlabs/attachments/dist/elements/attachments-context.js";
import "@lightningrodlabs/attachments/dist/elements/attachments-bar.js";
import {
  AttachmentsStore,
  AttachmentsClient,
} from "@lightningrodlabs/attachments";
import "@holochain-syn/core/dist/elements/syn-context.js";

import { SynClient, SynStore } from "@holochain-syn/core";

import { createNote } from "@lightningrodlabs/notebooks";
import { ProfilesClient, ProfilesStore } from "@holochain-open-dev/profiles";
import { mdiNotebook, mdiNotebookMultiple } from "@mdi/js";

import "./applet-main";
import "./cross-applet-main";

function wrapAppletView(
  client: AppAgentClient,
  profilesClient: ProfilesClient,
  weServices: WeServices,
  innerTemplate: TemplateResult
): TemplateResult {
  const synStore = new SynStore(new SynClient(client, "notebooks"));
  return html`
    <attachments-context
      .store=${new AttachmentsStore(new AttachmentsClient(client, "notebooks"))}
    >
      <we-services-context .services=${weServices}>
        <profiles-context .store=${new ProfilesStore(profilesClient)}>
          <syn-context .store=${synStore}>
            ${innerTemplate}
          </syn-context></profiles-context
        ></we-services-context
      ></attachments-context
    >
  `;
}

async function appletViews(
  client: AppAgentClient,
  _appletId: EntryHash,
  profilesClient: ProfilesClient,
  weServices: WeServices
): Promise<AppletViews> {
  return {
    main: (element) =>
      render(
        wrapAppletView(
          client,
          profilesClient,
          weServices,
          html`
            <applet-main
              @note-selected=${async (e: CustomEvent) => {
                const appInfo = await client.appInfo();
                const dnaHash = (appInfo.cell_info.notebooks[0] as any)[
                  CellType.Provisioned
                ].cell_id[0];
                weServices.openViews.openHrl([dnaHash, e.detail.noteHash], {});
              }}
              @note-created=${async (e: CustomEvent) => {
                const appInfo = await client.appInfo();
                const dnaHash = (appInfo.cell_info.notebooks[0] as any)[
                  CellType.Provisioned
                ].cell_id[0];
                weServices.openViews.openHrl([dnaHash, e.detail.noteHash], {});
              }}
            ></applet-main>
          `
        ),
        element
      ),
    blocks: {
      all_notes: {
        label: msg("All Notes"),
        icon_src: wrapPathInSvgWithoutPrefix(mdiNotebookMultiple),
        view(element) {
          render(
            wrapAppletView(
              client,
              profilesClient,
              weServices,
              html`
                <all-notes
                  style="flex: 1;"
                  @note-selected=${async (e: CustomEvent) => {
                    const appInfo = await client.appInfo();
                    const dnaHash = (appInfo.cell_info.notebooks[0] as any)[
                      CellType.Provisioned
                    ].cell_id[0];
                    weServices.openViews.openHrl(
                      [dnaHash, e.detail.noteHash],
                      {}
                    );
                  }}
                ></all-notes>
              `
            ),
            element
          );
        },
      },
    },
    entries: {
      notebooks: {
        syn_integrity: {
          commit: {
            info: async (hrl: Hrl) => {
              const synClient = new SynClient(client, "notebooks");
              const root = await synClient.getCommit(hrl[1]);

              if (!root) return undefined;

              return {
                icon_src: wrapPathInSvg(mdiNotebook),
                name: (decode(root.entry.meta!) as NoteMeta).title,
              };
            },
            view: (element, hrl: Hrl, context) =>
              render(
                wrapAppletView(
                  client,
                  profilesClient,
                  weServices,
                  html`
                    <markdown-note .noteHash=${hrl[1]} style="flex: 1">
                      <div class="row" slot="toolbar-action">
                        <span style="margin-left: 8px"
                          >${msg("Attachments:")}</span
                        >
                        <sl-divider
                          vertical
                          style="margin-left: 8px;"
                        ></sl-divider>
                        <attachments-bar
                          .hash=${hrl[1]}
                          style="margin-left: 8px; margin-right: 8px"
                        ></attachments-bar>
                      </div>
                    </markdown-note>
                  `
                ),
                element
              ),
          },
        },
      },
    },
  };
}

async function crossAppletViews(
  applets: ReadonlyMap<
    EntryHash,
    { profilesClient: ProfilesClient; appletClient: AppAgentClient }
  >, // Segmented by groupId
  weServices: WeServices
): Promise<CrossAppletViews> {
  return {
    main: (element) =>
      render(
        html`
          <we-services-context .services=${weServices}>
            <cross-applet-main .applets=${applets}></cross-applet-main>
          </we-services-context>
        `,
        element
      ),
    blocks: {},
  };
}

const applet: WeApplet = {
  appletViews,
  crossAppletViews,
  attachmentTypes: async (appletClient: AppAgentClient) => ({
    note: {
      label: msg("Note"),
      icon_src: wrapPathInSvg(mdiNotebook),
      async create(attachToHrl: Hrl) {
        const synStore = new SynStore(new SynClient(appletClient, "notebooks"));

        const note = await createNote(synStore, msg(`Note`), attachToHrl, undefined);
        const appInfo = await appletClient.appInfo();
        const dnaHash = (appInfo.cell_info.notebooks[0] as any)[
          CellType.Provisioned
        ].cell_id[0];
        return {
          hrl: [dnaHash, note.entryHash],
          context: {},
        };
      },
    },
  }),
  search: async (
    appletClient: AppAgentClient,
    _appletId: EntryHash,
    _weServices: WeServices,
    filter: string
  ) => {
    const client = new SynClient(appletClient, "notebooks");

    const roots = await client.getAllRoots();
    const appInfo = await appletClient.appInfo();
    const dnaHash = (appInfo.cell_info.notebooks[0] as any)[
      CellType.Provisioned
    ].cell_id[0];

    return roots
      .filter((r) => {
        const noteMeta = decode(r.entry.meta!) as NoteMeta;

        return noteMeta.title.toLowerCase().includes(filter.toLowerCase());
      })
      .map((r) => ({ hrl: [dnaHash, r.entryHash], context: {} }));
  },
};

export default applet;

import { wrapPathInSvg } from "@holochain-open-dev/elements";
import { Hrl } from "@holochain-open-dev/utils";
import { SynClient, SynStore } from "@holochain-syn/core";
import {
  AppAgentClient,
  CellType,
  RoleName,
  ZomeName,
} from "@holochain/client";
import {
  WeClient,
  AppletServices,
  HrlWithContext,
  AttachableInfo,
  AppletHash,
  WeServices,
  HrlLocation,
} from "@lightningrodlabs/we-applet";
import { msg } from "@lit/localize";
import { mdiNotebook } from "@mdi/js";
import { decode } from "@msgpack/msgpack";
import { NoteMeta } from "./types";

// First define your AppletServices that We can call on your applet
// to do things like search your applet or get information
// about the available block views etc.
export const appletServices: AppletServices = {
  // Types of attachment that this Applet offers for other Applets to be created
  creatables: {
    'note': {
      label: msg("Note"),
      icon_src: wrapPathInSvg(mdiNotebook),
    }
  },  // Types of UI widgets/blocks that this Applet supports
  blockTypes: {},
  bindAsset: async (appletClient: AppAgentClient,
    srcWal: HrlWithContext, dstWal: HrlWithContext): Promise<void> => {
    console.log("Bind requested.  Src:", srcWal, "  Dst:", dstWal)
  },

  getAttachableInfo: async (
    appletClient: AppAgentClient,
    roleName: RoleName,
    integrityZomeName: ZomeName,
    entryType: string,
    hrlWithContext: HrlWithContext
  ): Promise<AttachableInfo | undefined> => {
    const synClient = new SynClient(appletClient, "notebooks");
    const root = await synClient.getDocument(hrlWithContext.hrl[1]);

    if (!root) return undefined;

    return {
      icon_src: wrapPathInSvg(mdiNotebook),
      name: (decode(root.entry.meta!) as NoteMeta).title,
    };
  },
  search: async (
    appletClient: AppAgentClient,
    appletHash: AppletHash,
    weServices: WeServices,
    searchFilter: string
  ): Promise<Array<HrlWithContext>> => {
    const client = new SynClient(appletClient, "notebooks");

    const documentsLinks = await client.getDocumentsWithTag("note");
    const documents = await Promise.all(
      documentsLinks.map((rh) => client.getDocument(rh.target))
    );
    const appInfo = await appletClient.appInfo();
    const dnaHash = (appInfo?.cell_info.notebooks[0] as any)[
      CellType.Provisioned
    ].cell_id[0];

    return documents
      .filter((r) => !!r)
      .filter((r) => {
        const noteMeta = decode(r!.entry.meta!) as NoteMeta;

        return noteMeta.title
          .toLowerCase()
          .includes(searchFilter.toLowerCase());
      })
      .map((r) => ({ hrl: [dnaHash, r!.actionHash], context: {} }));
  },
};

import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { Hrl } from '@holochain-open-dev/utils';
import { SynClient, SynStore } from '@holochain-syn/core';
import { AppClient, CellType, RoleName, ZomeName } from '@holochain/client';
import {
  WeaveClient,
  AppletServices,
  WAL,
  AppletHash,
  WeaveServices,
  AssetInfo,
  RecordInfo,
} from '@theweave/api';
import { msg } from '@lit/localize';
import { mdiNotebook } from '@mdi/js';
import { decode } from '@msgpack/msgpack';
import { NoteMeta } from './types';

// First define your AppletServices that We can call on your applet
// to do things like search your applet or get information
// about the available block views etc.
export const appletServices: AppletServices = {
  // Types of attachment that this Applet offers for other Applets to be created
  creatables: {
    note: {
      label: msg('Note'),
      icon_src: wrapPathInSvg(mdiNotebook),
    },
  }, // Types of UI widgets/blocks that this Applet supports
  blockTypes: {},
  // bindAsset: async (
  //   appletClient: AppClient,
  //   srcWal: WAL,
  //   dstWal: WAL
  // ): Promise<void> => {
  //   console.log('Bind requested.  Src:', srcWal, '  Dst:', dstWal);
  // },

  getAssetInfo: async (
    appletClient: AppClient,
    wal: WAL,
    recordInfo?: RecordInfo
  ): Promise<AssetInfo | undefined> => {
    if (!recordInfo) {
      throw new Error("Null WAL not supported, must supply a recordInfo")
    } else {
      const roleName: RoleName = recordInfo.roleName
      // const integrityZomeName: ZomeName = recordInfo.integrityZomeName
      const entryType: string = recordInfo.entryType

      if (entryType !== "document") {
        throw new Error("Kando doesn't know about entry type:"+ entryType)
      } else {

        const synClient = new SynClient(appletClient, roleName);
        const root = await synClient.getDocument(wal.hrl[1]);

        if (!root) return undefined;

        return {
          icon_src: wrapPathInSvg(mdiNotebook),
          name: (decode(root.entry.meta!) as NoteMeta).title,
        };
      }
    }
  },
  search: async (
    appletClient: AppClient,
    appletHash: AppletHash,
    weServices: WeaveServices,
    searchFilter: string
  ): Promise<Array<WAL>> => {
    const client = new SynClient(appletClient, 'notebooks');

    const documentsLinks = await client.getDocumentsWithTag('note');
    const documents = await Promise.all(
      documentsLinks.map(rh => client.getDocument(rh.target))
    );
    const appInfo = await appletClient.appInfo();
    const dnaHash = (appInfo?.cell_info.notebooks[0] as any)[
      CellType.Provisioned
    ].cell_id[0];

    return documents
      .filter(r => !!r)
      .filter(r => {
        const noteMeta = decode(r!.entry.meta!) as NoteMeta;

        return noteMeta.title
          .toLowerCase()
          .includes(searchFilter.toLowerCase());
      })
      .map(r => ({ hrl: [dnaHash, r!.actionHash], context: {} }));
  },
};

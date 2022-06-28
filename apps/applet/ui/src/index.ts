import { WeApplet } from '@lightningrodlabs/we-applet';
import { NotesStore } from '@lightningrodlabs/notebooks';
import { CellClient, HolochainClient } from '@holochain-open-dev/cell-client';
import { AppWebsocket, DnaHash } from '@holochain/client';
import { html, render } from 'lit';

import { NotebooksApplet } from './notebooks-applet';

const notebooksGame: WeApplet = {
 async appletRenderers(appWs: AppWebsocket, adminWs, weServices, gameInfo) {
    const notebooksCell = gameInfo.cell_data.find(
      c => c.role_id === 'notebooks'
    )!;
    const synDnaHash = gameInfo.cell_data.find(c => c.role_id === 'syn')
      ?.cell_id[0];

    const notesStore = new NotesStore(
      new HolochainClient(appWs),
      adminWs,
      notebooksCell,
      synDnaHash as DnaHash
    );

    return {
      full: (rootElement: HTMLElement, registry: CustomElementRegistry) => {
        registry.define('notebooks-applet', NotebooksApplet);

        rootElement.innerHTML = `<notebooks-applet
        id="applet"
      ></notebooks-applet>`;

        const appletEl = rootElement.querySelector('#applet') as any;
        appletEl.notesStore = notesStore;
        appletEl.profilesStore = weServices.profilesStore;
      },
      blocks: [],
    };
  },
};

export default notebooksGame;

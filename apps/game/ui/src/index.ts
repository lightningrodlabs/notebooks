import { WeGame } from '@lightningrodlabs/we-game';
import { NotesStore } from '@lightningrodlabs/notebooks';
import { CellClient, HolochainClient } from '@holochain-open-dev/cell-client';
import { DnaHash } from '@holochain/client';

const notebooksGame: WeGame = {
  gameRenderers: (appWs, adminWs, weStore, gameInfo) => {
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
        rootElement.innerHTML = 'This is where the game renders';
      },
      blocks: [],
    };
  },
};

export default notebooksGame;

import { DnaHash } from "@holochain/client";
import { WeClient } from "@lightningrodlabs/we-applet";
import { createContext } from "@lit/context";

export class NotebooksStore  {
    constructor(public dnaHash:DnaHash, public weClient: WeClient | undefined) {
    }
}
export const notebooksContext = createContext<NotebooksStore>('notebooks-context');


import { AgentPubKey } from "@holochain/client";
import { Hrl } from "@lightningrodlabs/we-applet";

export interface NoteMeta {
  title: string;
  author: AgentPubKey;
  timestamp: number;
  attachedToHrl: Hrl;
}

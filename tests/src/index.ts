
import { Orchestrator } from "@holochain/tryorama";

import notes from './notebooks/notes';
import syn from './syn/syn';

let orchestrator: Orchestrator<any>;

orchestrator = new Orchestrator();
notes(orchestrator);
orchestrator.run();

orchestrator = new Orchestrator();
syn(orchestrator);
orchestrator.run();




import { Config, InstallAgentsHapps } from '@holochain/tryorama';
import path from 'path'
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const notebooksDna = path.join(__dirname, "../../dnas/notebooks/workdir/notebooks.dna");
export const synDna = path.join(__dirname, "../../dnas/syn/workdir/syn.dna");


export const config = Config.gen();

export const installation: InstallAgentsHapps = [
  // one agent
  [
    [
      notebooksDna, // contains this dna
      synDna, // contains this dna
    ]
  ]
];

export const sleep = (ms: number) => new Promise(resolve => setTimeout(() => resolve(null), ms));

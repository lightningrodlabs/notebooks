import { Context, createContext } from '@holochain-open-dev/context';
import { NotesStore } from './notes-store';

export const notesStoreContext: Context<NotesStore> = createContext(
  'notes-store-context'
);

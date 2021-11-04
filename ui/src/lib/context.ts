import { Context, createContext } from '@lit-labs/context';
import { NotesStore } from './notes-store';

export const notesStoreContext: Context<NotesStore> = createContext(
  'notes-store-context'
);

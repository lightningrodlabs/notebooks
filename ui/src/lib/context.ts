import { createContext } from '@lit-labs/context';
import { NotesStore } from './notes-store';

export const notesStoreContext = createContext<NotesStore>(
  'notes-store-context'
);

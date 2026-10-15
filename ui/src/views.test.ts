import { describe, it, expect } from 'vitest';
import { mainView } from './views';

describe('mainView', () => {
  it('opens the note a WAL points at, as Moss passes it from a notification', () => {
    const doc = new Uint8Array([132, 33, 36, 1, 2, 3]);
    expect(mainView({ hrl: [new Uint8Array([132, 45, 36]), doc], context: {} })).toEqual({ type: 'note', noteHash: doc });
  });
  it('shows the notes list without one', () => {
    expect(mainView(undefined)).toEqual({ type: 'main' });
  });
});

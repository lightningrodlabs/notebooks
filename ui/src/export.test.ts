import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { deserializeExport, serializeExport, noteTextFromExport } from './export';
import { initialStateWithComments } from './comments/export';
import { commentRanges } from './comments/ranges';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('noteTextFromExport', () => {
  it('reads a string (v0.0.12 onward, including this version)', () => {
    expect(noteTextFromExport('# a')).toBe('# a');
  });
  it('reads v0.0.11 exports, where the note is the whole state with text as a string', () => {
    expect(noteTextFromExport({ text: '# a' })).toBe('# a');
  });
  it('reads a state whose text is a character list', () => {
    expect(noteTextFromExport({ text: ['#', ' ', 'a'] })).toBe('# a');
  });
  it('reads a state with a body', () => {
    expect(noteTextFromExport({ body: '# a' })).toBe('# a');
  });
  it('is empty for anything else', () => {
    expect(noteTextFromExport(undefined)).toBe('');
    expect(noteTextFromExport(42)).toBe('');
  });
});

describe('importing real export files', () => {
  it('v0.0.11 export', () => {
    const notes = deserializeExport(fixture('export-v0.0.11.json'));
    expect(notes).toHaveLength(1);
    expect(noteTextFromExport(notes[0].workspaces[0].note)).toBe('# Old shopping list\n\n- eggs\n- milk\n');
    expect(notes[0].meta.editorType).toBeUndefined();
  });
  it('v0.6 era export with markdown and rich-text notes', () => {
    const notes = deserializeExport(fixture('export-v0.6.json'));
    expect(notes.map(n => n.meta.editorType)).toEqual(['markdown', 'richtext']);
    expect(noteTextFromExport(notes[1].workspaces[0].note)).toBe('# Rich\n\n**bold** text\n');
  });
  it('this version: comments come back with their ranges, the orphan without one', () => {
    const notes = deserializeExport(fixture('export-comments.json'));
    const ws = notes[0].workspaces[0];
    const doc = initialStateWithComments(noteTextFromExport(ws.note), ws.comments);
    expect(doc.body).toBe('# Draft\n\nhello world\n');
    expect(commentRanges(doc)).toEqual([{ id: 'c1', start: 15, end: 20 }]);
    expect(doc.comments!.c1.replies[0].text).toBe('this one');
    expect(doc.comments!.c2.resolved).toBe(true);
  });
  it('rejects a file without a version', () => {
    expect(deserializeExport('{"notes":[]}')).toEqual([]);
  });
});

describe('serializeExport', () => {
  it('round-trips through deserializeExport', () => {
    const notes = deserializeExport(fixture('export-comments.json'));
    expect(deserializeExport(serializeExport(notes))).toEqual(notes);
  });
});

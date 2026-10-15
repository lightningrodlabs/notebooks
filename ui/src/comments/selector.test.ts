import { describe, it, expect } from 'vitest';
import { makeQuote, findQuote, stripInlineMarkdown } from './selector';

const text = 'the cat sat. the cat ran. the cat slept.';

describe('makeQuote', () => {
  it('captures exact, prefix and suffix', () => {
    expect(makeQuote(text, 17, 20, 4)).toEqual({ exact: 'cat', prefix: 'the ', suffix: ' ran', start: 17 });
  });
});

describe('findQuote', () => {
  it('prefers the occurrence whose context matches', () => {
    expect(findQuote(text, { exact: 'cat', prefix: 'the ', suffix: ' slept', start: 0 })).toEqual({ start: 30, end: 33 });
  });
  it('uses start only to break ties', () => {
    expect(findQuote(text, { exact: 'cat', prefix: '', suffix: '', start: 16 })).toEqual({ start: 17, end: 20 });
  });
  it('returns null when the text is absent or the quote is empty', () => {
    expect(findQuote(text, { exact: 'dog', prefix: '', suffix: '', start: 0 })).toBeNull();
    expect(findQuote(text, { exact: '', prefix: '', suffix: '', start: 0 })).toBeNull();
  });
});

describe('stripInlineMarkdown', () => {
  it('removes emphasis, code, headings, quotes and link syntax', () => {
    expect(stripInlineMarkdown('**bold** and [x](http://u) `c` ~~s~~')).toBe('bold and x c s');
    expect(stripInlineMarkdown('# Title\n> quoted')).toBe('Title\nquoted');
  });
});

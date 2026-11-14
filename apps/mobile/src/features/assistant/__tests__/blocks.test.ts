import { describe, expect, it } from 'vitest';
import { parseBlocks, splitInline } from '../blocks';

describe('parseBlocks', () => {
  it('splits paragraphs, lists and tables', () => {
    const blocks = parseBlocks(
      ['Takings were up.', '', '- Cafe: 120', '- Courts: 80', '', '1. First', '2. Second', '', '| Day | IQD |', '|---|---|', '| Mon | 1,000 |'].join('\n'),
    );
    expect(blocks).toEqual([
      { kind: 'p', lines: ['Takings were up.'] },
      { kind: 'ul', items: ['Cafe: 120', 'Courts: 80'] },
      { kind: 'ol', items: ['First', 'Second'] },
      { kind: 'table', header: ['Day', 'IQD'], rows: [['Mon', '1,000']] },
    ]);
  });
});

describe('parseBlocks, model output quirks', () => {
  it('keeps one numbered list when blank lines sit between the items', () => {
    expect(parseBlocks(['1. One', '', '2. Two', '', '3. Three'].join('\n'))).toEqual([
      { kind: 'ol', items: ['One', 'Two', 'Three'] },
    ]);
  });

  it('still ends a numbered list at the first non-numbered line', () => {
    expect(parseBlocks(['1. One', '', 'After.', '', '2. Again'].join('\n'))).toEqual([
      { kind: 'ol', items: ['One'] },
      { kind: 'p', lines: ['After.'] },
      { kind: 'ol', items: ['Again'] },
    ]);
  });

  it('drops only the separator directly under the header, not a `| - | - |` data row', () => {
    expect(
      parseBlocks(['| Item | Qty |', '| --- | --- |', '| Tea | 3 |', '| - | - |', '| Milk | 2 |'].join('\n')),
    ).toEqual([
      { kind: 'table', header: ['Item', 'Qty'], rows: [['Tea', '3'], ['-', '-'], ['Milk', '2']] },
    ]);
  });

  it('turns # headings into heading blocks and stops a paragraph at one', () => {
    expect(parseBlocks(['Intro', '## Courts', 'Text', '#tag is not one'].join('\n'))).toEqual([
      { kind: 'p', lines: ['Intro'] },
      { kind: 'h', text: 'Courts' },
      { kind: 'p', lines: ['Text', '#tag is not one'] },
    ]);
  });
});

describe('splitInline, markdown leftovers', () => {
  it('prints inline code as plain text and a link as its text then the address', () => {
    const text = splitInline('Run `check` and see [the docs](https://x.test/a) now', [])
      .map((s) => s.text)
      .join('');
    expect(text).toBe('Run check and see the docs (https://x.test/a) now');
  });
});

describe('splitInline', () => {
  it('marks bold and unverified figures without eating longer numbers', () => {
    const segs = splitInline('Sales **1,250** and 12 of 120', ['12']);
    expect(segs.map((s) => [s.text, s.bold, s.unverified])).toEqual([
      ['Sales ', false, false],
      ['1,250', true, false],
      [' and ', false, false],
      ['12', false, true],
      [' of 120', false, false],
    ]);
  });

  it('prefers the longest raw so 1,250 is not split by 250', () => {
    const segs = splitInline('Total 1,250 here', ['250', '1,250']);
    expect(segs.filter((s) => s.unverified).map((s) => s.text)).toEqual(['1,250']);
  });

  it('returns plain text when nothing is unverified', () => {
    expect(splitInline('plain', [])).toEqual([{ text: 'plain', bold: false, unverified: false }]);
  });
});

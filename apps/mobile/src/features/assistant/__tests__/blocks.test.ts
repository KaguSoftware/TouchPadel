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

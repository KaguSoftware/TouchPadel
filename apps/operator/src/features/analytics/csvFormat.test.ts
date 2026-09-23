import { describe, expect, it } from 'vitest';
import { boolCell, cellText, dateOnlyCell, dayCell, humanizeCode, momentCells, numberCell, oneLine, shortId, timeCell, valueCell } from './csvFormat';

const words = { yes: 'Yes', no: 'No' };

describe('cellText', () => {
  it('collapses a cell that spans lines into one line', () => {
    expect(oneLine('a\r\nb\t c  ')).toBe('a b c');
    expect(cellText('  two\nlines  ')).toBe('two lines');
  });
  it('is nothing for an empty or absent value', () => {
    expect(cellText('   ')).toBeNull();
    expect(cellText(null)).toBeNull();
    expect(cellText(undefined)).toBeNull();
  });
  it('cuts at the limit and says it cut', () => {
    const out = cellText('z'.repeat(50), 10)!;
    expect(out).toHaveLength(10);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('a moment is a date column and a time column', () => {
  it('reads the station clock, 24-hour, Latin digits', () => {
    const at = new Date(2026, 8, 23, 14, 5).toISOString();
    expect(momentCells(at)).toEqual(['2026-09-23', '14:05']);
    expect(dayCell(at)).toBe('2026-09-23');
    expect(timeCell(at)).toBe('14:05');
  });
  it('is nothing for an absent or unreadable instant', () => {
    expect(dayCell(null)).toBeNull();
    expect(timeCell('not a date')).toBeNull();
  });
  it('passes a business day straight through', () => {
    expect(dateOnlyCell('2026-09-23')).toBe('2026-09-23');
  });
});

describe('shortId', () => {
  it('keeps the first block of a uuid and leaves other ids whole', () => {
    expect(shortId('a173d62b-9c11-4e8e-b5f1-000000000001')).toBe('a173d62b');
    expect(shortId('tab-9')).toBe('tab-9');
    expect(shortId(null)).toBeNull();
  });
});

describe('valueCell', () => {
  it('says Yes and No rather than true and false', () => {
    expect(valueCell(true, words)).toBe('Yes');
    expect(valueCell('false', words)).toBe('No');
    expect(boolCell('true', 'Yes', 'No')).toBe('Yes');
  });
  it('reads a stored instant as a date and a time', () => {
    expect(valueCell(new Date(2026, 8, 23, 14, 5).toISOString(), words)).toBe('2026-09-23 14:05');
  });
  it('keeps an object as one clipped line of JSON rather than a paragraph', () => {
    const out = valueCell({ a: 'x'.repeat(400) }, words)!;
    expect(out.includes('\n')).toBe(false);
    expect(out.length).toBeLessThanOrEqual(160);
  });
  it('is nothing for an absent value', () => {
    expect(valueCell(null, words)).toBeNull();
    expect(numberCell('')).toBeNull();
    expect(numberCell('12')).toBe(12);
  });
});

describe('humanizeCode', () => {
  it('turns a stored code into words', () => {
    expect(humanizeCode('sold_out')).toBe('Sold out');
    expect(humanizeCode('price_iqd')).toBe('Price (IQD)');
    expect(humanizeCode('menu.item.sold_out')).toBe('Menu item sold out');
  });
});

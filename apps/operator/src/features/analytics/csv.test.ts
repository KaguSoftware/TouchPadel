import { describe, expect, it } from 'vitest';
import { CSV_BOM, bundleEntries, toCsv } from './csv';

describe('toCsv', () => {
  it('starts with a BOM and uses CRLF + commas', () => {
    const csv = toCsv(['Item', 'Sold'], [['Latte', 12]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(1)).toBe('Item,Sold\r\nLatte,12\r\n');
  });

  it('quotes commas and quotes; numbers stay Latin with dot decimals', () => {
    const csv = toCsv(['a'], [['x, y'], ['say "hi"'], [1.5], [null], [undefined]]);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[1]).toBe('"x, y"');
    expect(lines[2]).toBe('"say ""hi"""');
    expect(lines[3]).toBe('1.5');
    expect(lines[4]).toBe('');
    expect(lines[5]).toBe('');
  });

  // A newline inside a quoted field is legal CSV, and every spreadsheet
  // honours it by drawing the row several lines tall. That is what "the cells
  // overflow" meant, so a cell is flattened to one line instead.
  it('flattens a cell that spans lines', () => {
    const csv = toCsv(['a'], [['multi\nline'], ['  padded \t out  ']]);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[1]).toBe('multi line');
    expect(lines[2]).toBe('padded out');
  });

  it('cuts a cell that would spill across the sheet', () => {
    const cell = toCsv(['a'], [['y'.repeat(400)]]).slice(1).split('\r\n')[1]!;
    expect(cell).toHaveLength(160);
    expect(cell.endsWith('…')).toBe(true);
  });

  // A short row used to leave the sheet ragged from that row down.
  it('pads a short row to the width of the headers', () => {
    expect(toCsv(['a', 'b', 'c'], [['x']]).slice(1)).toBe('a,b,c\r\nx,,\r\n');
  });

  it('guards formula injection', () => {
    expect(toCsv(['a'], [['=1+1']]).slice(1)).toBe("a\r\n'=1+1\r\n");
  });

  it('keeps Arabic text intact', () => {
    expect(toCsv(['الصنف'], [['قهوة']]).slice(1)).toBe('الصنف\r\nقهوة\r\n');
  });
});

describe('bundleEntries', () => {
  it('numbers each table so the files open in reading order', () => {
    const entries = bundleEntries([
      { name: 'window', headers: ['What', 'Value'], rows: [['Period from', '2026-09-01']] },
      { name: 'figures', headers: ['Figure', 'Value'], rows: [['Revenue', 15000]] },
    ]);
    expect(entries.map((e) => e.name)).toEqual(['01-window.csv', '02-figures.csv']);
    expect(entries[1]!.text).toBe(CSV_BOM + 'Figure,Value\r\nRevenue,15000\r\n');
  });
});

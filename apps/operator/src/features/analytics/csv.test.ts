import { describe, expect, it } from 'vitest';
import { CSV_BOM, toCsv } from './csv';

describe('toCsv', () => {
  it('starts with a BOM and uses CRLF + commas', () => {
    const csv = toCsv(['Item', 'Sold'], [['Latte', 12]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(1)).toBe('Item,Sold\r\nLatte,12\r\n');
  });
  it('quotes commas, quotes and newlines; numbers stay Latin with dot decimals', () => {
    const csv = toCsv(['a'], [['x, y'], ['say "hi"'], ['multi\nline'], [1.5], [null], [undefined]]);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[1]).toBe('"x, y"');
    expect(lines[2]).toBe('"say ""hi"""');
    expect(lines[3]).toBe('"multi\nline"');
    expect(lines[4]).toBe('1.5');
    expect(lines[5]).toBe('');
    expect(lines[6]).toBe('');
  });
  it('guards formula injection', () => {
    expect(toCsv(['a'], [['=1+1']]).slice(1)).toBe("a\r\n'=1+1\r\n");
  });
  it('keeps Arabic text intact', () => {
    expect(toCsv(['الصنف'], [['قهوة']]).slice(1)).toBe(
      'الصنف\r\nقهوة\r\n',
    );
  });
});

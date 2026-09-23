import { describe, expect, it } from 'vitest';
import { uniqueHeaders } from './exportTables';
import { inferType, resolveColumns } from './xlsx';

describe('uniqueHeaders', () => {
  it('leaves distinct headers alone', () => {
    expect(uniqueHeaders(['Date', 'Who', 'Amount'])).toEqual(['Date', 'Who', 'Amount']);
  });
  // Two columns with the same name make a filter ambiguous and a lookup wrong.
  it('numbers a repeated header', () => {
    expect(uniqueHeaders(['Authorised by', 'Applied by', 'Authorised by'])).toEqual(['Authorised by', 'Applied by', 'Authorised by (2)']);
  });
  it('keeps a column’s declared type while renaming it', () => {
    expect(uniqueHeaders([{ header: 'Amount', type: 'money' }, { header: 'Amount', type: 'money' }])).toEqual([
      { header: 'Amount', type: 'money' },
      { header: 'Amount (2)', type: 'money' },
    ]);
  });
});

describe('column types, read off the values', () => {
  it('knows amounts, decimals, dates and times apart from text', () => {
    expect(inferType('Amount (IQD)', [15000, -2000])).toBe('money');
    expect(inferType('Hours', [15.5, 3.25])).toBe('decimal');
    expect(inferType('Change %', [15.4, 112.5])).toBe('percent');
    expect(inferType('Date', ['2026-09-23', '2026-09-01'])).toBe('date');
    expect(inferType('Time', ['14:05', '09:30'])).toBe('time');
    expect(inferType('Who', ['Ahmed Salim', null])).toBe('text');
  });
  it('is text when a column holds nothing, or holds both kinds', () => {
    expect(inferType('Reason', [null, undefined, ''])).toBe('text');
    expect(inferType('Reference', ['tab-9', 12])).toBe('text');
  });
});

describe('column widths', () => {
  // The whole complaint: "Opening f", "Cash taker", "Voided lin".
  it('fits the widest cell, so no heading is cut off', () => {
    const [figure, value] = resolveColumns({
      name: 'Day close',
      columns: ['Figure', { header: 'Value (IQD)', type: 'money' }],
      rows: [['Opening float', 50000], ['Cash taken at the court desk', 298000]],
    });
    expect(figure!.width).toBeGreaterThanOrEqual('Cash taken at the court desk'.length);
    // 298,000 renders wider than the six digits behind it.
    expect(value!.width).toBeGreaterThanOrEqual('Value (IQD)'.length);
  });

  it('never lets one column push the rest off the screen', () => {
    const [only] = resolveColumns({ name: 'x', columns: ['Note'], rows: [['n'.repeat(300)]] });
    expect(only!.width).toBe(48);
  });
});

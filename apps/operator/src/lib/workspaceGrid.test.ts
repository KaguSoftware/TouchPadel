import { describe, expect, it } from 'vitest';
import { PICKER_TRACKS, pickerIndexForKey, pickerLayout } from './workspaceGrid';

/** Sum each row's spans: every row must end flush at twelve tracks. */
function rowSums(spans: number[]): number[] {
  const sums: number[] = [];
  let acc = 0;
  for (const s of spans) {
    acc += s;
    if (acc >= PICKER_TRACKS) {
      sums.push(acc);
      acc = 0;
    }
  }
  if (acc > 0) sums.push(acc);
  return sums;
}

describe('pickerLayout', () => {
  it('is empty with no workspaces', () => {
    expect(pickerLayout(0)).toEqual({ rows: 0, spans: [] });
  });

  it('puts up to three tiles on one row', () => {
    expect(pickerLayout(1)).toEqual({ rows: 1, spans: [12] });
    expect(pickerLayout(2)).toEqual({ rows: 1, spans: [6, 6] });
    expect(pickerLayout(3)).toEqual({ rows: 1, spans: [4, 4, 4] });
  });

  it('lays five out as two wide tiles over three', () => {
    expect(pickerLayout(5)).toEqual({ rows: 2, spans: [6, 6, 4, 4, 4] });
  });

  it('lays seven out as three over four', () => {
    expect(pickerLayout(7)).toEqual({ rows: 2, spans: [4, 4, 4, 3, 3, 3, 3] });
  });

  it('fills every row flush from one to eight tiles', () => {
    for (let n = 1; n <= 8; n++) {
      const { rows, spans } = pickerLayout(n);
      const sums = rowSums(spans);
      expect(sums).toHaveLength(rows);
      for (const sum of sums) expect(sum).toBe(PICKER_TRACKS);
    }
  });

  it('runs four to a row past eight', () => {
    expect(pickerLayout(9)).toEqual({ rows: 3, spans: Array(9).fill(3) });
  });
});

describe('pickerIndexForKey', () => {
  it('maps 1 to the first tile', () => {
    expect(pickerIndexForKey('1', 5)).toBe(0);
    expect(pickerIndexForKey('5', 5)).toBe(4);
  });

  it('ignores a digit past the last tile, zero and other keys', () => {
    expect(pickerIndexForKey('6', 5)).toBeNull();
    expect(pickerIndexForKey('0', 5)).toBeNull();
    expect(pickerIndexForKey('a', 5)).toBeNull();
    expect(pickerIndexForKey('Enter', 5)).toBeNull();
  });
});

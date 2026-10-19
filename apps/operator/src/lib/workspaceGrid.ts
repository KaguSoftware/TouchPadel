/**
 * How the workspace picker lays out its tiles so they fill the screen with no
 * hole (Majed, 2026-10-19). The grid has twelve tracks; each tile spans some
 * of them.
 *
 * Up to three tiles share one row. Four to eight split into two rows, the
 * smaller half on top, so five reads as two wide tiles over three and seven
 * as three over four. Twelve divides by 2, 3 and 4, so every row ends flush.
 * Past eight (no account has that many today) the tiles run four to a row.
 */
export const PICKER_TRACKS = 12;

export interface PickerLayout {
  rows: number;
  spans: number[];
}

export function pickerLayout(count: number): PickerLayout {
  if (count <= 0) return { rows: 0, spans: [] };
  if (count <= 3) return { rows: 1, spans: Array.from({ length: count }, () => PICKER_TRACKS / count) };
  if (count <= 8) {
    const top = Math.floor(count / 2);
    const bottom = count - top;
    return {
      rows: 2,
      spans: Array.from({ length: count }, (_, i) => (i < top ? PICKER_TRACKS / top : PICKER_TRACKS / bottom)),
    };
  }
  return { rows: Math.ceil(count / 4), spans: Array.from({ length: count }, () => PICKER_TRACKS / 4) };
}

/** The workspace a digit key opens: "1" is the first tile. Null for anything else. */
export function pickerIndexForKey(key: string, count: number): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  const index = Number(key) - 1;
  return index < count ? index : null;
}

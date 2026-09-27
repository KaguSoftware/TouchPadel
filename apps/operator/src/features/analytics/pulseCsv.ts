/**
 * The Pulse zone's CSV, shaped like the management panel's: one row per
 * figure with its value, the comparison window's value, and the change. Raw
 * numbers only (money in IQD, rates in percent); a figure the page could not
 * compute is an empty cell, never 0.
 */
import type { CsvCell } from './exportTables';

export interface PulseFigure {
  label: string;
  value: number | null;
  previous: number | null;
}

export function pulseCsvRows(figures: readonly PulseFigure[]): CsvCell[][] {
  return figures.map(({ label, value, previous }) => {
    const both = value != null && previous != null;
    const changeAbs = both ? value - previous : null;
    const changePct = both && previous > 0 ? Math.round(((value - previous) * 1000) / previous) / 10 : null;
    return [label, value, previous, changeAbs, changePct];
  });
}

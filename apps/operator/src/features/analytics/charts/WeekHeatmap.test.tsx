import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '../../../lib/i18n';
import { makeFormatters } from '../format';
import { LIGHT_CHART_COLORS } from './colors';
import { WeekHeatmap } from './WeekHeatmap';

// Rendered without a ThemeModeProvider, so the light set is what paints.
const { HEAT_RAMP } = LIGHT_CHART_COLORS;

const f = makeFormatters('en');

/** jsdom normalises `#3360AB` to `rgb(51, 96, 171)`. */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

const cell = (dow: number, hour: number) => document.querySelector(`[data-dow="${dow}"][data-hour="${hour}"]`) as HTMLElement;

function renderMap(cells: Parameters<typeof WeekHeatmap>[0]['cells']) {
  return render(
    <LocaleProvider>
      <WeekHeatmap cells={cells} f={f} format={(n) => `${n}%`} unit="Attach" hint="Hover a cell" />
    </LocaleProvider>,
  );
}

describe('WeekHeatmap', () => {
  it('paints the busiest cell with the darkest step and mutes a thin cell without letting it be the peak', () => {
    renderMap([
      { dow: 1, hour: 18, value: 40 },
      { dow: 1, hour: 19, value: 100, thin: true, label: '2 of 2' },
    ]);
    // The 40 cell is the peak: the thin 100 is excluded from the scale.
    expect(cell(1, 18).style.background).toBe(rgb(HEAT_RAMP[5]!));
    expect(cell(1, 19).style.opacity).toBe('0.35');
    expect(cell(1, 19).dataset.thin).toBe('true');
    expect(cell(1, 18).style.opacity).toBe('');
  });

  it('reads a thin cell out with its label instead of a percentage', () => {
    renderMap([
      { dow: 1, hour: 19, value: 100, thin: true, label: '2 of 2' },
      { dow: 2, hour: 9, value: 50 },
    ]);
    // React drives onPointerEnter from pointerover.
    fireEvent.pointerOver(cell(1, 19));
    expect(screen.getByText('Monday 19:00 · 2 of 2')).toBeTruthy();
    fireEvent.pointerOver(cell(2, 9));
    expect(screen.getByText('Tuesday 09:00 · 50% · 100% of the busiest cell')).toBeTruthy();
  });
});

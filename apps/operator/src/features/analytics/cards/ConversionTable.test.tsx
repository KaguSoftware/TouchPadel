import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../../lib/i18n';
import { makeFormatters } from '../format';
import { ConversionTable } from './ConversionTable';

const rows = [
  { id: 'latte', nameEn: 'Latte', nameAr: 'لاتيه', views: 100, carts: 40, sold: 30, convPct: 30 },
  // Sold more than viewed: staples ordered without a scan.
  { id: 'water', nameEn: 'Water', nameAr: 'ماء', views: 20, carts: 5, sold: 60, convPct: 300 },
  // Never viewed at all.
  { id: 'tea', nameEn: 'Tea', nameAr: 'شاي', views: 0, carts: 0, sold: 4, convPct: 0 },
  // A hidden gem: few views, most convert.
  { id: 'kahi', nameEn: 'Kahi', nameAr: 'كاهي', views: 6, carts: 5, sold: 5, convPct: 83 },
];

function renderTable() {
  return render(
    <LocaleProvider>
      <ConversionTable rows={rows} hiddenGemIds={new Set(['kahi'])} state="ready" f={makeFormatters('en')} rangeLabel="x" />
    </LocaleProvider>,
  );
}

const rowOf = (name: string) => screen.getByText(name, { exact: true }).closest('tr')!;

describe('ConversionTable', () => {
  it('caps conversion at 100% and says why, and marks an item never viewed', () => {
    renderTable();
    expect(within(rowOf('Latte')).getByText('30%')).toBeTruthy();
    const water = rowOf('Water');
    expect(within(water).getByText('100%')).toBeTruthy();
    expect(within(water).getByText('Sold without a view')).toBeTruthy();
    expect(within(water).queryByText('300%')).toBeNull();
    const tea = rowOf('Tea');
    expect(within(tea).getByText('No views')).toBeTruthy();
    expect(within(tea).getByText('Sold without a view')).toBeTruthy();
  });

  it('badges the hidden gems and filters down to them on one click', async () => {
    renderTable();
    expect(within(rowOf('Kahi')).getByText('Hidden gem')).toBeTruthy();
    expect(within(rowOf('Latte')).queryByText('Hidden gem')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Hidden gems only' });
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('Latte', { exact: true })).toBeNull();
    expect(screen.getByText('Kahi', { exact: true })).toBeTruthy();
    await userEvent.click(toggle);
    expect(screen.getByText('Latte', { exact: true })).toBeTruthy();
  });
});

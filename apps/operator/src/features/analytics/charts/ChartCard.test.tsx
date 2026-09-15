import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../../lib/i18n';
import { ChartCard } from './ChartCard';

vi.mock('../csv', () => ({ downloadCsv: vi.fn(), toCsv: vi.fn(() => 'csv') }));
import { downloadCsv, toCsv } from '../csv';

const twin = {
  columns: [
    { key: 'label', label: 'Hour' },
    { key: 'value', label: 'Bookings', numeric: true },
  ],
  rows: [
    { label: '18:00', value: 12 },
    { label: '19:00', value: 15 },
  ],
  file: 'by-hour',
};

function renderCard(state: 'ready' | 'loading' = 'ready') {
  return render(
    <LocaleProvider>
      <ChartCard title="By hour" state={state} twin={twin} height={120}>
        <svg data-testid="plot" />
      </ChartCard>
    </LocaleProvider>,
  );
}

describe('ChartCard twin', () => {
  beforeEach(() => {
    vi.mocked(downloadCsv).mockClear();
    vi.mocked(toCsv).mockClear();
  });

  it('shows the plot by default and swaps it for the table on the toggle', async () => {
    renderCard();
    expect(screen.getByTestId('plot')).toBeTruthy();
    const toggle = screen.getByRole('button', { name: 'Show as table' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(toggle);
    expect(screen.queryByTestId('plot')).toBeNull();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText('19:00')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show as chart' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('downloads the same rows as CSV in column order', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(toCsv).toHaveBeenCalledWith(['Hour', 'Bookings'], [['18:00', 12], ['19:00', 15]]);
    expect(downloadCsv).toHaveBeenCalledWith('by-hour.csv', 'csv');
  });

  it('offers no twin controls while loading', () => {
    renderCard('loading');
    expect(screen.queryByRole('button', { name: 'Show as table' })).toBeNull();
  });
});

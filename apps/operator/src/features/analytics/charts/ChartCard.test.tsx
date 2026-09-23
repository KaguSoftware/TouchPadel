import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../../lib/i18n';
import { ChartCard } from './ChartCard';

vi.mock('../exportTables', () => ({ downloadTable: vi.fn() }));
import { downloadTable } from '../exportTables';

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
    vi.mocked(downloadTable).mockClear();
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

  it('downloads the same rows in column order, on a sheet named for the chart', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(downloadTable).toHaveBeenCalledWith('by-hour', 'en', {
      name: 'By hour',
      columns: ['Hour', 'Bookings'],
      rows: [['18:00', 12], ['19:00', 15]],
    });
  });

  it('offers no twin controls while loading', () => {
    renderCard('loading');
    expect(screen.queryByRole('button', { name: 'Show as table' })).toBeNull();
  });
});

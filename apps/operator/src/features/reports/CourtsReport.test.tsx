import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// One report through the shared scaffold: every report renders its four
// states from the `report_*` payload alone, and a row click asks the server
// for the transactions behind it with the contract's `<kind>:<id>` key.
//
// vitest.config sets `restoreMocks: true`, so every mock is armed in
// beforeEach — a value set inside a vi.mock factory is wiped before the first test.

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/queries', () => ({ QK: { courts: ['courts'] }, fetchActiveCourts: vi.fn() }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { appRpc } from '../../lib/appRpc';
import { fetchActiveCourts } from '../../lib/queries';
import { CourtsReportScreen } from './CourtsReport';

const rpc = vi.mocked(appRpc);

function renderReport() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <CourtsReportScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const READY = {
  columns: ['court', 'occupancy_pct', 'revenue_iqd'],
  rows: [
    { court_id: 'c1', court: 'Court 1', occupancy_pct: 62.5, revenue_iqd: 250000 },
    { court_id: 'c2', court: 'Court 2', occupancy_pct: 40, revenue_iqd: 100000 },
  ],
  totals: { occupancy_pct: 51.25, revenue_iqd: 350000 },
};

beforeEach(() => {
  rpc.mockReset();
  vi.mocked(fetchActiveCourts).mockResolvedValue([{ id: 'c1', name_en: 'Court 1', name_ar: 'ملعب ١', duration_options: [60], sort_order: 1 }]);
  vi.mocked(appRpc).mockResolvedValue([]);
});

describe('CourtsReportScreen — four states', () => {
  it('loading: header and controls render while the table waits', () => {
    rpc.mockReturnValue(new Promise(() => {}));
    renderReport();
    expect(screen.getByRole('heading', { name: 'Courts' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toHaveProperty('disabled', true);
    // 0068: report_courts takes (p_from, p_to, p_filters) — no p_group (that is report_revenue's alone).
    expect(rpc).toHaveBeenCalledWith('report_courts', expect.objectContaining({ p_from: expect.any(String), p_filters: expect.objectContaining({ view: 'byCourt' }) }));
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty('p_group');
  });

  it('ready: renders labelled columns, formatted cells and the totals row', async () => {
    rpc.mockResolvedValue(READY);
    renderReport();
    const table = await screen.findByRole('table', { name: 'Courts' });
    expect(await within(table).findByText('Court 1')).toBeTruthy();
    expect(screen.getByText('Occupancy')).toBeTruthy();
    expect(screen.getByText('62.5%')).toBeTruthy();
    expect(screen.getByText('250,000 IQD')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
    expect(screen.getByText('350,000 IQD')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toHaveProperty('disabled', false);
  });

  it('ready: a row click drills through with the contract key', async () => {
    const user = userEvent.setup();
    rpc.mockImplementation(async (fn) => (fn === 'report_courts' ? READY : { transactions: [{ id: 't1', at: '2026-09-01T10:00:00Z', amount_iqd: 50000 }] }));
    renderReport();
    // Scoped to the table: the court filter lists "Court 1" as an <option> too.
    const table = await screen.findByRole('table', { name: 'Courts' });
    await user.click(await within(table).findByText('Court 1'));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('report_drill', expect.objectContaining({ p_figure: 'court:c1', p_key: null })));
    expect(await screen.findByText('50,000 IQD')).toBeTruthy();
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toContain('Court 1');
  });

  it('empty: no rows in range teaches the next action', async () => {
    rpc.mockResolvedValue({ columns: ['court'], rows: [], totals: null });
    renderReport();
    expect(await screen.findByText('Nothing to report for this range')).toBeTruthy();
  });

  it('error: shows the failure and a retry that calls the RPC again', async () => {
    const user = userEvent.setup();
    rpc.mockRejectedValueOnce(new Error('UNKNOWN')).mockResolvedValue({ columns: ['court'], rows: [{ court: 'Court 9' }] });
    renderReport();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => a.textContent?.includes('This could not be loaded.'))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Court 9')).toBeTruthy();
  });
});

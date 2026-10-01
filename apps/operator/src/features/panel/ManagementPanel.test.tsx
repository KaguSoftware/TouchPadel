import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// The panel is the owner's landing screen: it must show each of its four
// states without a server, and it must never invent a figure — everything on
// it is the `panel_headline` payload rendered as given.

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/settings', () => ({
  useCafeSettings: () => ({ isSuccess: true, isError: false, settings: { analytics_business_day_start_hour: 4 } }),
}));
// The live floor has its own reads, broadcasts and a three.js scene; the
// panel's tests are about the panel's figures. It is covered in
// ../floor/LiveFloor.test.tsx.
vi.mock('../floor/LiveFloor', () => ({ LiveFloor: () => <div data-testid="live-floor" /> }));
// The wages card reads its own RPC; this test answers every appRpc call with one value.
vi.mock('../wages/WagesDueCard', () => ({ WagesDueCard: () => null }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { VENUE_TZ } from '@touch/i18n';
import { addDays, businessTodayISO } from '@touch/core';
import { appRpc } from '../../lib/appRpc';
import { ManagementPanelScreen } from './ManagementPanel';

const rpc = vi.mocked(appRpc);

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ManagementPanelScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

// Pin the clock (Date only, so async waits still run). "This month" and "Last 30 days" are the
// same window on the 30th of a 30-day month, and the presets then read differently.
afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 15, 12, 0, 0));
  rpc.mockReset();
  navigate.mockReset();
});

describe('ManagementPanelScreen — four states', () => {
  it('loading: shows the skeleton and no figures', () => {
    rpc.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Management panel' })).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByText('15,000 IQD')).toBeNull();
    expect(rpc).toHaveBeenCalledWith('panel_headline', expect.objectContaining({ p_compare: 'previousPeriod' }));
  });

  it('opens on the window Analytics opens on: the last 30 days, ending on the business day', () => {
    rpc.mockReturnValue(new Promise(() => {}));
    renderPanel();
    const today = businessTodayISO(new Date(), 4, VENUE_TZ);
    expect(rpc).toHaveBeenCalledWith('panel_headline', { p_from: addDays(today, -29), p_to: today, p_compare: 'previousPeriod' });
    expect(screen.getByRole('button', { name: 'Last 30 days', pressed: true })).toBeTruthy();
  });

  it('ready: renders the server figures verbatim, with comparison', async () => {
    rpc.mockResolvedValue({
      figures: [
        { key: 'revenue', value: 15000, previous: 12000, changeAbs: 3000, changePct: 25 },
        { key: 'cafeRevenue', value: 5000, previous: 5000, changeAbs: 0, changePct: 0 },
        { key: 'orders', value: 42, previous: 40, changeAbs: 2, changePct: 5 },
        { key: 'mystery', value: 9 },
      ],
    });
    renderPanel();
    expect(await screen.findByText('15,000 IQD')).toBeTruthy();
    expect(screen.getByText('5,000 IQD')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    // The percentage goes through @touch/i18n like the absolute change beside
    // it (it used to be toFixed(1) + a literal '%', so one number on the line
    // was localised and the other was not), and formatPercent pins it to one
    // decimal so a KPI column stays aligned.
    expect(screen.getByText('(+25.0%)')).toBeTruthy();
    // Unknown keys are dropped, never guessed at.
    expect(screen.queryByText('mystery')).toBeNull();
    expect(screen.getByRole('button', { name: /Courts report/ })).toBeTruthy();
  });

  it('empty: a period with no trading says so and offers another range', async () => {
    rpc.mockResolvedValue({ figures: [{ key: 'revenue', value: 0 }, { key: 'orders', value: null }] });
    renderPanel();
    expect(await screen.findByText('No trading in this period')).toBeTruthy();
    expect(screen.getByText('Nothing was sold or booked between these dates. Pick another period.')).toBeTruthy();
    // The default is already the last 30 days, so the way out is last month, on top of the preset strip.
    expect(screen.getAllByRole('button', { name: 'Last month' }).length).toBeGreaterThan(1);
  });

  it('error: surfaces the failure with a retry', async () => {
    rpc.mockRejectedValue(new Error('FORBIDDEN'));
    renderPanel();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => a.textContent?.includes('This could not be loaded.'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
  });
});

// Open matches (operator.md §5.19): panel_headline's seven online keys (0265).
describe('ManagementPanelScreen — Online money and open matches', () => {
  it('draws the group when the server sends its figures; a row opens its report, never a drill', async () => {
    rpc.mockResolvedValue({
      figures: [
        { key: 'revenue', value: 15000 },
        { key: 'onlineDeposits', value: 45000, previous: 30000, changeAbs: 15000, changePct: 50 },
        { key: 'ticketSales', value: 80000 },
        { key: 'ticketLiability', value: 60000 },
        { key: 'matchWrittenOff', value: 20000 },
      ],
    });
    renderPanel();
    const group = await screen.findByTestId('panel-online');
    expect(screen.getByRole('heading', { name: 'Online money and open matches' })).toBeTruthy();
    expect(screen.getByText('Online deposits')).toBeTruthy();
    expect(screen.getByText('80,000 IQD')).toBeTruthy();
    // Ticket sales and liability are counted at every branch, and say so.
    expect(group.textContent?.match(/All branches/g)).toHaveLength(3);
    fireEvent.click(screen.getByText('Match ticket sales'));
    expect(navigate).toHaveBeenCalledWith({ to: '/reports/courts' });
    fireEvent.click(screen.getByText('Online deposits'));
    expect(navigate).toHaveBeenLastCalledWith({ to: '/reports/revenue' });
    expect(rpc.mock.calls.some(([fn]) => fn === 'report_drill')).toBe(false);
  });

  it('is left out when none of its figures came back (a server before 0265)', async () => {
    rpc.mockResolvedValue({ figures: [{ key: 'revenue', value: 15000 }] });
    renderPanel();
    expect(await screen.findByText('15,000 IQD')).toBeTruthy();
    expect(screen.queryByTestId('panel-online')).toBeNull();
  });
});

describe('ManagementPanelScreen — Export', () => {
  it('pulls the transactions behind every figure into the file, not the totals alone', async () => {
    rpc.mockImplementation(async (fn: string, args: unknown) => {
      if (fn === 'panel_headline') {
        return {
          period: { from: '2026-08-22', to: '2026-09-20' },
          comparison: { from: '2026-07-23', to: '2026-08-21' },
          figures: [
            { key: 'revenue', value: 15000, previous: 12000, changeAbs: 3000, changePct: 25 },
            { key: 'refunds', value: 5000, previous: 4000, changeAbs: 1000, changePct: 25 },
          ],
        };
      }
      const a = args as { p_figure: string };
      return {
        transactions: [
          { id: `${a.p_figure}-1`, at: '2026-09-01T10:00:00Z', kind: 'refund', label: 'refund · quality · cash', amountIqd: 5000, staffId: 's1', staffName: 'Dev', reference: 'tab-9', detail: { sub: 'refund', reason: 'quality', method: 'cash' } },
        ],
      };
    });
    const archives: string[] = [];
    // The export is a workbook: a zip of XML parts, stored uncompressed, so
    // decoding the whole blob is enough to read the parts back.
    const createObjectURL = vi.fn((b: Blob) => {
      const reader = new FileReader();
      reader.onload = () => archives.push(new TextDecoder().decode(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(b);
      return 'blob:x';
    });
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    const names: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });

    renderPanel();
    expect(await screen.findByText('15,000 IQD')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    await waitFor(() => expect(archives).toHaveLength(1));

    // One drill per figure the server sent, over the panel's period.
    const drills = rpc.mock.calls.filter(([fn]) => fn === 'report_drill').map(([, a]) => a as { p_figure: string; p_from: string; p_to: string });
    expect(drills.map((d) => d.p_figure).sort()).toEqual(['refunds', 'revenue']);
    expect(drills.every((d) => d.p_from < d.p_to)).toBe(true);

    // Three tables, so a zip — not one sheet with three headers in it.
    // Three tables, so three sheets in one workbook — not three headers in one sheet.
    expect(names[0]).toMatch(/^management-panel_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const book = archives[0]!;
    expect(book).toContain('xl/worksheets/sheet1.xml');
    expect(book).toContain('xl/worksheets/sheet3.xml');
    expect(book).toContain('<sheet name="Period" sheetId="1"');
    expect(book).toContain('<sheet name="Figures" sheetId="2"');
    expect(book).toContain('<sheet name="Transactions" sheetId="3"');
    // Headings are written whole and columns are sized, so nothing is cut off.
    expect(book).toContain('Compared with, from');
    expect(book).toMatch(/<col min="1" max="1" width="\d+" customWidth="1"\/>/);
    // The figures are numbers, not strings of digits.
    expect(book).toContain('<v>15000</v>');
    expect(book).toContain('<v>3000</v>');
    // The facts are still in words, and the date is a real date.
    expect(book).toContain('Quality issue');
    expect(book).toContain('<autoFilter');
    click.mockRestore();
  });

  it('says so and downloads nothing when a drill fails', async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'panel_headline') return { figures: [{ key: 'revenue', value: 15000 }] };
      throw new Error('FORBIDDEN');
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderPanel();
    expect(await screen.findByText('15,000 IQD')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(await screen.findByText('The export could not be completed. Nothing was downloaded.')).toBeTruthy();
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });
});

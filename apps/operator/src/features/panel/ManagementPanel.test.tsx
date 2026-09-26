import { describe, it, expect, vi, beforeEach } from 'vitest';
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

beforeEach(() => {
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

describe('ManagementPanelScreen — Export CSV', () => {
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
    const blobs: string[] = [];
    // jsdom's Blob has no text(); a FileReader reads it.
    const createObjectURL = vi.fn((b: Blob) => {
      const reader = new FileReader();
      reader.onload = () => blobs.push(String(reader.result));
      reader.readAsText(b);
      return 'blob:x';
    });
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderPanel();
    expect(await screen.findByText('15,000 IQD')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    await waitFor(() => expect(blobs).toHaveLength(1));

    // One drill per figure the server sent, over the panel's period.
    const drills = rpc.mock.calls.filter(([fn]) => fn === 'report_drill').map(([, a]) => a as { p_figure: string; p_from: string; p_to: string });
    expect(drills.map((d) => d.p_figure).sort()).toEqual(['refunds', 'revenue']);
    expect(drills.every((d) => d.p_from < d.p_to)).toBe(true);

    const csv = blobs[0]!;
    expect(csv).toContain('Period from,');
    // A label with a comma in it is quoted, as any CSV cell must be.
    expect(csv).toContain('"Compared with, from",2026-07-23');
    expect(csv).toContain('Revenue,revenue,Headline,IQD,15000,12000,3000,25');
    expect(csv).toContain('Refunds,refunds,"Discounts, refunds and waste",IQD,5000,4000,1000,25');
    expect(csv).toContain('Revenue,revenue,revenue-1,');
    expect(csv).toContain('Refunds,refunds,refunds-1,');
    expect(csv).toContain('Quality issue · Cash,refund · quality · cash,Dev,s1,tab-9,5000');
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
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText('The export could not be completed. Nothing was downloaded.')).toBeTruthy();
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });
});

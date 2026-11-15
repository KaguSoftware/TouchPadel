import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// /monitoring (0393): the dev role's list of crashes and errors, its counts,
// filters and the detail dialog. The data is the server's.

vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));

const rpc: Array<{ fn: string; args: Record<string, unknown> }> = [];
let events: Record<string, unknown>[] = [];
let weekly: { weeks: Record<string, unknown>[] } | Error = { weeks: [] };

vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    rpc.push({ fn, args });
    if (fn === 'monitoring_events_page') return { rows: events, nextBeforeId: null };
    if (fn === 'assistant_weekly_page') {
      if (weekly instanceof Error) throw weekly;
      return weekly;
    }
    if (fn === 'monitoring_summary')
      return {
        bucket: 'hour',
        counts: [{ bucket: new Date().toISOString(), error: 1, warn: 0, info: 0, total: 2 }],
        kinds: [{ kind: 'crash', count: 2, lastAt: null }],
        sources: [],
        totals: { total: 2, error: 1, warn: 1, info: 0, userReported: 1 },
        cronCheckedAt: null,
      };
    throw new Error(`unexpected ${fn}`);
  }),
}));

import { MonitoringPageScreen } from './MonitoringPage';

const event = (over: Record<string, unknown> = {}) => ({
  id: 7,
  at: '2026-11-01T09:15:00Z',
  source: 'mobile',
  level: 'error',
  kind: 'crash',
  message: 'TypeError: undefined is not a function',
  detail: { route: '/book', stack: 'at Book (book.tsx:10)' },
  appVersion: '1.1.0',
  venueName: null,
  staffName: null,
  signedIn: true,
  userReported: true,
  ...over,
});

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <MonitoringPageScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.length = 0;
  events = [];
  weekly = { weeks: [] };
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe('MonitoringPageScreen', () => {
  it('says all is quiet when nothing was reported', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Monitoring' })).toBeTruthy();
    expect(await screen.findByText('All quiet')).toBeTruthy();
    expect(rpc.find((c) => c.fn === 'monitoring_events_page')!.args).toMatchObject({ p_source: null, p_limit: 50 });
    expect(rpc.find((c) => c.fn === 'monitoring_summary')!.args).toMatchObject({ p_bucket: 'hour' });
  });

  it('lists events newest first with the "reported by a person" badge, and opens the detail', async () => {
    events = [event(), event({ id: 6, level: 'warn', userReported: false, message: 'slow print' })];
    renderPage();
    const list = await screen.findByTestId('monitoring-events');
    expect(await within(list).findByText('TypeError: undefined is not a function')).toBeTruthy();
    expect(within(list).getAllByText('Reported by a person')).toHaveLength(1);
    await userEvent.click(within(list).getByText('TypeError: undefined is not a function'));
    const detail = await screen.findByTestId('monitoring-detail');
    expect(within(detail).getByText('1.1.0')).toBeTruthy();
    expect(within(detail).getByText('at Book (book.tsx:10)')).toBeTruthy();
    expect(within(detail).getByText('Phone app')).toBeTruthy();
  });

  it('shows the totals and the most frequent kinds; a kind filters the list', async () => {
    renderPage();
    expect((await screen.findByTestId('monitoring-total-error')).textContent).toContain('1');
    expect(screen.getByTestId('monitoring-total-userReported').textContent).toContain('1');
    await userEvent.click(await screen.findByTestId('monitoring-kind-crash'));
    await waitFor(() =>
      expect(rpc.filter((c) => c.fn === 'monitoring_events_page').at(-1)!.args).toMatchObject({ p_kind: 'crash' }),
    );
  });

  it('filters by person-reported and by period', async () => {
    renderPage();
    await screen.findByText('All quiet');
    await userEvent.click(screen.getByTestId('monitoring-user-reported'));
    await waitFor(() =>
      expect(rpc.filter((c) => c.fn === 'monitoring_events_page').at(-1)!.args).toMatchObject({ p_user_reported: true }),
    );
    expect(await screen.findByText('Nothing matches these filters')).toBeTruthy();
    await userEvent.click(screen.getByTestId('monitoring-period-7d'));
    await waitFor(() =>
      expect(rpc.filter((c) => c.fn === 'monitoring_summary').at(-1)!.args).toMatchObject({ p_bucket: 'day' }),
    );
  });
});

describe('the Assistant table', () => {
  const week = (weekStart: string, over: Record<string, unknown> = {}, figures: Record<string, unknown> = {}) => ({
    weekStart,
    weekEnd: weekStart,
    level: 'info',
    figures: { questions: 3, failed: 0, failedByCode: {}, notSaved: 0, marked: 0, thumbsDown: 0, rated: 0, secondsToAnswerP50: 12, costPerQuestionMicros: 210_000, ...figures },
    ...over,
  });

  it('shows the weeks newest first, three at a time, with the warn badge and the failed codes', async () => {
    weekly = {
      weeks: [
        week('2026-11-02', { weekEnd: '2026-11-08', level: 'warn' }, { questions: 6, failed: 2, failedByCode: { UPSTREAM: 1, NOT_CONFIGURED: 1 }, thumbsDown: 1, rated: 2, secondsToAnswerP50: 20 }),
        week('2026-10-26', {}, { secondsToAnswerP50: null, costPerQuestionMicros: null }),
        week('2026-10-19'),
        week('2026-10-12'),
      ],
    };
    renderPage();
    const panel = await screen.findByTestId('monitoring-assistant');
    expect(within(panel).getByRole('heading', { name: 'Assistant' })).toBeTruthy();
    await within(panel).findByText('1 of 2');
    expect(rpc.find((c) => c.fn === 'assistant_weekly_page')!.args).toEqual({ p_weeks: 12 });
    const body = within(panel).getAllByRole('row').slice(1);
    expect(body).toHaveLength(3);
    expect(within(body[0]!).getByText('Warning')).toBeTruthy();
    expect(within(body[0]!).getByText('2').getAttribute('title')).toBe('UPSTREAM 1, NOT_CONFIGURED 1');
    expect(within(body[0]!).getByTitle(/to/).textContent).toContain('2026');
    expect(within(body[1]!).getAllByText('—')).toHaveLength(3);
    expect(within(body[1]!).queryByText('Warning')).toBeNull();
    // It does not move with the page's filters.
    await userEvent.click(screen.getByTestId('monitoring-period-7d'));
    expect(rpc.filter((c) => c.fn === 'assistant_weekly_page')).toHaveLength(1);
    await userEvent.click(within(panel).getByRole('button', { name: /View more/ }));
    expect(within(panel).getAllByRole('row').slice(1)).toHaveLength(4);
  });

  it('says so in one line when no week had a question', async () => {
    weekly = { weeks: [week('2026-11-02', {}, { questions: 0 })] };
    renderPage();
    const panel = await screen.findByTestId('monitoring-assistant');
    expect(await within(panel).findByText('No assistant questions in the last 12 weeks.')).toBeTruthy();
    expect(within(panel).queryByRole('table')).toBeNull();
  });

  it('offers a retry when the weeks cannot be read', async () => {
    weekly = new Error('boom');
    renderPage();
    const panel = await screen.findByTestId('monitoring-assistant');
    const retry = await within(panel).findByRole('button', { name: /Try again|Retry/ });
    weekly = { weeks: [week('2026-11-02', {}, { thumbsDown: 0, rated: 1 })] };
    await userEvent.click(retry);
    expect(await within(panel).findByText('0 of 1')).toBeTruthy();
  });
});

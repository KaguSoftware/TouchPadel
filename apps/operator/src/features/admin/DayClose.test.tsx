import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// Day close's "Checklists not finished" (0165 app.checklist_day_state; plan
// §7.3): the daily lists with a line nobody ticked on the day being closed are
// a WARNING beside the steps. They never hold the close: with the tabs closed,
// the queue empty and the cash counted, "Close the day" stays open whatever
// the lists say, and a failed read of them only offers a retry.

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirm: () => vi.fn(async () => false) }));
vi.mock('../../lib/supabase', () => {
  // The open tabs (none), the day summary (none yet) and the adjustments (none).
  const from = () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.in = () => Promise.resolve({ data: [], error: null });
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    chain.order = () => Promise.resolve({ data: [], error: null });
    return chain;
  };
  return { supabase: { from }, supabaseUrl: '', supabaseAnonKey: '' };
});
vi.mock('../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Yesterday's session, closed late: the lists are that day's, not today's.
  fetchOpenDay: vi.fn(async () => ({ id: 'ds1', status: 'open', business_date: '2026-09-24', opened_at: '2026-09-24T05:00:00Z', opening_float_iqd: 50000 })),
}));
vi.mock('../../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<{ permissionsFor: (role: string) => unknown }>();
  return { ...actual, usePermissions: () => actual.permissionsFor('manager') };
});
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { AppRpcError, appRpc } from '../../lib/appRpc';
import { DayClose } from './DayClose';

const rpc = vi.mocked(appRpc);

const dayState = {
  business_date: '2026-09-24',
  lists: [
    { role: 'barista', slot: 'open', name_en: 'Bar opening', name_ar: 'افتتاح البار', total: 2, done: 2, open_items: [] },
    {
      role: 'barista',
      slot: 'close',
      name_en: 'Bar closing',
      name_ar: 'إغلاق البار',
      total: 5,
      done: 1,
      open_items: [
        { text_en: 'Wipe the counter', text_ar: 'امسح الكاونتر' },
        { text_en: 'Empty the bins', text_ar: 'أفرغ السلال' },
        { text_en: 'Clean the grinder', text_ar: 'نظّف المطحنة' },
        { text_en: 'Lock the fridge', text_ar: 'اقفل الثلاجة' },
      ],
    },
    { role: 'driver', slot: 'open', name_en: 'Driver opening', name_ar: 'افتتاح السائق', total: 3, done: 0, open_items: [{ text_en: 'Check the van', text_ar: 'افحص السيارة' }] },
  ],
};

let checklists: unknown;
const calls: { fn: string; args: Record<string, unknown> }[] = [];

function mount() {
  rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    calls.push({ fn, args: args ?? {} });
    if (fn === 'checklist_day_state') {
      if (checklists instanceof Error) throw checklists;
      return checklists;
    }
    if (fn === 'unpaid_played_bookings') return [];
    throw new Error(`unexpected ${fn}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <DayClose />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const closeButton = () => screen.getByRole('button', { name: 'Close the day' }) as HTMLButtonElement;

async function countTheCash() {
  await screen.findByRole('button', { name: 'Close the day' });
  // Only the count holds it at this point: the tabs are closed and the queue is empty.
  expect(closeButton().disabled).toBe(true);
  await userEvent.type(screen.getByLabelText('Counted cash (IQD)'), '125000');
  // Re-read each time: the button is rendered anew once its disabled reason goes.
  await waitFor(() => expect(closeButton().disabled).toBe(false));
}

beforeEach(() => {
  rpc.mockReset();
  calls.length = 0;
});

describe('Day close ▸ Checklists not finished', () => {
  it('lists the unfinished lists of the day being closed, and the close stays open', async () => {
    checklists = dayState;
    mount();
    const panel = await screen.findByTestId('day-close-checklists');
    expect(within(panel).getByText('Checklists not finished')).toBeTruthy();
    expect(within(panel).getByText('2 open')).toBeTruthy();
    // The lead names the day being closed, never "today".
    expect(panel.textContent).not.toMatch(/today/i);
    const rows = within(panel).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('1 of 5 done');
    // Three open lines are named, the rest counted.
    expect(rows[0]!.textContent).toContain('Wipe the counter, Empty the bins, Clean the grinder');
    expect(rows[0]!.textContent).toContain('+1 more');
    expect(rows[1]!.textContent).toContain('Check the van');
    // Read for the open session's business date, not the calendar's.
    expect(calls.find((c) => c.fn === 'checklist_day_state')?.args).toEqual({ p_business_date: '2026-09-24' });

    await countTheCash();
    // Still listed: a warning beside an open close, never a block.
    expect(screen.getByTestId('day-close-checklists')).toBeTruthy();
  });

  it('shows only a retry when the lists cannot be read, and the close stays open', async () => {
    checklists = new AppRpcError('UNKNOWN', 'network down');
    mount();
    const panel = await screen.findByTestId('day-close-checklists');
    expect(within(panel).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(panel).getByRole('button', { name: 'Try again' })).toBeTruthy();
    await countTheCash();

    // The read comes back: the retry lists them.
    checklists = dayState;
    await userEvent.click(within(panel).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(within(screen.getByTestId('day-close-checklists')).getAllByRole('listitem')).toHaveLength(2));
  });

  it('shows nothing when every list is finished', async () => {
    checklists = { business_date: '2026-09-24', lists: [dayState.lists[0]] };
    mount();
    await countTheCash();
    await waitFor(() => expect(calls.some((c) => c.fn === 'checklist_day_state')).toBe(true));
    expect(screen.queryByTestId('day-close-checklists')).toBeNull();
  });
});

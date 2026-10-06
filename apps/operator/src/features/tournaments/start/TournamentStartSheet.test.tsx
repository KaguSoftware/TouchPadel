import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';

// "Start: Tournament", the section-menu sheet: the menu, the timeline's
// picks becoming the plan's ranges, and the start_protocol call. The day's
// hours, courts and bookings are stubbed at useTradingNight.

vi.mock('../../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const DAY = '2026-11-06';

vi.mock('../../desk/useTradingNight', () => ({
  tonightInTz: () => '2026-11-06',
  useTradingNight: (date: string) => ({
    date,
    tz: 'Asia/Baghdad',
    settingsQ: { data: { opening_hours: {} } },
    courtsQ: { isLoading: false },
    courts: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name_en: 'Court 1',
        name_ar: 'ملعب 1',
        duration_options: [],
        sort_order: 1,
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        name_en: 'Court 2',
        name_ar: 'ملعب 2',
        duration_options: [],
        sort_order: 2,
      },
    ],
    // Court 2 is booked 18:00–19:00 (15:00Z, Baghdad is UTC+3).
    reservations: [
      {
        id: 'r1',
        court_id: '22222222-2222-4222-8222-222222222222',
        kind: 'booking',
        guest_name: 'Sara K.',
        status: 'confirmed',
        start_at: '2026-11-06T15:00:00Z',
        end_at: '2026-11-06T16:00:00Z',
      },
    ],
    openMin: 17 * 60,
    closeMin: 21 * 60,
    closed: false,
  }),
}));

import { appRpc } from '../../../lib/appRpc';
import { TournamentStartSheet } from './TournamentStartSheet';

const rpc = vi.mocked(appRpc);

function mount(onStarted = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <TournamentStartSheet onClose={vi.fn()} onStarted={onStarted} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { onStarted };
}

const menu = () => within(screen.getByRole('navigation', { name: 'Plan sections' }));

beforeEach(() => {
  rpc.mockReset();
});

describe('TournamentStartSheet', () => {
  it('marks the sections that need a look and sends nothing when empty', async () => {
    const user = userEvent.setup();
    mount();
    // Start is on the last step only.
    expect(screen.queryByTestId('tournament-start-send')).toBeNull();
    await user.click(menu().getByRole('button', { name: /^Risks & notes/ }));
    await user.click(screen.getByTestId('tournament-start-send'));
    expect(rpc).not.toHaveBeenCalled();
    expect(
      screen.getByText('Some sections need a look. They are marked in the menu.'),
    ).toBeTruthy();
    expect(menu().getAllByText('Needs a look').length).toBeGreaterThan(0);
    // It jumps to the first marked section: the name.
    expect(screen.getByRole('heading', { level: 3, name: 'Name' })).toBeTruthy();
  });

  it('turns the picked hours into the plan’s ranges and starts the run', async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue({ run_id: 'run-1', auto: false });
    const { onStarted } = mount();

    await user.click(menu().getByRole('button', { name: /^Name/ }));
    await user.type(screen.getByLabelText(/Name in English/), 'Friday Night Americano');
    await user.type(screen.getByLabelText(/Name in Arabic/), 'أمريكانو');
    await user.click(screen.getByRole('radio', { name: /^Class A Advanced/ }));
    await user.click(screen.getByRole('radio', { name: /^Americano Runs in the app/ }));

    await user.click(menu().getByRole('button', { name: /^Courts & time/ }));
    // Court 1, 18:00 to 20:00 by dragging; Court 2's 18:00 is booked.
    const c1at18 = screen.getByRole('gridcell', { name: /^Court 1, .?6:00 PM/ });
    const c1at19 = screen.getByRole('gridcell', { name: /^Court 1, .?7:00 PM/ });
    fireEvent.pointerDown(c1at18);
    fireEvent.pointerEnter(c1at19);
    fireEvent.pointerUp(window);
    // A booked hour cannot be picked, and its tooltip says what holds it.
    const booked = screen.getByRole('gridcell', { name: /^Court 2, .?6:00 PM.*Already booked/ });
    expect(booked.getAttribute('aria-disabled')).toBe('true');
    // Its hover card (the kit's InfoTip) says what holds it.
    const card = document.getElementById(booked.getAttribute('aria-describedby') ?? '');
    expect(card?.textContent).toMatch(/Already booked.*Booking · Sara K\..*6:00/);
    fireEvent.pointerDown(booked);
    fireEvent.pointerUp(window);
    expect(booked.getAttribute('aria-selected')).toBe('false');
    // The picked slot shows under the grid, with a button to take it off.
    expect(screen.getByRole('button', { name: /^Remove .*Court 1$/ })).toBeTruthy();

    await user.click(menu().getByRole('button', { name: /^Players & money/ }));
    await user.type(screen.getByLabelText(/How many/), '16');

    // The footer's one button walks on to the last step, where it starts the plan.
    await user.click(
      within(screen.getByRole('contentinfo')).getByRole('button', { name: 'Risks & notes' }),
    );
    await user.click(screen.getByTestId('tournament-start-send'));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith({ run_id: 'run-1', auto: false }));
    const [name, args] = rpc.mock.calls[0]!;
    expect(name).toBe('start_protocol');
    expect(args).toMatchObject({
      p_kind: 'tournament',
      p_variant: 'type1',
      p_title_en: 'Friday Night Americano',
      p_first_record: {
        class: 'A',
        format: 'americano',
        ranges: [{ court_ids: [C1], from: `${DAY}T15:00:00.000Z`, to: `${DAY}T17:00:00.000Z` }],
        capacity: { unit: 'players', count: 16 },
      },
    });
    expect(C2).toBeTruthy();
  });

  it('shows the sponsor step only once type 3 is picked', async () => {
    const user = userEvent.setup();
    mount();
    expect(menu().queryByRole('button', { name: /^Sponsor/ })).toBeNull();
    expect(screen.getByText('1 of 5 done')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Type 3 Sponsor or client/ }));
    expect(menu().getByRole('button', { name: /^Sponsor/ })).toBeTruthy();
    expect(screen.getByText('1 of 6 done')).toBeTruthy();
  });
});

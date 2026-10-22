import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wallTimeToUtc } from '@touch/core';
import { LocaleProvider } from '../../lib/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { StartMatchDialog, type StartMatchDialogProps } from './StartMatchDialog';
import type { OpenMatch, OpenMatches } from './matchPayloads';

// The Start dialog (docs/design/open-matches/operator.md §5.11) over a real
// query client. The price quote and the start are mocked at appRpc, the
// router and toast at their hooks, the station's reach at its hook.

let price = 40000;
let started: unknown = { match_id: 'm-new', price_iqd: 40000, shares_iqd: [10000, 10000, 10000, 10000] };
let reachable = true;

vi.mock('../../lib/appRpc', () => ({
  AppRpcError: class AppRpcError extends Error {
    constructor(
      public code: string,
      message?: string,
      public hint?: string,
      public details?: string,
    ) {
      super(message ?? code);
    }
  },
  isRpcMissing: () => false,
  appRpc: vi.fn(async (fn: string) => {
    if (fn === 'price_slot') return [{ rule_id: 'r', price_iqd: price }];
    if (fn === 'desk_start_match') {
      if (started instanceof Error) throw started;
      return started;
    }
    return [];
  }),
}));
const { navigateSpy, toastOk } = vi.hoisted(() => ({ navigateSpy: vi.fn(), toastOk: vi.fn() }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: toastOk, err: vi.fn(), info: vi.fn() }) }));
vi.mock('../../lib/stationReach', () => ({ useStationReach: () => ({ reachable }) }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const TZ = 'Asia/Baghdad';
const DATE = '2099-09-03';
const at = (min: number) => wallTimeToUtc(DATE, min, TZ);
const courts = [
  { id: 'c1', name_en: 'Court 1', name_ar: 'ملعب 1', duration_options: [60, 90], sort_order: 1 },
  { id: 'c2', name_en: 'Court 2', name_ar: 'ملعب 2', duration_options: [60, 90], sort_order: 2 },
];
const night = { date: DATE, rows: [19 * 60, 19 * 60 + 30, 20 * 60, 20 * 60 + 30, 21 * 60, 21 * 60 + 30, 22 * 60], reservations: [] };

function envelope(over: Partial<OpenMatches> = {}): OpenMatches {
  // The server's clock at 16:00 that night: the earliest start is 19:00.
  return { matches_enabled: true, fill_deadline_minutes: 120, earliest_start_minutes: 180, ticket_price_iqd: 10000, server_now: at(16 * 60).toISOString(), matches: [], ...over };
}

function filling(over: Partial<OpenMatch> & { match_id: string }): OpenMatch {
  return {
    venue_id: 'v1',
    status: 'filling',
    start_at: at(20 * 60).toISOString(),
    end_at: at(21 * 60 + 30).toISOString(),
    duration_min: 90,
    category: 'open',
    join_policy: 'open',
    visibility: 'public',
    seats_taken: 2,
    seats_left: 2,
    requests_pending: 0,
    fill_deadline_at: at(18 * 60).toISOString(),
    organised_by: 'guest',
    organiser: null,
    price_iqd: 40000,
    shares_iqd: [10000, 10000, 10000, 10000],
    courts_free_firm: 2,
    courts_total: 2,
    ...over,
  };
}

function open(over: Partial<StartMatchDialogProps> = {}) {
  const props: StartMatchDialogProps = {
    courtId: 'c2',
    startAt: at(20 * 60),
    courts,
    tz: TZ,
    night,
    guestName: 'Sara Ahmed',
    guestPhone: '07701234567',
    openMatches: envelope(),
    openMatchesAt: Date.now(),
    onClose: vi.fn(),
    ...over,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <StartMatchDialog {...props} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return props;
}

// The stepped flow (StepWizard): the menu's rows are `match.step.<key>`, the
// submit is on Review. Moving forward stops at the first unfinished step and
// lists what holds it.
type User = ReturnType<typeof userEvent.setup>;
const go = (user: User, key: 'organiser' | 'whoPlays' | 'when' | 'review') => user.click(screen.getByTestId(`match.step.${key}`));
const startButton = () => screen.getByTestId('match.submit') as HTMLButtonElement;
const startCalls = () => vi.mocked(appRpc).mock.calls.filter(([fn]) => fn === 'desk_start_match');
const priceShown = () => screen.findByText('Court 40,000 IQD · each player pays 10,000 IQD');

beforeEach(() => {
  price = 40000;
  started = { match_id: 'm-new', price_iqd: 40000, shares_iqd: [10000, 10000, 10000, 10000] };
  reachable = true;
  vi.mocked(appRpc).mockClear();
  navigateSpy.mockClear();
  toastOk.mockClear();
});

describe('StartMatchDialog', () => {
  it('walks Organiser, Who plays, Court & time, then Review', async () => {
    const user = userEvent.setup();
    open();
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Organiser' })).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: 'Who plays' }).at(-1)!);
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: 'Court & time' }).at(-1)!);
    expect(screen.getByText('Step 3 of 3')).toBeTruthy();
    await priceShown();
    await go(user, 'review');
    for (const label of ['Organiser', 'Category', 'Join', 'Found by', 'Court', 'Price']) expect(screen.getByRole('button', { name: `Change ${label}` })).toBeTruthy();
    const review = within(document.querySelector('.tp-wiz-review') as HTMLElement);
    expect(review.getByText('Sara Ahmed')).toBeTruthy();
    expect(review.getByText('Open')).toBeTruthy();
    expect(review.getByText('Anyone joins at once')).toBeTruthy();
    expect(review.getByText('Listed at the branch')).toBeTruthy();
    expect(review.getByText('40,000 IQD · 10,000 IQD each')).toBeTruthy();
  });

  it('shows the court price and each player’s share, from the function the server stamps with', async () => {
    const user = userEvent.setup();
    open();
    await go(user, 'when');
    expect(await priceShown()).toBeTruthy();
    expect(screen.getByText('At the desk. Players who join in the app use one ticket each; desk players need none.')).toBeTruthy();
  });

  it('starts a typed walk-in’s match with the §1.7 arguments, then lands on it', async () => {
    const user = userEvent.setup();
    const props = open();
    // "+1" is LTR-isolated, so the name carries the marks.
    await user.click(screen.getByRole('button', { name: /\+1/ }));
    await go(user, 'whoPlays');
    await user.click(screen.getByTestId('match.category.women'));
    expect(screen.getByText('Every player is a woman.')).toBeTruthy();
    await go(user, 'when');
    await priceShown();
    await go(user, 'review');
    await user.click(startButton());
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith({ to: '/desk/matches/$id', params: { id: 'm-new' } }));
    expect(appRpc).toHaveBeenCalledWith('desk_start_match', {
      p_start_at: at(20 * 60).toISOString(),
      p_duration_min: 60,
      p_category: 'women',
      p_visibility: 'public',
      p_join_policy: 'open',
      p_customer_id: null,
      p_guest_name: 'Sara Ahmed',
      p_guest_phone: '07701234567',
      p_gender: 'female',
      p_extra_seats: 1,
      p_court_id: 'c2',
      p_venue_id: null,
      p_idempotency_key: expect.stringMatching(/^match\.start:/),
    });
    expect(toastOk).toHaveBeenCalledWith('Open match started. Share the link or add players.');
    expect(props.onClose).toHaveBeenCalled();
  });

  it('says the new court price when the server stamped another one', async () => {
    const user = userEvent.setup();
    started = { match_id: 'm-new', price_iqd: 44000, shares_iqd: [11000, 11000, 11000, 11000] };
    open();
    await go(user, 'when');
    await priceShown();
    await go(user, 'review');
    await user.click(startButton());
    await waitFor(() => expect(toastOk).toHaveBeenCalledWith('Open match started. The court price is now 44,000 IQD; each player pays 11,000 IQD.'));
  });

  it('sends the same key again after a failed try, so a lost answer never starts two matches', async () => {
    const user = userEvent.setup();
    started = new AppRpcError('UNKNOWN', 'TypeError: Failed to fetch');
    open();
    await go(user, 'when');
    await priceShown();
    await go(user, 'review');
    await user.click(startButton());
    await waitFor(() => expect(startCalls()).toHaveLength(1));
    started = { match_id: 'm-new', price_iqd: 40000, shares_iqd: [10000, 10000, 10000, 10000] };
    await user.click(startButton());
    await waitFor(() => expect(startCalls()).toHaveLength(2));
    const keys = startCalls().map(([, args]) => (args as { p_idempotency_key: string }).p_idempotency_key);
    expect(keys[0]).toBe(keys[1]);
  });

  it('too close to the start by the server’s clock: Court & time holds, and says the earliest time (OM-43)', async () => {
    const user = userEvent.setup();
    open({ openMatches: envelope({ server_now: at(18 * 60).toISOString() }) });
    await go(user, 'when');
    await priceShown();
    await go(user, 'review');
    const reason = 'Too close to the start for an open match: the earliest is 9:00 PM. Book the court instead.';
    expect(screen.getByText('Step 3 of 3')).toBeTruthy();
    expect(screen.getAllByText(reason).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('match.submit')).toBeNull();
  });

  it('needs an organiser: a typed name or a linked customer', async () => {
    const user = userEvent.setup();
    open({ guestName: '' });
    await go(user, 'review');
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    expect(screen.getByText('A booking needs a guest name or a linked account.')).toBeTruthy();
  });

  it("a typed organiser's phone follows the server's rule (7 to 15 digits), said on its box", async () => {
    const user = userEvent.setup();
    open({ guestPhone: '0770 12' });
    // Carried over from the booking dialog, so it is said on the box at once.
    expect(screen.getByText('A phone number has 7 to 15 digits.')).toBeTruthy();
    expect((screen.getByLabelText('Guest name') as HTMLInputElement).maxLength).toBe(80);
    await go(user, 'review');
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    expect(screen.getAllByText('A phone number has 7 to 15 digits.')).toHaveLength(2);
  });

  it('INVALID_ARGUMENT p_guest_name from the server lands on the name box', async () => {
    const user = userEvent.setup();
    started = new AppRpcError('INVALID_ARGUMENT', 'INVALID_ARGUMENT', undefined, 'p_guest_name');
    open();
    await go(user, 'when');
    await priceShown();
    await go(user, 'review');
    await user.click(startButton());
    expect(await screen.findByText('A name can be at most 80 characters.')).toBeTruthy();
    // Back on the Organiser step, where the box is.
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    expect(screen.queryByText(/Invalid input/)).toBeNull();
  });

  it('asks to join only for a linked customer (someone with the app answers)', async () => {
    const user = userEvent.setup();
    open();
    await go(user, 'whoPlays');
    expect((screen.getByRole('button', { name: 'Players ask to join' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Only a customer with the app can approve players.')).toBeTruthy();
  });

  it('a linked customer may ask players to join, and is sent alone', async () => {
    const user = userEvent.setup();
    open({ customer: { id: 'g1', name: 'Layla Hassan', phone: '07700000000', flags: [] }, guestName: '', guestPhone: '' });
    await go(user, 'whoPlays');
    await user.click(screen.getByRole('button', { name: 'Players ask to join' }));
    await user.click(screen.getByRole('button', { name: 'Only with the link' }));
    await go(user, 'when');
    await priceShown();
    await go(user, 'review');
    expect(screen.getByText('Players ask to join')).toBeTruthy();
    expect(screen.getByText('Only with the link')).toBeTruthy();
    await user.click(startButton());
    await waitFor(() => expect(startCalls()).toHaveLength(1));
    expect(startCalls()[0]![1]).toMatchObject({ p_customer_id: 'g1', p_guest_name: null, p_guest_phone: null, p_join_policy: 'approve', p_visibility: 'link' });
  });

  it('a customer banned from open matches cannot organise one', async () => {
    const user = userEvent.setup();
    open({ customer: { id: 'g1', name: 'Layla Hassan', phone: null, flags: [{ type: 'match_ban', label: 'conduct' }] } });
    await go(user, 'review');
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    expect(screen.getAllByText('Banned from open matches').length).toBeGreaterThan(1);
  });

  it('a linked woman cannot organise a men’s match: Who plays holds, with her record to hand', async () => {
    const user = userEvent.setup();
    open({ customer: { id: 'g1', name: 'Layla Hassan', phone: null, flags: [], gender: 'female' } });
    await go(user, 'whoPlays');
    await user.click(screen.getByTestId('match.category.men'));
    expect(screen.getAllByText("This customer's declared gender doesn't fit this category.").length).toBeGreaterThan(0);
    expect(screen.getByText('Open their record')).toBeTruthy();
    await go(user, 'review');
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
  });

  it('MATCH_SLOT_FULL: lists the matches filling at that time, each with Add player', async () => {
    const user = userEvent.setup();
    started = new AppRpcError('MATCH_SLOT_FULL', 'MATCH_SLOT_FULL', undefined, '2');
    const props = open({
      customer: { id: 'g1', name: 'Layla Hassan', phone: null, flags: [] },
      openMatches: envelope({ matches: [filling({ match_id: 'f1' }), filling({ match_id: 'later', start_at: at(22 * 60).toISOString(), end_at: at(23 * 60).toISOString() })] }),
    });
    await go(user, 'when');
    await priceShown();
    await go(user, 'review');
    await user.click(startButton());
    expect(await screen.findByText('These open matches are already filling at that time:')).toBeTruthy();
    const add = screen.getAllByRole('button', { name: /^Add player/ });
    expect(add).toHaveLength(1);
    await user.click(add[0]!);
    expect(props.onClose).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/desk/matches/$id', params: { id: 'f1' }, search: { customer: 'g1' } });
  });

  it('MATCH_TOO_LATE from the server: the earliest time from its detail and the server’s clock', async () => {
    const user = userEvent.setup();
    started = new AppRpcError('MATCH_TOO_LATE', 'MATCH_TOO_LATE', undefined, '180');
    // No lead in the envelope: the mirror cannot block, the server does.
    open({ openMatches: envelope({ server_now: at(18 * 60).toISOString(), earliest_start_minutes: null }) });
    await go(user, 'when');
    await priceShown();
    await go(user, 'review');
    await user.click(startButton());
    expect(await screen.findByText('Too close to the start for an open match: the earliest is 9:00 PM. Book the court instead.')).toBeTruthy();
  });

  it('offline: Start stays on screen, disabled, with the reason (DF-11)', async () => {
    const user = userEvent.setup();
    reachable = false;
    open();
    await go(user, 'review');
    expect(startButton().disabled).toBe(true);
    expect(startButton().title).toBe('Needs a connection: open matches work online only');
  });

  it('Arabic: right to left, Latin digits in the price line', async () => {
    window.localStorage.setItem('touch-operator-locale', 'ar');
    try {
      const user = userEvent.setup();
      open();
      await go(user, 'when');
      const line = await screen.findByTestId('start-price');
      await waitFor(() => expect(line.textContent).toMatch(/40,000/));
      expect(line.textContent).toMatch(/^الملعب /);
    } finally {
      window.localStorage.removeItem('touch-operator-locale');
    }
  });
});

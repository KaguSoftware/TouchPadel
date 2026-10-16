import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { ToastProvider } from '../../components/toast';

// Today (/ops), rebuilt 2026-10-16. Each test pins one of the rules the
// rebuild exists for: one to-do list (the queues are rows that open in place),
// every figure once, colour only where there is something to do, the day not
// open as one banner, and every way out going to exactly those items. The RPC,
// the broadcasts, the router and the station queue are mocked at the seam.

const rpc = vi.hoisted(() => ({ appRpc: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
const queue = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: rpc.appRpc,
}));
vi.mock('../../lib/realtime', () => ({ useBroadcast: () => ({ status: 'live' }) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => nav.navigate }));
vi.mock('../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchVenueSettings: async () => ({ timezone: 'Asia/Baghdad', opening_hours: null, closed_dates: [] }),
}));
// What this station has not sent yet: only the machine knows (opsLogic).
vi.mock('../../ipc/bridge', async (importOriginal) => {
  const actual = await importOriginal<{ touch: Record<string, unknown> }>();
  return { ...actual, touch: { ...actual.touch, getQueueRows: () => Promise.resolve(queue.rows), onQueueUpdate: () => () => {} } };
});
// The people records and the queues are read only for a role that acts on them.
const who = vi.hoisted(() => ({ role: 'manager' }));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 'm1', displayName: 'Manager', role: who.role } }),
}));
// Which workspace's rail is showing: /ops is the Operations workspace's home.
const ws = vi.hoisted(() => ({ active: 'owner' as string | null }));
vi.mock('../../routes/__root', () => ({ useWorkspaceOrNull: () => (ws.active ? { active: ws.active } : null) }));

import { OperationsOverviewScreen } from './OperationsOverview';

const payload = {
  businessDate: '2026-09-03',
  bookings: {
    today: 12,
    arrived: 4,
    upcoming: 7,
    noShows: 1,
    cancelledToday: 2,
    nextArrival: { startAt: '2026-09-03T15:00:00Z', guestName: 'Ali', courtNameEn: 'Court 2', courtNameAr: 'الملعب 2' },
  },
  cafe: { openTabs: 3, ordersToday: 41, ticketsQueued: 2, ticketsLate: 1, waiterCallsOpen: 0 },
  stock: { low: 2, belowPar: 5, expiringSoon: 1, expired: 0, openAlerts: 0, lastCountAt: null },
  staffActivity: [{ staffId: 's1', name: 'Noor', role: 'cashier', ordersTaken: 9, bookingsCreated: 2 }],
  exceptions: { discounts: { count: 2, amountIqd: 15000 }, voids: { count: 0, amountIqd: 0 }, refunds: { count: 1, amountIqd: 3000 } },
  dayClose: {
    open: true,
    businessDate: '2026-09-03',
    openedAt: '2026-09-03T06:00:00Z',
    blockingTabs: [{ id: 'tab-1', label: 'walk-in', tableNumber: '4' }],
  },
};

/** Each RPC's answer; anything unnamed answers an empty object. */
let answers: Record<string, unknown>;

function failedRefund() {
  return {
    id: 'pay-1',
    request_id: 'req-1',
    reservation_id: 'res-1',
    purpose: 'deposit',
    guest_name: 'Omar Saleh',
    guest_phone: '+9647701234567',
    amount_iqd: 10000,
    refund_amount_iqd: 10000,
    status: 'refund_failed',
    refund_reason: 'guest_cancel',
    refund_requested_at: '2026-09-02T09:00:00Z',
    refund_attempts: 2,
    succeeded_at: '2026-09-01T09:00:00Z',
    sandbox: false,
    court_name_en: 'Court 1',
    court_name_ar: 'الملعب 1',
    start_at: '2026-09-04T15:00:00Z',
  };
}

beforeEach(() => {
  rpc.appRpc.mockReset();
  nav.navigate.mockReset();
  who.role = 'manager';
  ws.active = 'manager';
  queue.rows = [];
  answers = { ops_overview: payload };
  rpc.appRpc.mockImplementation(async (fn: string) => {
    const a = answers[fn];
    if (a instanceof Error) throw a;
    return a === undefined ? {} : structuredClone(a);
  });
});

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <OperationsOverviewScreen />
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

/** The panel holding `name`, so a label is looked for in exactly one place. */
function panel(testId: string): ReturnType<typeof within> {
  return within(screen.getByTestId(testId));
}

/** Without the direction isolates a counted phrase wraps its number in. */
const plain = (s: string | null | undefined) => (s ?? '').replace(/[\u2066-\u2069\u200e\u200f]/g, '');

/** The text of the row holding `label`, inside `scope`. */
function rowText(scope: ReturnType<typeof within>, label: string): string {
  const el = scope.getByText(label);
  return plain((el.closest('button') ?? el.parentElement!.parentElement)!.textContent);
}

const ready = () => screen.findByTestId('who-worked');

describe('OperationsOverviewScreen', () => {
  it('shows a skeleton while loading', () => {
    rpc.appRpc.mockReturnValue(new Promise(() => {}));
    renderScreen();
    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(screen.queryByText('Who worked today')).toBeNull();
  });

  it('renders the day from the server document: the to-do list, the floor, closing, stock, today and who worked', async () => {
    renderScreen();
    await ready();
    expect(rpc.appRpc).toHaveBeenCalledWith('ops_overview');
    for (const heading of ['Needs you', 'On the floor now', 'Before you close', 'Stock to watch', 'So far today', 'Who worked today']) {
      expect(screen.getByRole('heading', { name: new RegExp(`^${heading}`) })).toBeTruthy();
    }
    // Who worked is a table, not a ranking.
    expect(screen.getByRole('table', { name: 'Who worked today' })).toBeTruthy();
    expect(screen.getByText('Noor')).toBeTruthy();
    expect(screen.getByText('15,000 IQD')).toBeTruthy();
    // The subtitle names the business day and since when it is open.
    expect(screen.getByText(/^Thursday, .*open since /)).toBeTruthy();
  });

  it('prints every figure once: what is in "Needs you" is not repeated in the panels', async () => {
    answers.ops_overview = { ...payload, cafe: { ...payload.cafe, waiterCallsOpen: 3, ticketsLate: 5 }, stock: { ...payload.stock, low: 2, expired: 1 } };
    renderScreen();
    await ready();
    const needs = panel('needs-you');
    expect(needs.getByText('Tables calling for a waiter')).toBeTruthy();
    expect(needs.getByText('Kitchen orders running late')).toBeTruthy();
    // Nowhere else on the page.
    expect(screen.getAllByText(/calling for a waiter/i)).toHaveLength(1);
    expect(panel('floor-now').queryByText(/late|target/i)).toBeNull();
    expect(panel('stock-watch').queryByText(/Running low|Expired/)).toBeNull();
    // Open tabs is a figure on the floor; its way there is named for the screen.
    expect(screen.getAllByText('Open tabs')).toHaveLength(1);
    expect(panel('floor-now').getByRole('button', { name: 'See tabs' })).toBeTruthy();
  });

  it('gives each row one way to act, and late orders none: the kitchen cooks them', async () => {
    renderScreen();
    await ready();
    const needs = panel('needs-you');
    // payload: one late order and two ingredients low; no waiter call, nothing expired.
    expect(needs.getByText('Kitchen orders running late')).toBeTruthy();
    expect(needs.getByText('Ingredients running low')).toBeTruthy();
    expect(needs.queryByText('Tables calling for a waiter')).toBeNull();
    expect(needs.getByText('Tell the kitchen')).toBeTruthy();
    expect(needs.getAllByRole('button').map((b: HTMLElement) => b.textContent)).toEqual(['See which']);
    fireEvent.click(needs.getByRole('button', { name: 'See which' }));
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ href: '/stock?filter=low' }));
  });

  it('says "nothing needs you" on one line when nothing stands', async () => {
    answers.ops_overview = { ...payload, cafe: { ...payload.cafe, ticketsLate: 0 }, stock: { ...payload.stock, low: 0 } };
    renderScreen();
    expect(await screen.findByText('Nothing needs you right now.')).toBeTruthy();
    // Below par and expiring soon are still on the page, as stock to watch.
    const stock = panel('stock-watch');
    expect(stock.getByText('Below the level you keep')).toBeTruthy();
    expect(stock.getByText('Expiring soon')).toBeTruthy();
  });

  // Owner call 2026-10-08: a list that stacks shows three rows, then "View more".
  it('shows three rows by who is waiting, and folds the rest behind "View more"', async () => {
    answers.ops_overview = { ...payload, cafe: { ...payload.cafe, waiterCallsOpen: 2, ticketsLate: 900 }, stock: { ...payload.stock, low: 2, expired: 1 } };
    renderScreen();
    await ready();
    const needs = panel('needs-you');
    // Four stand: waiter calls, late orders, expired, low; never sorted by count.
    expect(needs.getAllByRole('listitem').map((li: HTMLElement) => li.getAttribute('data-testid'))).toEqual(['need-waiterCalls', 'need-ticketsLate', 'need-expired']);
    const more = needs.getByRole('button', { name: 'View more (1)' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(needs.getAllByRole('listitem')).toHaveLength(4);
    expect(needs.getByText('Ingredients running low')).toBeTruthy();
    fireEvent.click(needs.getByRole('button', { name: 'Show less' }));
    expect(needs.getAllByRole('listitem')).toHaveLength(3);
  });

  it('opens an online refund in place, under its row, with the actions it needs', async () => {
    answers.ops_overview = { ...payload, cafe: { ...payload.cafe, ticketsLate: 0 }, stock: { ...payload.stock, low: 0 } };
    answers.deposit_attention = [failedRefund()];
    renderScreen();
    const row = await screen.findByTestId('need-deposits');
    expect(within(row).getByText('Online refunds needing attention')).toBeTruthy();
    const review = within(row).getByRole('button', { name: 'Review refunds' });
    expect(review.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('deposit-attention')).toBeNull();
    fireEvent.click(review);
    expect(review.getAttribute('aria-expanded')).toBe('true');
    const opened = within(await within(row).findByTestId('deposit-attention'));
    expect(opened.getByText('Omar Saleh')).toBeTruthy();
    expect(opened.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(opened.getByRole('button', { name: 'Settled another way' })).toBeTruthy();
    fireEvent.click(review);
    expect(screen.queryByTestId('deposit-attention')).toBeNull();
  });

  it('opens the player reports in place with Close report and Ban', async () => {
    answers.ops_overview = { ...payload, cafe: { ...payload.cafe, ticketsLate: 0 }, stock: { ...payload.stock, low: 0 } };
    answers.match_reports_open = [
      {
        report_id: 'r1',
        reason: 'abusive_behaviour',
        created_at: '2026-09-02T19:00:00Z',
        match: { id: 'm1', start_at: '2026-09-02T17:00:00Z', category: 'open', status: 'played' },
        reported: { customer_id: 'c1', full_name: 'Ali Jasim', phone: '+9647700000001', flags: [], banned: false, reports_90d: 2, no_shows: 0 },
        reporter: { customer_id: 'c2', full_name: 'Zaid Karim' },
      },
    ];
    renderScreen();
    const row = await screen.findByTestId('need-matchReports');
    fireEvent.click(within(row).getByRole('button', { name: 'Review reports' }));
    const report = within(await within(row).findByTestId('match-report'));
    expect(report.getByText('Ali Jasim')).toBeTruthy();
    expect(report.getByRole('button', { name: 'Close report' })).toBeTruthy();
    expect(report.getByRole('button', { name: 'Ban' })).toBeTruthy();
  });

  it('names the lesson money due in its row, and opens it with Refund', async () => {
    answers.ops_overview = { ...payload, cafe: { ...payload.cafe, ticketsLate: 0 }, stock: { ...payload.stock, low: 0 } };
    answers.lesson_refunds_due = {
      venue_id: 'v1',
      total_iqd: 30000,
      items: [
        {
          enrolment_id: 'e1',
          lesson_id: 'l1',
          course_id: null,
          kind: 'private',
          coach_name_en: 'Coach Rami',
          coach_name_ar: 'المدرب رامي',
          start_at: '2026-09-03T15:00:00Z',
          label: 'Laith Abbas',
          phone: '0770 222 3334',
          cancel_kind: 'staff',
          refund_due_iqd: 30000,
          refund_due_desk_iqd: 30000,
          online_blocked_iqd: 0,
          payments: [{ payment_id: 'p1', tab_id: 't1', method: 'cash', amount_iqd: 30000, refunded_iqd: 0, refundable_iqd: 30000, created_at: null }],
        },
      ],
    };
    renderScreen();
    const row = await screen.findByTestId('need-lessonRefunds');
    expect(within(row).getByText(/30,000 IQD paid at the desk/)).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Review lesson refunds' }));
    const due = within(await within(row).findByTestId('lesson-refund'));
    expect(due.getByText('Laith Abbas')).toBeTruthy();
    expect(due.getByRole('button', { name: 'Refund' })).toBeTruthy();
  });

  // R75: a lesson whose online share Qi could not take back links to the
  // online refunds. On Today they are a folded row, so the link opens it.
  it('opens the online refunds row from a lesson refund’s "Online refunds" link', async () => {
    answers.ops_overview = { ...payload, cafe: { ...payload.cafe, ticketsLate: 0 }, stock: { ...payload.stock, low: 0 } };
    answers.deposit_attention = [failedRefund()];
    answers.lesson_refunds_due = {
      venue_id: 'v1',
      total_iqd: 0,
      items: [
        {
          enrolment_id: 'e2',
          lesson_id: 'l2',
          course_id: 'c1',
          kind: 'group',
          start_at: '2026-09-03T15:00:00Z',
          label: 'Rana Saad',
          cancel_kind: 'staff',
          refund_due_iqd: 10000,
          refund_due_desk_iqd: 0,
          online_blocked_iqd: 10000,
          payments: [],
        },
      ],
    };
    // Scrolling is the browser's; jsdom has none.
    Element.prototype.scrollIntoView = vi.fn();
    renderScreen();
    const lessons = await screen.findByTestId('need-lessonRefunds');
    fireEvent.click(within(lessons).getByRole('button', { name: 'Review lesson refunds' }));
    expect(screen.queryByTestId('deposit-attention')).toBeNull();
    fireEvent.click(await within(lessons).findByRole('button', { name: 'Online refunds' }));
    const deposits = screen.getByTestId('need-deposits');
    expect(within(deposits).getByRole('button', { name: 'Review refunds' }).getAttribute('aria-expanded')).toBe('true');
    expect(await within(deposits).findByText('Omar Saleh')).toBeTruthy();
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  });

  it('says beside the rows when a check did not load, with a retry', async () => {
    answers.protocols_waiting_count = new Error('NETWORK');
    renderScreen();
    await ready();
    const needs = panel('needs-you');
    expect(await needs.findByText('Some of this list didn’t load, so it may be missing something.')).toBeTruthy();
    answers.protocols_waiting_count = { to_decide: 1, todo: 0 };
    fireEvent.click(needs.getByRole('button', { name: 'Try again' }));
    expect(await needs.findByText('Protocol steps waiting on you')).toBeTruthy();
    await waitFor(() => expect(needs.queryByText(/didn’t load/)).toBeNull());
  });

  it('puts the day not being open in one banner, the only primary action, and nowhere else', async () => {
    answers.ops_overview = { ...payload, businessDate: '2026-09-03', dayClose: { open: false, businessDate: null, openedAt: null, blockingTabs: [] } };
    renderScreen();
    await ready();
    const banner = panel('day-closed');
    expect(banner.getByRole('heading', { name: 'The day isn’t open' })).toBeTruthy();
    fireEvent.click(banner.getByRole('button', { name: 'Open the day' }));
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ href: '/admin/day-close' }));
    // Not a row of "Needs you", and no closing checks for a day that is not open.
    expect(panel('needs-you').queryByText(/isn’t open/)).toBeNull();
    expect(screen.queryByTestId('before-close')).toBeNull();
    // The subtitle still says which day it is, by the server's clock.
    expect(screen.getByText('Thursday, Sep 3, 2026')).toBeTruthy();
  });

  it('checks the two things that stop the day closing, and leads with one state word', async () => {
    queue.rows = [{}, {}];
    renderScreen();
    await ready();
    const close = panel('before-close');
    expect(close.getByText('Open tabs left')).toBeTruthy();
    expect(close.getByText('One tab is still open')).toBeTruthy();
    // English has no dual: two reads "2 changes".
    expect(plain(close.getByText(/changes waiting to send/).textContent)).toBe('2 changes waiting to send');
    // A blocking tab is named by its table, never its id, and opens at the till.
    fireEvent.click(close.getByRole('button', { name: 'Table 4' }));
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ href: '/till?tab=tab-1' }));
    fireEvent.click(close.getByRole('button', { name: 'Go to Day close' }));
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ href: '/admin/day-close' }));

    cleanup();
    queue.rows = [];
    answers.ops_overview = { ...payload, dayClose: { ...payload.dayClose, blockingTabs: [] } };
    renderScreen();
    await ready();
    const clear = panel('before-close');
    expect(clear.getByText('Ready to close')).toBeTruthy();
    expect(clear.getByText('Every tab is settled')).toBeTruthy();
    expect(clear.getByText('This station has sent everything')).toBeTruthy();
  });

  it('opens each money line of today on the audit log filtered to it, counted in words', async () => {
    renderScreen();
    await ready();
    const today = panel('so-far-today');
    expect(rowText(today, 'Discounts')).toBe('Discounts2 times15,000 IQD');
    expect(rowText(today, 'Refunds')).toBe('RefundsOnce3,000 IQD');
    fireEvent.click(today.getByRole('button', { name: /Discounts/ }));
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ href: '/admin/audit?q=discount.apply' }));
    // No-shows and cancellations are facts about the day, in plain ink, opening nothing.
    expect(today.queryByRole('button', { name: /No-shows/ })).toBeNull();
    expect(rowText(today, 'Cancelled bookings')).toBe('Cancelled bookings2');
  });

  it('opens a stock figure on the list of exactly those items', async () => {
    renderScreen();
    await ready();
    fireEvent.click(panel('stock-watch').getByRole('button', { name: /Below the level you keep/ }));
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ href: '/stock?filter=belowPar' }));
  });

  it('prints a figure the server does not report as "—", never as zero', async () => {
    renderScreen();
    await ready();
    // payload carries no ticketsPreparing.
    expect(rowText(panel('floor-now'), 'Being made')).toBe('Being made—');
  });

  // A late order is also a waiting or preparing one, so the kitchen's figures
  // are listed and never added up; the late count is in "Needs you" alone.
  it('never totals the overlapping kitchen counts', async () => {
    answers.ops_overview = { ...payload, cafe: { openTabs: 8, ticketsQueued: 470, ticketsPreparing: 3, ticketsLate: 473, waiterCallsOpen: 0 } };
    renderScreen();
    await ready();
    const floor = panel('floor-now');
    expect(rowText(floor, 'Waiting')).toBe('Waiting470');
    expect(rowText(floor, 'Being made')).toBe('Being made3');
    expect(screen.queryByText('946')).toBeNull();
    expect(within(screen.getByTestId('need-ticketsLate')).getByText('473')).toBeTruthy();
  });

  it('shows three people in who worked today, and the rest on "View more"', async () => {
    const person = (n: number) => ({ staffId: `s${n}`, name: `Person ${n}`, role: 'cashier', ordersTaken: n, bookingsCreated: 0 });
    answers.ops_overview = { ...payload, staffActivity: [1, 2, 3, 4, 5].map(person) };
    renderScreen();
    await ready();
    const staff = panel('who-worked');
    expect(staff.getByText('Person 3')).toBeTruthy();
    expect(staff.queryByText('Person 4')).toBeNull();
    fireEvent.click(staff.getByRole('button', { name: 'View more (2)' }));
    expect(staff.getByText('Person 5')).toBeTruthy();
  });

  it('sends the owner to the Observe overview, which carries the floor now', async () => {
    who.role = 'owner';
    ws.active = 'owner';
    renderScreen();
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ to: '/observation', replace: true }));
    expect(screen.queryByRole('heading', { name: 'Today' })).toBeNull();
  });

  it('keeps the owner on Today inside the Operations workspace, whose home it is', async () => {
    who.role = 'owner';
    ws.active = 'manager';
    renderScreen();
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(nav.navigate).not.toHaveBeenCalledWith({ to: '/observation', replace: true });
  });

  it('renders the error state with a retry', async () => {
    answers.ops_overview = new Error('UNKNOWN');
    renderScreen();
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

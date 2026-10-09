import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';

// The customer record's open-match block (operator.md §5.15): the no-show
// count names its match part, "Plays as" says who set it and is changed in
// two choices, and the ban is a manager's (R35: a code and an optional note,
// sent as `<code>: <note>`; lifting sends no reason). A server before 0262
// (no gender, no matches) shows none of it.

const navigate = vi.fn();
let role = 'manager';

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'c1' }),
  useSearch: () => ({}),
  useNavigate: () => navigate,
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock('../../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 's1', displayName: 'Staff', role } }),
}));
vi.mock('../../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchVenueSettings: async () => ({ timezone: 'Asia/Baghdad' }),
  fetchActiveCourts: async () => [],
}));
vi.mock('../../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), err: vi.fn(), info: vi.fn() }) }));
vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));
vi.mock('../../../lib/idem', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deviceId: () => 'DESK-1',
}));
// The rail's branch is Karrada; Mansour is the other branch a lesson row may name.
vi.mock('../../../lib/venue', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useVenue: () => ({
    venues: [
      { id: 'v1', slug: 'karrada', name_en: 'Karrada', name_ar: 'الكرادة', status: 'open', timezone: 'Asia/Baghdad', phone: null, created_at: '' },
      { id: 'v2', slug: 'mansour', name_en: 'Mansour', name_ar: 'المنصور', status: 'open', timezone: 'Asia/Baghdad', phone: null, created_at: '' },
    ],
    branchId: 'v1',
    current: null,
    stationBranchId: null,
    canSwitch: false,
    setBranch: () => undefined,
  }),
}));

import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { CustomerRecordScreen } from './CustomerRecord';

const rpc = vi.mocked(appRpc);
const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '');
const missing = () => {
  throw new AppRpcError('RPC_MISSING', 'RPC_MISSING');
};
/** app.customer_lessons; a server without coaching by default (RPC_MISSING). */
let lessonsRead: () => unknown = missing;
let settleAnswer: () => unknown = () => ({ duplicate: false, payment_id: 'pay1', amount_iqd: 30000, change_iqd: 0 });

function record(over: Record<string, unknown> = {}, customer: Record<string, unknown> = {}) {
  return {
    customer: { id: 'c1', full_name: 'Sara Karim', phone: '+9647700000000', email: null, preferred_lang: 'ar', gender: 'female', gender_set_by: 'guest', ...customer },
    flags: [],
    counts: { bookings: 4, cancellations: 0, noShows: 3, cafeOrders: 0, matchesPlayed: 7, matchNoShows: 1, lateLeaves: 1 },
    upcoming: [],
    history: [],
    cafeOrders: [],
    notes: [],
    series: [],
    matches: [],
    ...over,
  };
}

let current: unknown = record();

function mount() {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === 'customer_record') return current;
    // The Tickets panel has its own test; here the server has no wallet read.
    if (fn === 'guest_tickets') throw new AppRpcError('RPC_MISSING', 'RPC_MISSING');
    if (fn === 'customer_lessons') return lessonsRead();
    if (fn === 'lesson_settle') return settleAnswer();
    return {};
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <CustomerRecordScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const calls = (fn: string) => rpc.mock.calls.filter(([name]) => name === fn);

beforeEach(() => {
  role = 'manager';
  current = record();
  lessonsRead = missing;
  settleAnswer = () => ({ duplicate: false, payment_id: 'pay1', amount_iqd: 30000, change_iqd: 0 });
  rpc.mockReset();
  navigate.mockReset();
  localStorage.clear();
});

describe('CustomerRecord ▸ open matches', () => {
  it('counts seat no-shows inside the no-show count, and shows matches played and late leaves', async () => {
    mount();
    expect(await screen.findByText('3 (open matches 1)')).toBeTruthy();
    expect(screen.getByText('Open matches played')).toBeTruthy();
    expect(screen.getByText('Late leaves')).toBeTruthy();
    expect(within(screen.getByTestId('customer-matches')).getByTestId('plays-as').textContent).toBe('Woman · set by the guest');
  });

  it('Change sends the other gender through staff_set_customer_gender', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Change' }));
    const dialog = within(await screen.findByRole('dialog'));
    const save = dialog.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    // The current choice is no change.
    expect(save.disabled).toBe(true);
    await user.click(dialog.getByText('Man'));
    await user.click(save);
    await waitFor(() => expect(calls('staff_set_customer_gender')).toHaveLength(1));
    expect(calls('staff_set_customer_gender')[0]![1]).toEqual({ p_customer_id: 'c1', p_gender: 'male' });
  });

  it('a manager bans with a code and an optional note, sent as `<code>: <note>`', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Ban from open matches' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/Applies at every branch/)).toBeTruthy();
    await user.click(dialog.getByText('Repeated no-shows'));
    await user.type(dialog.getByRole('textbox'), 'three in a month');
    await user.click(dialog.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(calls('set_match_ban')).toHaveLength(1));
    expect(calls('set_match_ban')[0]![1]).toEqual({ p_customer_id: 'c1', p_banned: true, p_reason: 'no_shows: three in a month' });
  });

  it('a banned customer: the badge, and Lift sends no reason', async () => {
    const user = userEvent.setup();
    current = record({ flags: [{ type: 'match_ban', label: 'reported' }] });
    mount();
    expect(await screen.findByText(/Banned from open matches/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Lift ban' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Lift ban' }));
    await waitFor(() => expect(calls('set_match_ban')).toHaveLength(1));
    expect(calls('set_match_ban')[0]![1]).toEqual({ p_customer_id: 'c1', p_banned: false, p_reason: null });
    // The desk's flag editor still counts no flags of its own.
    expect(screen.getByRole('button', { name: 'Add a flag' })).toBeTruthy();
  });

  it('court_desk runs matches but cannot ban', async () => {
    role = 'court_desk';
    mount();
    expect(await screen.findByTestId('customer-matches')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ban from open matches' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start an open match' })).toBeTruthy();
  });

  it('long lists show three, then View more reveals the rest in place (bookings, notes)', async () => {
    const user = userEvent.setup();
    const booking = (n: number) => ({ id: `b${n}`, court_id: 'k1', court_name_en: `Court ${n}`, court_name_ar: `ملعب ${n}`, start_at: `2026-10-1${n}T15:00:00Z`, end_at: `2026-10-1${n}T16:00:00Z`, status: 'confirmed', kind: 'booking', price_iqd: 30000 });
    const note = (n: number) => ({ id: `n${n}`, body: `Note number ${n}`, author_id: null, created_at: `2026-09-1${n}T10:00:00Z` });
    current = record({ upcoming: [1, 2, 3, 4, 5].map(booking), notes: [1, 2, 3, 4].map(note) });
    mount();
    const upcoming = within(await screen.findByRole('table', { name: 'Upcoming bookings' }));
    expect(upcoming.getAllByRole('row')).toHaveLength(3);
    const notes = within(screen.getByTestId('customer-notes'));
    expect(notes.getAllByText(/^Note number \d$/)).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'View more (2)' }));
    expect(upcoming.getAllByRole('row')).toHaveLength(5);
    await user.click(notes.getByRole('button', { name: 'View more (1)' }));
    expect(notes.getAllByText(/^Note number \d$/)).toHaveLength(4);
    await user.click(notes.getByRole('button', { name: 'Show less' }));
    expect(notes.getAllByText(/^Note number \d$/)).toHaveLength(3);
  });

  it('a server before 0262 shows no open-match block', async () => {
    const { matches: _gone, ...old } = record();
    current = { ...old, customer: { id: 'c1', full_name: 'Sara Karim', phone: null, email: null, preferred_lang: 'ar' } };
    mount();
    expect(await screen.findByText('Sara Karim', { selector: 'h1' })).toBeTruthy();
    expect(screen.queryByTestId('customer-matches')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start an open match' })).toBeNull();
  });
});

// Coaching (operator.md §5.15, §5.21; C-21, R20): the coach badge (not a flag),
// Make coach / Open in Coaches (manageCoaches), Book a lesson (runLessons), the
// counts, and the Lessons panel, where a cashier takes lesson money.

function lessonRow(over: Record<string, unknown> = {}) {
  return {
    enrolment_id: 'e1',
    lesson_id: 'L1',
    course_id: null,
    venue_id: 'v1',
    kind: 'private',
    start_at: '2026-10-05T15:00:00Z',
    end_at: '2026-10-05T16:00:00Z',
    status: 'scheduled',
    enrolment_status: 'booked',
    attendance: null,
    type_name_en: 'Private 60',
    type_name_ar: 'حصة خاصة 60',
    coach_name_en: 'Coach Sara',
    coach_name_ar: 'المدرّبة سارة',
    course_title_en: null,
    course_title_ar: null,
    payment_mode: 'desk',
    money: { owed_iqd: 30000, desk_paid_iqd: 0, online_paid_iqd: 0, refund_due_iqd: 0, take_iqd: 30000 },
    ...over,
  };
}

function lessons(over: Record<string, unknown> = {}) {
  return {
    coach: null,
    counts: { lessons: 5, no_shows: 1 },
    lesson_strikes_30d: 2,
    lessons: [
      lessonRow(),
      lessonRow({
        enrolment_id: 'e2',
        lesson_id: 'L2',
        venue_id: 'v2',
        kind: 'group',
        start_at: '2026-09-20T15:00:00Z',
        end_at: '2026-09-20T16:00:00Z',
        status: 'completed',
        attendance: 'attended',
        type_name_en: 'Evening group',
        money: { owed_iqd: 0, desk_paid_iqd: 15000, online_paid_iqd: 0, refund_due_iqd: 0, take_iqd: 0 },
      }),
    ],
    ...over,
  };
}

describe('CustomerRecord ▸ lessons', () => {
  it('a coach carries the coach badge (paused), and Open in Coaches opens their editor', async () => {
    const user = userEvent.setup();
    lessonsRead = () => lessons({ coach: { coach_id: 'k1', status: 'paused', display_name_en: 'Coach Sara', display_name_ar: 'سارة', venue_ids: ['v1'] } });
    mount();
    expect(await screen.findByText('Coach · paused')).toBeTruthy();
    // Not a customer flag: the flag editor still counts none.
    expect(screen.getByRole('button', { name: 'Add a flag' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open in Coaches' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/admin/coaches', search: { coach: 'k1' } });
    expect(screen.queryByRole('button', { name: 'Make coach' })).toBeNull();
  });

  it('not a coach: a manager makes one, and books a lesson', async () => {
    const user = userEvent.setup();
    lessonsRead = () => lessons();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Make coach' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/admin/coaches', search: { tab: 'coaches', promote: 'c1' } });
    await user.click(screen.getByRole('button', { name: 'Book a lesson' }));
    expect(navigate).toHaveBeenLastCalledWith({ to: '/desk', search: { customer: 'c1', kind: 'lesson' } });
  });

  it('the Lessons panel: counts, strikes, upcoming then recent; a row here opens its lesson, a row elsewhere names the branch', async () => {
    const user = userEvent.setup();
    lessonsRead = () => lessons();
    mount();
    const panel = within(await screen.findByTestId('customer-lessons'));
    expect(plain(panel.getByTestId('lesson-counts').textContent)).toBe('Lessons 5 · No-shows 1');
    expect(plain(panel.getByText(/Late cancels and no-shows in 30 days/).textContent)).toBe('Late cancels and no-shows in 30 days: 2');
    const upcoming = within(panel.getByRole('region', { name: 'Coming up' }));
    expect(upcoming.getByText('Private lesson')).toBeTruthy();
    expect(upcoming.getByText('Signed up')).toBeTruthy();
    expect(plain(upcoming.getByText(/To pay/).textContent)).toBe('To pay 30,000 IQD at the desk');
    await user.click(upcoming.getByRole('button', { name: 'Open lesson' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/desk/lessons/$id', params: { id: 'L1' } });
    const recent = within(panel.getByRole('region', { name: 'Recent' }));
    expect(plain(recent.getByText(/^At /).textContent)).toBe('At Mansour');
    expect(recent.getByText('Arrived')).toBeTruthy();
    expect(recent.queryByRole('button', { name: 'Open lesson' })).toBeNull();
    expect(recent.queryByRole('button', { name: 'Take payment' })).toBeNull();
  });

  it('the Lessons panel folds each group after three: View more reveals the rest of that group', async () => {
    const user = userEvent.setup();
    lessonsRead = () =>
      lessons({ lessons: [1, 2, 3, 4].map((n) => lessonRow({ enrolment_id: `e${n}`, lesson_id: `L${n}`, start_at: `2026-10-0${n + 4}T15:00:00Z`, end_at: `2026-10-0${n + 4}T16:00:00Z` })) });
    mount();
    const panel = within(await screen.findByTestId('customer-lessons'));
    const upcoming = within(panel.getByRole('region', { name: 'Coming up' }));
    expect(upcoming.getAllByRole('listitem')).toHaveLength(3);
    await user.click(upcoming.getByRole('button', { name: 'View more (1)' }));
    expect(upcoming.getAllByRole('listitem')).toHaveLength(4);
  });

  it('a cashier takes the lesson payment from the record (R20), and sees no coach or booking action', async () => {
    const user = userEvent.setup();
    role = 'cashier';
    lessonsRead = () => lessons();
    mount();
    const panel = within(await screen.findByTestId('customer-lessons'));
    expect(screen.queryByRole('button', { name: 'Make coach' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Book a lesson' })).toBeNull();
    // The cashier cannot open the lesson screen.
    expect(panel.queryByRole('button', { name: 'Open lesson' })).toBeNull();
    await user.click(panel.getByRole('button', { name: 'Take payment' }));
    const pane = await screen.findByRole('dialog', { name: 'Cash' });
    expect(plain(pane.textContent)).toContain("Sara Karim's lesson");
    await user.type(within(pane).getByRole('textbox', { name: /Tendered/ }), '30000');
    await user.click(within(pane).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(calls('lesson_settle')).toHaveLength(1));
    expect(calls('lesson_settle')[0]![1]).toMatchObject({
      p_enrolment_id: 'e1',
      p_method: 'cash',
      p_expected_owed_iqd: 30000,
      p_tendered_iqd: 30000,
      p_device_id: 'DESK-1',
    });
  });

  it('a server without coaching (RPC_MISSING) shows none of it', async () => {
    mount();
    expect(await screen.findByText('Sara Karim', { selector: 'h1' })).toBeTruthy();
    await waitFor(() => expect(calls('customer_lessons')).toHaveLength(1));
    expect(screen.queryByTestId('customer-lessons')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make coach' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Book a lesson' })).toBeNull();
  });
});

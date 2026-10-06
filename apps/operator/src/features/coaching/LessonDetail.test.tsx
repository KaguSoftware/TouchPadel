import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// The lesson screen (operator.md §5.10): every banner of §5.10.2 (coach_retired
// included), the course strip, not found, a held lesson's Reschedule and Move
// court disabled with the reason, the C-24 flag, `?pay=` opening Take payment,
// `?customer=` opening Add student, Cancel lesson's reason form, the history,
// and a manager's refunds due. Reads and writes are mocked at appRpc; the role
// at useAuth so the capabilities run for real.

const navigate = vi.fn();
const toast = { ok: vi.fn(), err: vi.fn(), info: vi.fn() };
let search: Record<string, string> = {};
let role = 'court_desk';
let reachable = true;

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: { children: ReactNode; 'aria-current'?: 'page' }) => (
    <a href="#link" aria-current={rest['aria-current']}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
  useParams: () => ({ id: 'l1' }),
  useSearch: () => search,
}));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/realtime', () => ({ useBroadcast: vi.fn() }));
vi.mock('../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchVenueSettings: vi.fn(async () => ({
    timezone: 'Asia/Baghdad',
    opening_hours: null,
    closed_dates: [],
  })),
}));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));
vi.mock('../../lib/idem', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deviceId: () => 'DESK-1',
}));
vi.mock('../../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ staff: { role } }) };
});
vi.mock('../../lib/stationReach', () => ({ useStationReach: () => ({ reachable }) }));
vi.mock('../../components/toast', () => ({ useToast: () => toast }));
// Move court reads the lesson's night: three courts, one row on Court 2 overlapping the lesson.
const night = vi.hoisted(() => ({
  courts: [
    {
      id: 'c1',
      name_en: 'Indoor Court 1',
      name_ar: 'الملعب الداخلي 1',
      duration_options: [60],
      sort_order: 1,
    },
    { id: 'c2', name_en: 'Court 2', name_ar: 'الملعب 2', duration_options: [60], sort_order: 2 },
    { id: 'c3', name_en: 'Court 3', name_ar: 'الملعب 3', duration_options: [60], sort_order: 3 },
  ],
  reservations: [
    {
      id: 'r1',
      court_id: 'c1',
      status: 'confirmed',
      start_at: '2026-10-01T15:00:00.000Z',
      end_at: '2026-10-01T16:00:00.000Z',
    },
    {
      id: 'r2',
      court_id: 'c2',
      status: 'confirmed',
      start_at: '2026-10-01T15:30:00.000Z',
      end_at: '2026-10-01T17:00:00.000Z',
    },
  ],
}));
vi.mock('../desk/useTradingNight', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTradingNight: () => ({
    courts: night.courts,
    reservations: night.reservations,
    courtsQ: { isPending: false },
    reservationsQ: { isPending: false, refetch: () => Promise.resolve() },
  }),
}));

import { LocaleProvider } from '../../lib/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { LessonDetailScreen } from './LessonDetail';

const rpc = vi.mocked(appRpc);
type Raw = Record<string, unknown>;
/** Visible text without the bidi isolates `isolate` / `isolateLtr` wrap names and counts in. */
const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '');

// 18:00–19:00 at the branch; the server reads 15:00.
const START = '2026-10-01T15:00:00.000Z';
const END = '2026-10-01T16:00:00.000Z';
const NOW = '2026-10-01T12:00:00.000Z';

const MONEY = {
  price_iqd: 15000,
  owed_iqd: 15000,
  desk_paid_iqd: 0,
  online_paid_iqd: 0,
  refunded_iqd: 0,
  kept_iqd: 0,
  refund_due_iqd: 0,
  take_iqd: 15000,
};

function rawEnrolment(over: Raw = {}): Raw {
  return {
    enrolment_id: 'e1',
    scope: 'lesson',
    status: 'booked',
    cancel_kind: null,
    cancelled_at: null,
    customer_id: 'g1',
    full_name: 'Ali Hasan',
    phone: '0770 123 4567',
    typed: false,
    flags: [],
    party_size: 1,
    friend_names: [],
    first_session_no: null,
    sessions_covered: null,
    booked_by_kind: 'guest',
    booked_by_name: null,
    payment_mode: 'desk',
    created_at: null,
    attendance: null,
    money: { ...MONEY },
    can: {
      take_payment: true,
      cancel: true,
      mark_attended: false,
      mark_no_show: false,
      unmark: false,
    },
    ...over,
  };
}

function rawSession(no: number, over: Raw = {}): Raw {
  const start = Date.parse(START) + (no - 2) * 7 * 86_400_000;
  return {
    lesson_id: no === 2 ? 'l1' : `s${no}`,
    session_no: no,
    start_at: new Date(start).toISOString(),
    end_at: new Date(start + 3_600_000).toISOString(),
    status: no === 1 ? 'completed' : 'scheduled',
    court_name_en: 'Court 1',
    court_name_ar: 'الملعب 1',
    ...over,
  };
}

function rawDetail(
  lesson: Raw = {},
  enrolments: Raw[] = [rawEnrolment()],
  events: Raw[] = [],
): Raw {
  return {
    lesson: {
      id: 'l1',
      venue_id: 'v1',
      kind: 'group',
      status: 'scheduled',
      cancel_reason: null,
      start_at: START,
      end_at: END,
      duration_min: 60,
      rescheduled_at: null,
      booked_by_kind: 'staff',
      coach: {
        coach_id: 'k1',
        display_name_en: 'Coach Sara',
        display_name_ar: 'المدرّبة سارة',
        status: 'active',
      },
      lesson_type: { lesson_type_id: 't1', name_en: 'Beginners', name_ar: 'مبتدئين' },
      course: null,
      reservation_id: 'r1',
      reservation_status: 'confirmed',
      court_id: 'c1',
      court_name_en: 'Indoor Court 1',
      court_name_ar: 'الملعب الداخلي 1',
      price_iqd: 15000,
      court_share_iqd: 5000,
      max_places: 6,
      min_places: 1,
      places_taken: 3,
      cutoff_at: '2026-10-01T13:00:00.000Z',
      hold_expires_at: null,
      created_by_name: 'Desk Ali',
      server_now: NOW,
      day_open: true,
      can: {
        add_student: true,
        cancel: true,
        cancel_course: false,
        reschedule: true,
        move_court: true,
      },
      ...lesson,
    },
    enrolments,
    events,
  };
}

let raw: Raw | Error;
let refunds: Raw;
let customer: Raw | null;
const calls: { fn: string; args: Record<string, unknown> }[] = [];

beforeEach(() => {
  search = {};
  role = 'court_desk';
  reachable = true;
  customer = null;
  refunds = { venue_id: 'v1', total_iqd: 0, items: [] };
  calls.length = 0;
  localStorage.clear();
  navigate.mockClear();
  for (const f of Object.values(toast)) f.mockClear();
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    if (fn === 'desk_lesson_detail') {
      if (raw instanceof Error) throw raw;
      return structuredClone(raw);
    }
    if (fn === 'lesson_refunds_due') return structuredClone(refunds);
    if (fn === 'customer_record') return customer;
    if (fn === 'desk_cancel_lesson') return { lesson_id: 'l1', status: 'cancelled' };
    if (fn === 'desk_cancel_course')
      return { course_id: 'co1', status: 'cancelled', sessions_cancelled: 3 };
    return {};
  });
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <LessonDetailScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

/** The screen has loaded once its header title is there. */
async function loaded() {
  await screen.findByRole('heading', { level: 1, name: /Beginners|Autumn course/ });
}

describe('LessonDetailScreen: the header (§5.10.1)', () => {
  it('a group session: kind, title, court, time, badges, places and the actions', async () => {
    raw = rawDetail();
    mount();
    await loaded();
    expect(plain(screen.getByRole('heading', { level: 1 }).textContent)).toBe(
      'Beginners · Coach Sara',
    );
    expect(screen.getAllByText('Group session').length).toBeGreaterThan(0);
    expect(screen.getByText('Indoor Court 1')).toBeTruthy();
    expect(screen.getByText('Booked')).toBeTruthy();
    expect(screen.getAllByText('Places 3 of 6').length).toBeGreaterThan(0);
    for (const name of ['See on calendar', 'Move court', 'Reschedule', 'Cancel lesson']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: 'Cancel the course' })).toBeNull();
  });

  it('See on calendar opens the desk on the lesson’s night', async () => {
    const user = userEvent.setup();
    raw = rawDetail();
    mount();
    await loaded();
    await user.click(screen.getByRole('button', { name: 'See on calendar' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/desk', search: { date: '2026-10-01' } });
  });

  it('a held lesson shows Reschedule and Move court disabled, saying it waits for the guest’s payment (R32)', async () => {
    raw = rawDetail({
      kind: 'private',
      status: 'held',
      hold_expires_at: '2026-10-01T12:10:00.000Z',
      can: {
        add_student: false,
        cancel: true,
        cancel_course: false,
        reschedule: false,
        move_court: false,
      },
    });
    mount();
    await screen.findByText(/^Awaiting the guest's online payment until /);
    for (const name of ['Reschedule', 'Move court']) {
      const b = screen.getByRole('button', { name }) as HTMLButtonElement;
      expect(b.disabled).toBe(true);
      expect(b.title).toBe("Waiting for the guest's online payment: it can be moved once paid.");
    }
  });

  it('C-24: a private lesson the coach booked and still unpaid is flagged', async () => {
    raw = rawDetail({
      kind: 'private',
      booked_by_kind: 'coach',
      places_taken: null,
      max_places: 1,
    });
    mount();
    expect(await screen.findByText('Booked by the coach · unpaid')).toBeTruthy();
  });

  it('offline: every write in the header needs a connection; See on calendar still works', async () => {
    reachable = false;
    raw = rawDetail();
    mount();
    await loaded();
    for (const name of ['Move court', 'Reschedule', 'Cancel lesson']) {
      const b = screen.getByRole('button', { name }) as HTMLButtonElement;
      expect(b.disabled).toBe(true);
      expect(b.title).toBe('Needs a connection: lessons work online only');
    }
    expect(
      (screen.getByRole('button', { name: 'See on calendar' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe('LessonDetailScreen: the banner (§5.10.2)', () => {
  it.each([
    [{ status: 'scheduled' }, 'Booked on Indoor Court 1'],
    [
      { status: 'scheduled', min_places: 5 },
      /^Needs 2 more by .+, or it is cancelled and everyone is refunded\.$/,
    ],
    [{ status: 'completed' }, 'Done'],
    [{ status: 'cancelled', cancel_reason: 'guest_cancel' }, 'Cancelled by the guest.'],
    [
      { status: 'cancelled', cancel_reason: 'coach_cancel' },
      'Cancelled by the coach. Everyone was told and online money refunded.',
    ],
    [
      { status: 'cancelled', cancel_reason: 'staff_cancel' },
      'Cancelled at the desk. Everyone was told and online money refunded.',
    ],
    [
      { status: 'cancelled', cancel_reason: 'under_filled' },
      'Cancelled at the cut-off: too few students. Everyone was refunded.',
    ],
    [
      { status: 'cancelled', cancel_reason: 'payment_expired' },
      "The guest's online payment didn't arrive in time.",
    ],
    [{ status: 'cancelled', cancel_reason: 'account_deleted' }, 'The guest deleted their account.'],
    [
      { status: 'cancelled', cancel_reason: 'coach_retired' },
      'Cancelled because the coach was retired. Everyone was told and online money refunded.',
    ],
    [{ status: 'expired' }, 'Never confirmed.'],
    [{ status: 'archived' }, 'archived'],
  ])('%o', async (over, text) => {
    raw = rawDetail({
      ...over,
      can: {
        add_student: false,
        cancel: false,
        cancel_course: false,
        reschedule: false,
        move_court: false,
      },
    });
    mount();
    await loaded();
    const statuses = screen.getAllByRole('status').map((n) => plain(n.textContent));
    expect(statuses.some((s) => (typeof text === 'string' ? s === text : text.test(s)))).toBe(true);
  });

  it('desk money waiting to go back adds its line', async () => {
    raw = rawDetail({ status: 'cancelled', cancel_reason: 'staff_cancel' }, [
      rawEnrolment({
        status: 'cancelled',
        money: {
          ...MONEY,
          desk_paid_iqd: 15000,
          take_iqd: 0,
          refund_due_iqd: 15000,
          refund_due_desk_iqd: 15000,
        },
      }),
    ]);
    mount();
    expect(
      await screen.findByText('Money paid at the desk is waiting for a refund: 15,000 IQD.'),
    ).toBeTruthy();
  });

  it('online money blocked on Qi is its own line, never "paid at the desk" (OP-14, DB-31)', async () => {
    raw = rawDetail({ status: 'cancelled', cancel_reason: 'staff_cancel' }, [
      rawEnrolment({
        status: 'cancelled',
        money: {
          ...MONEY,
          online_paid_iqd: 10000,
          take_iqd: 0,
          refund_due_iqd: 10000,
          refund_due_desk_iqd: 0,
          refund_blocked_iqd: 10000,
        },
      }),
    ]);
    mount();
    expect(await screen.findByText('Online refund needs attention: 10,000 IQD.')).toBeTruthy();
    expect(screen.queryByText(/Money paid at the desk is waiting/)).toBeNull();
  });
});

describe('LessonDetailScreen: a course session (§5.10.3)', () => {
  const course = (over: Raw = {}): Raw => ({
    course_id: 'co1',
    title_en: 'Autumn course',
    title_ar: '',
    status: 'running',
    cancel_reason: null,
    session_no: 2,
    sessions_count: 4,
    signup_closes_at: rawSession(4).start_at,
    places_taken: 4,
    max_places: 8,
    sessions: [
      rawSession(1),
      rawSession(2),
      rawSession(3, { start_at: '2026-10-09T16:30:00.000Z', end_at: '2026-10-09T17:30:00.000Z' }),
      rawSession(4),
    ],
    ...over,
  });

  it('the eyebrow, the title, the strip with this session pressed, a moved session’s new time and the sign-up line', async () => {
    raw = rawDetail({
      kind: 'course',
      course: course(),
      can: {
        add_student: true,
        cancel: false,
        cancel_course: true,
        reschedule: true,
        move_court: true,
      },
    });
    mount();
    await loaded();
    expect(screen.getByText('Course · Session 2 of 4')).toBeTruthy();
    expect(plain(screen.getByRole('heading', { level: 1 }).textContent)).toBe(
      'Autumn course · Coach Sara',
    );
    const strip = screen.getByTestId('course-strip');
    const chips = within(strip).getAllByRole('link');
    expect(chips).toHaveLength(4);
    expect(chips[1]!.getAttribute('aria-current')).toBe('page');
    expect(plain(chips[1]!.textContent)).toMatch(/^2 · Thu 1 Oct · 6:00\sPM$/);
    // Session 3 was rescheduled: it reads its own new time.
    expect(plain(chips[2]!.textContent)).toMatch(/^3 · Fri 9 Oct · 7:30\sPM$/);
    // Session 1 is over and says so.
    expect(within(chips[0]!).getByText('Done')).toBeTruthy();
    expect(within(strip).getByText(/^Sign-up closes when the last session starts \(/)).toBeTruthy();
    // The header and the roster's footer both say the course's places.
    expect(screen.getAllByText('Places 4 of 8').length).toBe(2);
    // A course is cancelled as one: never a session alone (C-19).
    expect(screen.getByRole('button', { name: 'Cancel the course' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel lesson' })).toBeNull();
  });

  it('Cancel the course says what happens and sends the reason form', async () => {
    const user = userEvent.setup();
    raw = rawDetail({
      kind: 'course',
      course: course(),
      can: {
        add_student: true,
        cancel: false,
        cancel_course: true,
        reschedule: true,
        move_court: true,
      },
    });
    mount();
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Cancel the course' }));
    const prompt = await screen.findByRole('dialog');
    expect(
      within(prompt).getByText(/^Cancels the sessions still to come for everyone signed up\./),
    ).toBeTruthy();
    expect(within(prompt).getByText('Coach unavailable')).toBeTruthy();
    await user.click(within(prompt).getByText('Coach unavailable'));
    await user.click(within(prompt).getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(calls.find((c) => c.fn === 'desk_cancel_course')?.args).toEqual({
        p_course_id: 'co1',
        p_reason: 'coach_unavailable',
      }),
    );
    await waitFor(() => expect(toast.ok).toHaveBeenCalled());
    expect(plain(toast.ok.mock.calls[0]![0] as string)).toBe('Course cancelled (3 sessions).');
  });
});

describe('LessonDetailScreen: not found, cancel, history, hand-backs', () => {
  it('LESSON_NOT_FOUND says the lesson is not at this branch, with a way back to Today', async () => {
    const user = userEvent.setup();
    raw = new AppRpcError('LESSON_NOT_FOUND', 'LESSON_NOT_FOUND');
    mount();
    expect(await screen.findByText("That lesson isn't at this branch.")).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back to Today' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/desk/today' });
  });

  it('a server without coaching (RPC_MISSING) reads the same, never "offline"', async () => {
    raw = new AppRpcError('RPC_MISSING', 'PGRST202');
    mount();
    expect(await screen.findByText("That lesson isn't at this branch.")).toBeTruthy();
    expect(screen.queryByText("Lessons can't be shown without a connection")).toBeNull();
  });

  it('a read that fails says so, with Retry', async () => {
    raw = new TypeError('Failed to fetch');
    mount();
    expect(await screen.findByText("Lessons can't be shown without a connection")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('Cancel lesson names who is told and sends `<code>: <note>`', async () => {
    const user = userEvent.setup();
    raw = rawDetail({}, [rawEnrolment(), rawEnrolment({ enrolment_id: 'e2', full_name: 'Omar' })]);
    mount();
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Cancel lesson' }));
    const prompt = await screen.findByRole('dialog');
    expect(plain(within(prompt).getByText(/^Cancels the lesson for/).textContent)).toBe(
      'Cancels the lesson for 2 students, releases the court and tells everyone. Online money goes back; desk money becomes a refund due.',
    );
    await user.type(within(prompt).getByLabelText(/note/i), 'Rain');
    await user.click(within(prompt).getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(calls.find((c) => c.fn === 'desk_cancel_lesson')?.args).toEqual({
        p_lesson_id: 'l1',
        p_reason: 'customer_request: Rain',
      }),
    );
    expect(toast.ok).toHaveBeenCalledWith('Lesson cancelled.');
  });

  it('a refusal stays in the prompt with its detail line', async () => {
    const user = userEvent.setup();
    raw = rawDetail();
    rpc.mockImplementation(async (fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args });
      if (fn === 'desk_lesson_detail') return structuredClone(raw as Raw);
      if (fn === 'desk_cancel_lesson')
        throw new AppRpcError(
          'LESSON_NOT_CANCELLABLE',
          'LESSON_NOT_CANCELLABLE',
          undefined,
          'started',
        );
      return {};
    });
    mount();
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Cancel lesson' }));
    const prompt = await screen.findByRole('dialog');
    await user.click(within(prompt).getByRole('button', { name: 'Continue' }));
    expect(await within(prompt).findByText('This lesson has started.')).toBeTruthy();
  });

  it('the history: one sentence per event with its actor; system events read "automatic"', async () => {
    raw = rawDetail(
      {},
      [rawEnrolment()],
      [
        {
          at: '2026-10-01T11:00:00.000Z',
          type: 'added',
          actor: 'u1',
          actor_name: 'Desk Ali',
          enrolment_id: 'e1',
          code: null,
          late: false,
        },
        {
          at: '2026-10-01T10:00:00.000Z',
          type: 'under_filled',
          actor: 'system',
          actor_name: null,
          enrolment_id: null,
          code: null,
          late: true,
        },
        {
          at: '2026-10-01T09:00:00.000Z',
          type: 'cancelled',
          actor: 'u1',
          actor_name: 'Desk Ali',
          enrolment_id: null,
          code: 'staff_error: typo',
          late: false,
        },
      ],
    );
    mount();
    await loaded();
    expect(plain(screen.getByText(/^Student added/).textContent)).toBe('Student added · Desk Ali');
    expect(
      screen.getByText('Cut-off checked too late: nothing was cancelled · automatic'),
    ).toBeTruthy();
    expect(plain(screen.getByText(/^Lesson cancelled \(/).textContent)).toBe(
      'Lesson cancelled (Staff error) · Desk Ali',
    );
  });

  it('?pay= opens Take payment on that sign-up at take_iqd, no part payment', async () => {
    search = { pay: 'e1' };
    raw = rawDetail();
    mount();
    const pane = await screen.findByRole('dialog', { name: 'Cash' });
    expect(plain(pane.textContent)).toContain("Ali Hasan's lesson");
    expect(within(pane).getAllByText('15,000 IQD').length).toBeGreaterThan(0);
    expect(within(pane).queryByText('Part payment')).toBeNull();
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '/desk/lessons/$id', replace: true }),
    );
  });

  it('?customer= opens Add student with that customer picked', async () => {
    search = { customer: 'c9' };
    customer = {
      customer: {
        id: 'c9',
        full_name: 'Noor Salem',
        phone: null,
        email: null,
        preferred_lang: 'ar',
      },
      flags: [],
    };
    raw = rawDetail();
    mount();
    const dialog = await screen.findByRole('dialog', { name: 'Add student' });
    await waitFor(() => expect(within(dialog).getByText(/Noor Salem/)).toBeTruthy());
  });
});

describe('LessonDetailScreen: Reschedule and Move court (§5.10.9)', () => {
  it('Reschedule offers 30-minute starts after now, mirrors the cut-off (R47) and sends the new start', async () => {
    const user = userEvent.setup();
    raw = rawDetail();
    mount();
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Reschedule' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reschedule' });
    expect(within(dialog).getByText(/The cut-off moves with it\./)).toBeTruthy();
    const submit = () =>
      within(dialog).getByRole('button', { name: 'Reschedule' }) as HTMLButtonElement;
    expect(submit().title).toBe('Pick a start time.');
    // 16:00 at the branch: its cut-off (two hours before) would be 14:00, already past at 15:00.
    await user.click(within(dialog).getByRole('combobox', { name: 'Start' }));
    await user.click(await screen.findByRole('option', { name: /^4:00\sPM$/ }));
    expect(submit().disabled).toBe(true);
    expect(
      within(dialog).getAllByText(
        /^That start is too close: its cut-off \(2:00\sPM\) has already passed\./,
      ).length,
    ).toBeGreaterThan(0);
    // 19:00 is fine: the cut-off moves to 17:00.
    await user.click(within(dialog).getByRole('combobox', { name: 'Start' }));
    await user.click(await screen.findByRole('option', { name: /^7:00\sPM$/ }));
    expect(within(dialog).getByText(/^New cut-off: 5:00\sPM$/)).toBeTruthy();
    expect(within(dialog).getByText(/^Ends 8:00\sPM: the length stays 60 min\.$/)).toBeTruthy();
    await user.click(submit());
    await waitFor(() =>
      expect(calls.find((c) => c.fn === 'desk_reschedule_session')?.args).toEqual({
        p_lesson_id: 'l1',
        p_start_at: '2026-10-01T16:00:00.000Z',
      }),
    );
    await waitFor(() => expect(toast.ok).toHaveBeenCalled());
  });

  it('a refusal stays in the Reschedule dialog with its detail line', async () => {
    const user = userEvent.setup();
    raw = rawDetail();
    rpc.mockImplementation(async (fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args });
      if (fn === 'desk_lesson_detail') return structuredClone(raw as Raw);
      if (fn === 'desk_reschedule_session')
        throw new AppRpcError('SESSION_NOT_MOVABLE', 'SESSION_NOT_MOVABLE', undefined, 'order');
      return {};
    });
    mount();
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Reschedule' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reschedule' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Start' }));
    await user.click(await screen.findByRole('option', { name: /^8:00\sPM$/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Reschedule' }));
    expect(
      await within(dialog).findByText(
        'A course session has to stay between the sessions before and after it.',
      ),
    ).toBeTruthy();
  });

  it('Move court lists the night’s courts: the current one and a taken one disabled, a free one sent (R7)', async () => {
    const user = userEvent.setup();
    raw = rawDetail();
    mount();
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Move court' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move court' });
    expect(
      within(dialog).getByText('Same time, another court. Students are told the new court.'),
    ).toBeTruthy();
    const radios = within(dialog).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => [plain(r.closest('label')!.textContent), r.disabled])).toEqual([
      ['Indoor Court 1 · now', true],
      ['Court 2 · taken', true],
      ['Court 3', false],
    ]);
    await user.click(within(dialog).getByText('Court 3'));
    await user.click(within(dialog).getByRole('button', { name: 'Move court' }));
    await waitFor(() =>
      expect(calls.find((c) => c.fn === 'desk_move_lesson_court')?.args).toEqual({
        p_lesson_id: 'l1',
        p_court_id: 'c3',
      }),
    );
    await waitFor(() => expect(toast.ok).toHaveBeenCalled());
    expect(plain(toast.ok.mock.calls[0]![0] as string)).toBe('Moved to Court 3.');
  });
});

describe('LessonDetailScreen: refunds due for a manager (§5.10.10)', () => {
  const item = (over: Raw = {}): Raw => ({
    enrolment_id: 'e9',
    lesson_id: 'l1',
    course_id: null,
    kind: 'group',
    coach_id: 'k1',
    coach_name_en: 'Coach Sara',
    coach_name_ar: 'المدرّبة سارة',
    type_name_en: 'Beginners',
    type_name_ar: 'مبتدئين',
    start_at: START,
    label: 'Omar Khalid',
    phone: '0771',
    cancel_kind: 'staff',
    cancelled_at: null,
    refund_due_iqd: 15000,
    refund_due_desk_iqd: 15000,
    online_blocked_iqd: 0,
    payments: [
      {
        payment_id: 'p1',
        tab_id: 't1',
        method: 'cash',
        amount_iqd: 15000,
        refunded_iqd: 0,
        refundable_iqd: 15000,
        created_at: null,
      },
    ],
    ...over,
  });

  it('this lesson’s items, one line per payment with Refund; another lesson’s are left out', async () => {
    role = 'manager';
    refunds = {
      venue_id: 'v1',
      total_iqd: 30000,
      items: [item(), item({ enrolment_id: 'e8', lesson_id: 'other', label: 'Someone Else' })],
    };
    raw = rawDetail();
    mount();
    const panel = await screen.findByTestId('lesson-refunds-due');
    expect(within(panel).getByText('Refunds due at the desk')).toBeTruthy();
    expect(plain(within(panel).getByText(/Omar Khalid/).textContent)).toBe(
      'Omar Khalid · paid 15,000 IQD by cash · 0 IQD refunded · 15,000 IQD due',
    );
    expect(within(panel).queryByText(/Someone Else/)).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Refund' })).toBeTruthy();
  });

  it('the desk never sees it (court_desk has no refund)', async () => {
    refunds = { venue_id: 'v1', total_iqd: 15000, items: [item()] };
    raw = rawDetail();
    mount();
    await loaded();
    expect(screen.queryByTestId('lesson-refunds-due')).toBeNull();
    expect(calls.some((c) => c.fn === 'lesson_refunds_due')).toBe(false);
  });
});

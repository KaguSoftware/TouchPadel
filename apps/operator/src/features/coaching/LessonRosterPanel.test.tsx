import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// The roster over a real query client (operator.md §5.10.4–§5.10.8, §5.21).
// Reads and writes are mocked at appRpc; app.desk_lesson_detail answers from
// `raw`, which a test changes to play the server's next answer. The role is
// mocked at useAuth so the capabilities run for real, and the station's reach
// at useStationReach.

let role = 'court_desk';
let reachable = true;
const toast = { ok: vi.fn(), err: vi.fn(), info: vi.fn() };

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#customer">{children}</a>,
  useNavigate: () => vi.fn(),
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

import { LocaleProvider, useLocale } from '../../lib/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { LessonRosterPanel } from './LessonRosterPanel';

const rpc = vi.mocked(appRpc);
type Raw = Record<string, unknown>;
/** Visible text without the bidi isolates `isolate` / `isolateLtr` wrap names and counts in. */
const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '');

// 18:00–19:00 at the branch.
const START = '2026-10-01T15:00:00.000Z';
const END = '2026-10-01T16:00:00.000Z';
const BEFORE = '2026-10-01T12:00:00.000Z';
const AFTER = '2026-10-01T15:20:00.000Z';

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
const NO_CAN = {
  take_payment: false,
  cancel: false,
  mark_attended: false,
  mark_no_show: false,
  unmark: false,
};

function rawEnrolment(id: string, over: Raw = {}): Raw {
  return {
    enrolment_id: id,
    scope: 'lesson',
    status: 'booked',
    cancel_kind: null,
    cancelled_at: null,
    customer_id: `g-${id}`,
    full_name: `Student ${id}`,
    phone: null,
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
    can: { ...NO_CAN },
    ...over,
  };
}

function rawDetail(lesson: Raw, enrolments: Raw[]): Raw {
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
      cutoff_at: null,
      hold_expires_at: null,
      created_by_name: 'Desk Ali',
      server_now: AFTER,
      day_open: true,
      can: {
        add_student: true,
        cancel: true,
        cancel_course: false,
        reschedule: false,
        move_court: true,
      },
      ...lesson,
    },
    enrolments,
    events: [],
  };
}

let raw: Raw;
let handlers: Record<string, (args: Record<string, unknown>) => unknown>;
const calls: { fn: string; args: Record<string, unknown> }[] = [];

beforeEach(() => {
  role = 'court_desk';
  reachable = true;
  localStorage.clear();
  calls.length = 0;
  handlers = {};
  for (const f of Object.values(toast)) f.mockClear();
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    if (fn === 'desk_lesson_detail') return structuredClone(raw);
    const h = handlers[fn];
    return h ? h(args) : {};
  });
});

function Dir({ children }: { children: ReactNode }) {
  const { dir } = useLocale();
  return <div dir={dir}>{children}</div>;
}

async function mount(props: { openPayFor?: string; onPayOpened?: () => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <Dir>
          <LessonRosterPanel lessonId="l1" {...props} />
        </Dir>
      </LocaleProvider>
    </QueryClientProvider>,
  );
  await screen.findByTestId('lesson-roster');
  // Past the loading skeleton: the read has answered.
  await waitFor(() => expect(document.querySelector('.tp-skel')).toBeNull());
  return view;
}

const row = (id: string) => screen.getByTestId(`enrolment-${id}`);
const button = (scope: HTMLElement, name: string | RegExp) =>
  within(scope).getByRole('button', { name }) as HTMLButtonElement;

describe('LessonRosterPanel: rows and money lines (§5.10.4)', () => {
  it('names, who booked, money lines, the footer’s places and what is still to pay', async () => {
    raw = rawDetail({}, [
      rawEnrolment('e1', {
        phone: '0770 123 4567',
        can: { ...NO_CAN, take_payment: true, cancel: true },
      }),
      rawEnrolment('e2', {
        payment_mode: 'online',
        booked_by_kind: 'guest',
        money: { ...MONEY, online_paid_iqd: 15000, take_iqd: 0 },
      }),
      rawEnrolment('e3', {
        booked_by_kind: 'staff',
        booked_by_name: 'Desk Ali',
        customer_id: null,
        full_name: 'Bravo',
        money: { ...MONEY, desk_paid_iqd: 15000, take_iqd: 0 },
      }),
    ]);
    await mount();
    expect(within(row('e1')).getByText('Student e1')).toBeTruthy();
    expect(within(row('e1')).getByText('0770 123 4567').getAttribute('dir')).toBe('ltr');
    expect(within(row('e1')).getByText('Booked in the app')).toBeTruthy();
    expect(within(row('e1')).getByText('To pay 15,000 IQD at the desk')).toBeTruthy();
    expect(within(row('e2')).getByText('Paid online 15,000 IQD')).toBeTruthy();
    expect(plain(within(row('e3')).getByText(/^Added at the desk by/).textContent)).toBe(
      'Added at the desk by Desk Ali',
    );
    expect(within(row('e3')).getByText('Paid at the desk 15,000 IQD')).toBeTruthy();
    // No customer behind the row: a walk-in, with no Open customer.
    expect(within(row('e3')).getByText('Walk-in')).toBeTruthy();
    expect(within(row('e3')).queryByText('Open customer')).toBeNull();
    // An online sign-up never offers Take payment.
    expect(within(row('e2')).queryByRole('button', { name: 'Take payment' })).toBeNull();
    const panel = screen.getByTestId('lesson-roster');
    expect(within(panel).getByText('Places 3 of 6')).toBeTruthy();
    expect(within(panel).getByText(/^To pay 1 · /).textContent).toBe('To pay 1 · 15,000 IQD');
    expect(button(panel, 'Add student').disabled).toBe(false);
  });

  it('a desk-typed row shows the typed name even when linked, with Open customer (C-21, R44)', async () => {
    raw = rawDetail({}, [
      rawEnrolment('e1', {
        typed: true,
        customer_id: 'g9',
        full_name: 'Typed Name',
        booked_by_kind: 'staff',
      }),
    ]);
    await mount();
    expect(within(row('e1')).getByText('Typed Name')).toBeTruthy();
    expect(within(row('e1')).getByText('Open customer')).toBeTruthy();
  });

  it('an unconfirmed phone match reads as typed, with no Open customer (C-21)', async () => {
    raw = rawDetail({}, [
      rawEnrolment('e1', {
        typed: true,
        customer_id: null,
        full_name: 'Omar',
        booked_by_kind: 'coach',
      }),
    ]);
    await mount();
    expect(within(row('e1')).getByText('Omar')).toBeTruthy();
    expect(within(row('e1')).getByText('Added by the coach')).toBeTruthy();
    expect(within(row('e1')).queryByText('Open customer')).toBeNull();
  });

  it('a private booker with a party, and the friends’ names', async () => {
    raw = rawDetail({ kind: 'private', places_taken: null, max_places: null }, [
      rawEnrolment('e1', { party_size: 3, friend_names: ['Huda', 'Zaid'] }),
    ]);
    await mount();
    expect(
      plain(
        within(row('e1'))
          .getByText(/^Student e1/)
          .closest('strong')!.textContent,
      ),
    ).toBe('Student e1 +2');
    expect(plain(within(row('e1')).getByText(/^With /).textContent)).toBe('With Huda, Zaid');
  });

  it('a course sign-up: its sessions and a late join; leaving a running course keeps the next session (C-23)', async () => {
    raw = rawDetail(
      {
        kind: 'course',
        course: {
          course_id: 'co1',
          title_en: 'Autumn',
          title_ar: '',
          status: 'running',
          cancel_reason: null,
          session_no: 3,
          sessions_count: 8,
          signup_closes_at: null,
          places_taken: 4,
          max_places: 8,
          sessions: [],
        },
      },
      [
        rawEnrolment('e1', { scope: 'course', first_session_no: 3, sessions_covered: 6 }),
        rawEnrolment('e2', {
          scope: 'course',
          status: 'cancelled',
          cancel_kind: 'guest_late',
          first_session_no: 1,
          sessions_covered: 8,
          money: {
            ...MONEY,
            online_paid_iqd: 80000,
            refunded_iqd: 50000,
            kept_iqd: 10000,
            take_iqd: 0,
          },
        }),
      ],
    );
    await mount();
    expect(plain(within(row('e1')).getByText(/^Course sign-up/).textContent)).toBe(
      'Course sign-up · sessions 3–8',
    );
    expect(within(row('e1')).getByText('Joined at session 3')).toBeTruthy();
    const earlier = row('e2-earlier');
    expect(within(earlier).getByText('Cancelled')).toBeTruthy();
    expect(
      within(earlier).getByText('Kept: the next session was inside the cancellation window'),
    ).toBeTruthy();
    expect(within(earlier).getByText('Refunded 50,000 IQD')).toBeTruthy();
    expect(screen.getByText('Earlier')).toBeTruthy();
  });
});

describe('LessonRosterPanel: earlier sign-ups fold after three', () => {
  it('shows three earlier rows under the live roster, then View more reveals the rest', async () => {
    const user = userEvent.setup();
    raw = rawDetail({}, [
      rawEnrolment('e1'),
      ...['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => rawEnrolment(id, { status: 'cancelled', cancel_kind: 'guest_late' })),
    ]);
    await mount();
    const earlier = () => document.querySelectorAll('[data-testid$="-earlier"]');
    expect(row('e1')).toBeTruthy();
    expect(earlier()).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'View more (2)' }));
    expect(earlier()).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Show less' }));
    expect(earlier()).toHaveLength(3);
  });
});

describe('LessonRosterPanel: attendance (§5.10.6)', () => {
  it('Arrived is optimistic: the chip shows before the server answers, and the buttons go', async () => {
    const user = userEvent.setup();
    let answer!: (v: unknown) => void;
    handlers.desk_mark_attendance = () => new Promise((r) => (answer = r));
    raw = rawDetail({}, [
      rawEnrolment('e1', { can: { ...NO_CAN, mark_attended: true, mark_no_show: true } }),
    ]);
    await mount();
    await user.click(button(row('e1'), 'Arrived'));
    expect(await within(row('e1')).findByText('Arrived', { selector: 'span span' })).toBeTruthy();
    expect(within(row('e1')).queryByRole('button', { name: 'Arrived' })).toBeNull();
    expect(calls.find((c) => c.fn === 'desk_mark_attendance')?.args).toEqual({
      p_lesson_id: 'l1',
      p_enrolment_id: 'e1',
      p_status: 'attended',
    });
    raw = rawDetail({}, [
      rawEnrolment('e1', {
        attendance: { status: 'attended', marked_at: AFTER, marked_by_name: 'Desk Ali' },
        can: { ...NO_CAN, unmark: true },
      }),
    ]);
    answer({ status: 'attended' });
    await waitFor(() =>
      expect(plain(within(row('e1')).getByText(/^Arrived ·/).textContent)).toBe(
        'Arrived · Desk Ali',
      ),
    );
  });

  it('Undo sends clear and drops the chip at once', async () => {
    const user = userEvent.setup();
    handlers.desk_mark_attendance = () => new Promise(() => {});
    raw = rawDetail({}, [
      rawEnrolment('e1', {
        attendance: { status: 'attended', marked_at: AFTER, marked_by_name: null },
        can: { ...NO_CAN, unmark: true },
      }),
    ]);
    await mount();
    expect(within(row('e1')).getByText('Arrived')).toBeTruthy();
    await user.click(button(row('e1'), 'Undo'));
    await waitFor(() => expect(within(row('e1')).queryByText('Arrived')).toBeNull());
    expect(calls.find((c) => c.fn === 'desk_mark_attendance')?.args.p_status).toBe('clear');
  });

  it('a refusal rolls the mark back and says why on the row', async () => {
    const user = userEvent.setup();
    handlers.desk_mark_attendance = () => {
      throw new AppRpcError('INVALID_TRANSITION', 'INVALID_TRANSITION', undefined, 'marks_closed');
    };
    raw = rawDetail({}, [rawEnrolment('e1', { can: { ...NO_CAN, mark_attended: true } })]);
    await mount();
    await user.click(button(row('e1'), 'Arrived'));
    expect(
      await within(row('e1')).findByText(
        'Too late to change: marks close 24 hours after the start.',
      ),
    ).toBeTruthy();
    expect(within(row('e1')).queryByText('Arrived', { selector: 'span span' })).toBeNull();
    expect(button(row('e1'), 'Arrived')).toBeTruthy();
  });

  it('No-show is disabled before the start, with the reason (CD-11)', async () => {
    raw = rawDetail({ server_now: BEFORE }, [
      rawEnrolment('e1', { can: { ...NO_CAN, mark_attended: true } }),
    ]);
    await mount();
    const noShow = button(row('e1'), 'No-show');
    expect(noShow.disabled).toBe(true);
    expect(noShow.title).toBe('A no-show can be marked once the lesson starts');
  });
});

describe('LessonRosterPanel: Take payment and cancel (§5.10.5, §5.10.8)', () => {
  it('Take payment opens the pane at take_iqd, with no part payment', async () => {
    const user = userEvent.setup();
    raw = rawDetail({}, [rawEnrolment('e1', { can: { ...NO_CAN, take_payment: true } })]);
    await mount();
    await user.click(button(row('e1'), 'Take payment'));
    const pane = await screen.findByRole('dialog', { name: 'Cash' });
    expect(plain(pane.textContent)).toContain("Student e1's lesson");
    expect(within(pane).getAllByText('15,000 IQD').length).toBeGreaterThan(0);
    expect(within(pane).queryByText('Part payment')).toBeNull();
  });

  it('the card button opens the card pane', async () => {
    const user = userEvent.setup();
    raw = rawDetail({}, [rawEnrolment('e1', { can: { ...NO_CAN, take_payment: true } })]);
    await mount();
    await user.click(button(row('e1'), 'Take payment by card'));
    expect(await screen.findByRole('dialog', { name: 'Card' })).toBeTruthy();
  });

  it('LESSON_OWED_CHANGED keeps the pane open on the new due read from the roster', async () => {
    const user = userEvent.setup();
    raw = rawDetail({}, [rawEnrolment('e1', { can: { ...NO_CAN, take_payment: true } })]);
    handlers.lesson_settle = () => {
      raw = rawDetail({}, [
        rawEnrolment('e1', {
          money: { ...MONEY, take_iqd: 10000 },
          can: { ...NO_CAN, take_payment: true },
        }),
      ]);
      throw new AppRpcError('LESSON_OWED_CHANGED', 'LESSON_OWED_CHANGED');
    };
    await mount();
    await user.click(button(row('e1'), 'Take payment'));
    const pane = await screen.findByRole('dialog', { name: 'Cash' });
    await user.type(within(pane).getByRole('textbox', { name: /Tendered/ }), '15000');
    await user.click(within(pane).getByRole('button', { name: 'Record payment' }));
    expect(
      await within(pane).findByText(
        'What this student owes changed to 10,000 IQD. Check before taking it.',
      ),
    ).toBeTruthy();
  });

  it('a group sign-up cancelled after its start: no refund is promised (OP-15)', async () => {
    const user = userEvent.setup();
    raw = rawDetail({ server_now: AFTER }, [
      rawEnrolment('e1', {
        money: { ...MONEY, desk_paid_iqd: 15000, take_iqd: 0 },
        can: { ...NO_CAN, cancel: true },
      }),
    ]);
    await mount();
    await user.click(button(row('e1'), 'Cancel sign-up'));
    const prompt = await screen.findByRole('dialog');
    expect(within(prompt).getByText('The session has begun, so the money is kept.')).toBeTruthy();
    expect(within(prompt).queryByText(/becomes a refund/)).toBeNull();
  });

  it('cancel says what happens to the money and sends `<code>: <note>`', async () => {
    const user = userEvent.setup();
    handlers.desk_cancel_enrolment = () => ({
      enrolment_id: 'e1',
      status: 'cancelled',
      refund_due_iqd: 15000,
      online_refund: null,
    });
    // Before the session starts (OP-15: after it, the money is kept).
    raw = rawDetail({ server_now: BEFORE }, [
      rawEnrolment('e1', {
        money: { ...MONEY, desk_paid_iqd: 15000, take_iqd: 0 },
        can: { ...NO_CAN, cancel: true },
      }),
    ]);
    await mount();
    await user.click(button(row('e1'), 'Cancel sign-up'));
    const prompt = await screen.findByRole('dialog');
    expect(
      within(prompt).getByText(
        '15,000 IQD was paid at the desk. It becomes a refund a manager makes at the till.',
      ),
    ).toBeTruthy();
    await user.type(within(prompt).getByLabelText(/note/i), 'Asked by phone');
    await user.click(within(prompt).getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(calls.find((c) => c.fn === 'desk_cancel_enrolment')?.args).toEqual({
        p_enrolment_id: 'e1',
        p_reason: 'customer_request: Asked by phone',
      }),
    );
    await waitFor(() =>
      expect(toast.ok).toHaveBeenCalledWith(
        'Sign-up cancelled. 15,000 IQD paid at the desk is now a refund due.',
      ),
    );
  });

  it('a private lesson’s booker: cancelling it cancels the lesson; nothing paid says so', async () => {
    const user = userEvent.setup();
    raw = rawDetail({ kind: 'private', places_taken: null, max_places: null }, [
      rawEnrolment('e1', { can: { ...NO_CAN, cancel: true } }),
    ]);
    await mount();
    await user.click(button(row('e1'), 'Cancel sign-up'));
    const prompt = await screen.findByRole('dialog');
    expect(within(prompt).getByText('Nothing was paid, so nothing is refunded.')).toBeTruthy();
    expect(
      within(prompt).getByText(
        'This is the private lesson itself: cancelling it cancels the lesson.',
      ),
    ).toBeTruthy();
  });

  it('?pay= opens the pane on that sign-up once, then hands the search back', async () => {
    const opened = vi.fn();
    raw = rawDetail({}, [
      rawEnrolment('e1', { can: { ...NO_CAN, take_payment: true } }),
      rawEnrolment('e2', {
        can: { ...NO_CAN, take_payment: true },
        money: { ...MONEY, take_iqd: 20000 },
      }),
    ]);
    await mount({ openPayFor: 'e2', onPayOpened: opened });
    const pane = await screen.findByRole('dialog', { name: 'Cash' });
    expect(plain(pane.textContent)).toContain("Student e2's lesson");
    expect(within(pane).getAllByText('20,000 IQD').length).toBeGreaterThan(0);
    expect(opened).toHaveBeenCalledTimes(1);
  });
});

describe('LessonRosterPanel: offline, roles and Arabic', () => {
  it('offline disables every control with the reason (CD-6)', async () => {
    reachable = false;
    raw = rawDetail({}, [
      rawEnrolment('e1', {
        can: {
          take_payment: true,
          cancel: true,
          mark_attended: true,
          mark_no_show: true,
          unmark: false,
        },
      }),
    ]);
    await mount();
    const panel = screen.getByTestId('lesson-roster');
    for (const name of [
      'Arrived',
      'No-show',
      'Take payment',
      'Take payment by card',
      'Cancel sign-up',
      'Add student',
    ]) {
      const b = button(panel, name);
      expect(b.disabled, name).toBe(true);
      expect(b.title, name).toBe('Needs a connection: lessons work online only');
    }
  });

  it('a cashier takes payment but runs no lesson', async () => {
    role = 'cashier';
    raw = rawDetail({}, [
      rawEnrolment('e1', {
        can: {
          take_payment: true,
          cancel: true,
          mark_attended: true,
          mark_no_show: false,
          unmark: false,
        },
      }),
    ]);
    await mount();
    expect(button(row('e1'), 'Take payment')).toBeTruthy();
    expect(within(row('e1')).queryByRole('button', { name: 'Arrived' })).toBeNull();
    expect(within(row('e1')).queryByRole('button', { name: 'Cancel sign-up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add student' })).toBeNull();
  });

  it('Arabic: right to left, Latin digits, and «حصة» in the no-show reason', async () => {
    localStorage.setItem('touch-operator-locale', 'ar');
    raw = rawDetail({ server_now: BEFORE }, [
      rawEnrolment('e1', { can: { ...NO_CAN, mark_attended: true, take_payment: true } }),
    ]);
    const { container } = await mount();
    expect(container.querySelector('[dir="rtl"]')).toBeTruthy();
    const panel = screen.getByTestId('lesson-roster');
    expect(within(panel).getByText('الأماكن 3 من 6')).toBeTruthy();
    expect(plain(within(panel).getByText(/^عليه/).textContent)).toMatch(/15,000/);
    const noShow = within(panel).getByRole('button', { name: 'تسجيل الغياب' }) as HTMLButtonElement;
    expect(noShow.title).toContain('حصة');
    expect(noShow.title).not.toContain('درس');
  });
});

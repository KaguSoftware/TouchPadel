import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wallTimeToUtc } from '@touch/core';
import { LocaleProvider } from '../../lib/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { StartLessonDialog, type StartLessonDialogProps } from './StartLessonDialog';
import type { DeskCoach, DeskLessonType, DeskLessons } from './lessonPayloads';

// New lesson (docs/design/coaching/operator.md §5.9) over a real query
// client: coach_slots and the three create RPCs are mocked at appRpc, the
// router and toast at their hooks, the station's reach at its hook.

const TZ = 'Asia/Baghdad';
const DATE = '2099-10-19';
const at = (date: string, hh: number, mm = 0) =>
  wallTimeToUtc(date, hh * 60 + mm, TZ).toISOString();

let slots: unknown = {
  off: false,
  venue_id: 'v1',
  lesson_type_id: 'p60',
  duration_min: 60,
  bookable: true,
  starts: [],
};
let created: unknown = null;
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
    if (fn === 'coach_slots') return slots;
    if (fn === 'desk_book_lesson' || fn === 'desk_create_group' || fn === 'desk_create_course') {
      if (created instanceof Error) throw created;
      return created;
    }
    return [];
  }),
}));
const { navigateSpy, toastOk, toastInfo } = vi.hoisted(() => ({
  navigateSpy: vi.fn(),
  toastOk: vi.fn(),
  toastInfo: vi.fn(),
}));
vi.mock('../../components/toast', () => ({
  useToast: () => ({ ok: toastOk, err: vi.fn(), info: toastInfo }),
}));
vi.mock('../../lib/stationReach', () => ({ useStationReach: () => ({ reachable }) }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

/** The text without its bidi isolates (isolate / isolateLtr wrap names and counts). */
const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '');

const courts = [
  { id: 'c1', name_en: 'Court 1', name_ar: 'الملعب 1', duration_options: [60, 90], sort_order: 1 },
  { id: 'c2', name_en: 'Court 2', name_ar: 'الملعب 2', duration_options: [60, 90], sort_order: 2 },
];

function type(over: Partial<DeskLessonType> & { lesson_type_id: string }): DeskLessonType {
  return {
    kind: 'private',
    name_en: 'Private 60 min',
    name_ar: 'خاصة 60 دقيقة',
    duration_min: 60,
    price_iqd: 30000,
    max_places: 4,
    min_places: 1,
    cutoff_hours: 0,
    sessions_count: 1,
    ...over,
  };
}

const sara: DeskCoach = {
  coach_id: 'sara',
  display_name_en: 'Coach Sara',
  display_name_ar: 'المدرّبة سارة',
  status: 'active',
  photo_path: null,
  lesson_type_ids: ['p60', 'g90', 'c4'],
  prices: [{ lesson_type_id: 'p60', price_iqd: 35000 }],
};
const paused: DeskCoach = {
  ...sara,
  coach_id: 'omar',
  display_name_en: 'Coach Omar',
  display_name_ar: 'المدرّب عمر',
  status: 'paused',
  prices: [],
};

function envelope(over: Partial<DeskLessons> = {}): DeskLessons {
  return {
    coaching_enabled: true,
    lesson_payment_mode: 'desk',
    // The server's clock: noon that day.
    server_now: at(DATE, 12),
    coaches: [sara, paused],
    lesson_types: [
      type({ lesson_type_id: 'p60' }),
      type({
        lesson_type_id: 'g90',
        kind: 'group',
        name_en: 'Group 90 min',
        duration_min: 90,
        price_iqd: 15000,
        max_places: 6,
        min_places: 3,
        cutoff_hours: 2,
      }),
      type({
        lesson_type_id: 'c4',
        kind: 'course',
        name_en: 'Beginners course',
        duration_min: 60,
        price_iqd: 120000,
        max_places: 6,
        min_places: 2,
        cutoff_hours: 2,
        sessions_count: 4,
      }),
    ],
    lessons: [],
    ...over,
  };
}

function open(over: Partial<StartLessonDialogProps> = {}) {
  const props: StartLessonDialogProps = {
    courtId: 'c1',
    startAt: new Date(at(DATE, 18)),
    courts,
    tz: TZ,
    guestName: 'Ali Hasan',
    guestPhone: '07701234567',
    lessons: envelope(),
    lessonsAt: Date.now(),
    onClose: vi.fn(),
    ...over,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <StartLessonDialog {...props} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return props;
}

// The stepped flow (StepWizard): the menu's rows are `lesson.step.<key>`,
// the kind cards `lesson.kind.<kind>`, and Create is on Review. Moving forward
// stops at the first unfinished step and lists what holds it.
type User = ReturnType<typeof userEvent.setup>;
type StepKey = 'kind' | 'type' | 'when' | 'title' | 'student' | 'review';
const go = (user: User, key: StepKey) => user.click(screen.getByTestId(`lesson.step.${key}`));
const pickKind = (user: User, kind: 'private' | 'group' | 'course') =>
  user.click(screen.getByTestId(`lesson.kind.${kind}`));
const createButton = () => screen.getByTestId('lesson.submit') as HTMLButtonElement;
async function create(user: User) {
  await go(user, 'review');
  await user.click(createButton());
}
const calls = (fn: string) => vi.mocked(appRpc).mock.calls.filter(([name]) => name === fn);

beforeEach(() => {
  slots = {
    off: false,
    venue_id: 'v1',
    lesson_type_id: 'p60',
    duration_min: 60,
    bookable: true,
    starts: [
      { start_at: at(DATE, 18), end_at: at(DATE, 19) },
      { start_at: at(DATE, 18, 30), end_at: at(DATE, 19, 30) },
    ],
  };
  created = null;
  reachable = true;
  vi.mocked(appRpc).mockClear();
  navigateSpy.mockClear();
  toastOk.mockClear();
  toastInfo.mockClear();
});

describe('StartLessonDialog — kinds, types and coaches', () => {
  it('offers only the kinds on sale, the type with the coach’s own price, and a paused coach disabled', async () => {
    const user = userEvent.setup();
    open({
      lessons: envelope({
        lesson_types: envelope().lesson_types.filter((t) => t.kind !== 'group'),
      }),
    });
    expect(screen.getByRole('group', { name: 'Kind' })).toBeTruthy();
    expect(screen.getByTestId('lesson.kind.private').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('lesson.kind.course')).toBeTruthy();
    expect(screen.queryByTestId('lesson.kind.group')).toBeNull();
    // A private lesson has no Course title step; it has a Student step.
    expect(screen.queryByTestId('lesson.step.title')).toBeNull();
    expect(screen.getByTestId('lesson.step.student')).toBeTruthy();
    await go(user, 'type');
    // Coach Sara is picked, so the type reads her own price, and so does the price box.
    expect(screen.getByRole('combobox', { name: 'Lesson type' }).textContent).toContain(
      'Private 60 min · 35,000 IQD',
    );
    expect(screen.getByText('35,000 IQD for the lesson')).toBeTruthy();
    expect(
      screen.getByText('Paid at the desk. The court is picked automatically from the free courts.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Coach Sara' }).getAttribute('aria-pressed')).toBe('true');
    const paused = screen.getByRole('button', {
      name: 'Coach Omar · Paused',
    }) as HTMLButtonElement;
    expect(paused.disabled).toBe(true);
  });

  it('opens on the coach and type picked on the Coaches tab, the kind following the type', async () => {
    const user = userEvent.setup();
    const lina: DeskCoach = { ...sara, coach_id: 'lina', display_name_en: 'Coach Lina', display_name_ar: 'المدرّبة لينا' };
    open({ coachId: 'lina', lessonTypeId: 'g90', lessons: envelope({ coaches: [sara, lina] }) });
    expect(screen.getByTestId('lesson.kind.group').getAttribute('aria-pressed')).toBe('true');
    await go(user, 'type');
    expect(screen.getByRole('combobox', { name: 'Lesson type' }).textContent).toContain('Group 90 min');
    expect(screen.getByRole('button', { name: 'Coach Lina' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('says so when nothing is on sale, and the Kind step holds', async () => {
    const user = userEvent.setup();
    open({ lessons: envelope({ lesson_types: [] }) });
    expect(screen.getByText('No lesson type is on sale at this branch yet.')).toBeTruthy();
    await go(user, 'review');
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    expect(screen.queryByTestId('lesson.submit')).toBeNull();
  });
});

describe('StartLessonDialog — a private lesson', () => {
  it('lists the coach’s free starts from coach_slots and pre-selects the pressed time', async () => {
    const user = userEvent.setup();
    open();
    await go(user, 'when');
    const chip = await screen.findByRole('button', { name: '6:00 PM' });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '6:30 PM' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(plain(screen.getByText(/free times that day/).textContent)).toBe(
      'Coach Sara’s free times that day.',
    );
    expect(calls('coach_slots')[0]![1]).toEqual({
      p_coach_id: 'sara',
      p_lesson_type_id: 'p60',
      p_from: '2099-10-18T21:00:00.000Z',
      p_to: '2099-10-19T21:00:00.000Z',
    });
  });

  it("a pressed time the coach isn't free at says so, and When waits for a pick", async () => {
    const user = userEvent.setup();
    open({ startAt: new Date(at(DATE, 17)) });
    await go(user, 'when');
    expect(plain((await screen.findByText(/isn.t free at/)).textContent)).toBe(
      "Coach Sara isn't free at 5:00 PM. Pick one of these times.",
    );
    await go(user, 'review');
    expect(screen.getByText('Pick a start time.')).toBeTruthy();
    expect(screen.queryByTestId('lesson.submit')).toBeNull();
    await user.click(screen.getByRole('button', { name: '6:30 PM' }));
    await go(user, 'review');
    expect(createButton().disabled).toBe(false);
  });

  it('no free time that day says so', async () => {
    const user = userEvent.setup();
    slots = {
      off: false,
      venue_id: 'v1',
      lesson_type_id: 'p60',
      duration_min: 60,
      bookable: true,
      starts: [],
    };
    open();
    await go(user, 'when');
    expect(plain((await screen.findByText(/No free time/)).textContent)).toBe(
      'No free time for Coach Sara that day.',
    );
  });

  it('books with the §1.7 arguments, names the court the server picked, and lands on the lesson', async () => {
    const user = userEvent.setup();
    created = {
      lesson_id: 'l-new',
      enrolment_id: 'e1',
      court_id: 'c2',
      court_name_en: 'Court 2',
      court_name_ar: 'الملعب 2',
      price_iqd: 35000,
    };
    const props = open();
    await go(user, 'when');
    await screen.findByRole('button', { name: '6:00 PM' });
    await go(user, 'student');
    expect(screen.getByText('This lesson type takes up to 4.')).toBeTruthy();
    // "+2" is LTR-isolated, so the name carries the marks.
    await user.click(screen.getByRole('button', { name: /\+2/ }));
    await go(user, 'review');
    const review = within(document.querySelector('.tp-wiz-review') as HTMLElement);
    expect(review.getByText('Private lesson')).toBeTruthy();
    expect(review.getByText('Coach Sara')).toBeTruthy();
    expect(review.getByText('35,000 IQD for the lesson')).toBeTruthy();
    expect(plain(review.getByText(/6:00 PM/).textContent)).toMatch(/ · 6:00 PM$/);
    expect(plain(review.getByText(/Ali Hasan/).textContent)).toBe('Ali Hasan +2');
    await user.click(createButton());
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({
        to: '/desk/lessons/$id',
        params: { id: 'l-new' },
      }),
    );
    const [, args] = calls('desk_book_lesson')[0]!;
    expect(args).toMatchObject({
      p_coach_id: 'sara',
      p_lesson_type_id: 'p60',
      p_start_at: at(DATE, 18),
      p_party_size: 3,
      p_name: 'Ali Hasan',
      p_phone: '07701234567',
    });
    expect(String((args as Record<string, unknown>).p_idempotency_key)).toMatch(/^lesson\.book:/);
    // Court 1 was pressed; the server took Court 2 (C-10): the toast says which.
    expect(plain(toastOk.mock.calls[0]![0] as string)).toBe(
      "Booked on Court 2: Court 1 wasn't free with the coach's hours. Move it from the lesson if needed.",
    );
    expect(props.onClose).toHaveBeenCalled();
  });

  it('on the pressed court the toast is the plain one', async () => {
    const user = userEvent.setup();
    created = {
      lesson_id: 'l-new',
      court_id: 'c1',
      court_name_en: 'Court 1',
      court_name_ar: 'الملعب 1',
    };
    open();
    await go(user, 'when');
    await screen.findByRole('button', { name: '6:00 PM' });
    await create(user);
    await waitFor(() => expect(toastOk).toHaveBeenCalled());
    expect(plain(toastOk.mock.calls[0]![0] as string)).toBe('Lesson booked on Court 1.');
  });
});

describe('StartLessonDialog — retries (OP-11)', () => {
  const keyOf = (n: number) =>
    String((calls('desk_book_lesson')[n]![1] as Record<string, unknown>).p_idempotency_key);

  it('a retry of the same draft sends the same key; an edited draft gets a new one', async () => {
    const user = userEvent.setup();
    created = new AppRpcError('COACH_BUSY', 'COACH_BUSY');
    open();
    await go(user, 'when');
    await screen.findByRole('button', { name: '6:00 PM' });
    await create(user);
    await waitFor(() => expect(calls('desk_book_lesson')).toHaveLength(1));
    await user.click(createButton());
    await waitFor(() => expect(calls('desk_book_lesson')).toHaveLength(2));
    expect(keyOf(1)).toBe(keyOf(0));
    // The draft changes (the party): a new write, a new key.
    await go(user, 'student');
    await user.click(screen.getByRole('button', { name: /\+2/ }));
    await create(user);
    await waitFor(() => expect(calls('desk_book_lesson')).toHaveLength(3));
    expect(keyOf(2)).not.toBe(keyOf(0));
  });

  it('a duplicate answer at another start says it was already booked earlier', async () => {
    const user = userEvent.setup();
    created = {
      duplicate: true,
      lesson_id: 'l-old',
      court_id: 'c1',
      court_name_en: 'Court 1',
      court_name_ar: 'الملعب 1',
      start_at: at(DATE, 17),
    };
    open();
    await go(user, 'when');
    await screen.findByRole('button', { name: '6:00 PM' });
    await create(user);
    await waitFor(() => expect(toastInfo).toHaveBeenCalled());
    expect(plain(toastInfo.mock.calls[0]![0] as string)).toBe('Already booked earlier at 5:00 PM.');
    expect(toastOk).not.toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/desk/lessons/$id', params: { id: 'l-old' } });
  });

  it('no answer at all: the last attempt may have gone through', async () => {
    const user = userEvent.setup();
    created = new TypeError('Failed to fetch');
    open();
    await go(user, 'when');
    await screen.findByRole('button', { name: '6:00 PM' });
    await create(user);
    expect(
      await screen.findByText(
        'The last attempt may have gone through. Check the lessons before trying again.',
      ),
    ).toBeTruthy();
  });
});

describe('StartLessonDialog — a group session', () => {
  it('a start inside its cut-off is refused before Create (R47)', async () => {
    const user = userEvent.setup();
    open({ startAt: new Date(at(DATE, 13, 30)) });
    await pickKind(user, 'group');
    // A group session has neither a Student nor a Course title step.
    expect(screen.queryByTestId('lesson.step.student')).toBeNull();
    expect(screen.queryByTestId('lesson.step.title')).toBeNull();
    await go(user, 'type');
    expect(screen.getByText('15,000 IQD a place')).toBeTruthy();
    expect(
      screen.getByText('Each student pays their own. The court is picked automatically from the free courts.'),
    ).toBeTruthy();
    await go(user, 'when');
    // Noon on the server's clock; a two-hour cut-off at 11:30 has passed.
    const reason =
      'That start is too close: its cut-off (11:30 AM) has already passed. Pick a later time.';
    expect(screen.getByText(reason)).toBeTruthy();
    await go(user, 'review');
    expect(screen.getByText('Step 3 of 3')).toBeTruthy();
    expect(screen.getAllByText(reason)).toHaveLength(2);
  });

  it('creates at a start past its cut-off with coach, type and start only', async () => {
    const user = userEvent.setup();
    created = { lesson_id: 'g-new', cutoff_at: at(DATE, 16) };
    open();
    await pickKind(user, 'group');
    await create(user);
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({
        to: '/desk/lessons/$id',
        params: { id: 'g-new' },
      }),
    );
    const [, args] = calls('desk_create_group')[0]!;
    expect(Object.keys(args as object).sort()).toEqual([
      'p_coach_id',
      'p_idempotency_key',
      'p_lesson_type_id',
      'p_start_at',
    ]);
    expect(args).toMatchObject({
      p_coach_id: 'sara',
      p_lesson_type_id: 'g90',
      p_start_at: at(DATE, 18),
    });
    expect(toastOk).toHaveBeenCalledWith(
      'Group session created. Add students or share it in the app.',
    );
  });
});

describe('StartLessonDialog — a course', () => {
  it('lists one start a week, takes an edited row, and marks the session a refusal names', async () => {
    const user = userEvent.setup();
    created = new AppRpcError('NO_COURT_FREE', 'NO_COURT_FREE', undefined, '3');
    open();
    await pickKind(user, 'course');
    expect(screen.queryByTestId('lesson.step.student')).toBeNull();
    await go(user, 'type');
    expect(plain(screen.getByTestId('lesson-price').textContent)).toBe(
      '120,000 IQD a person for 4 sessionsA court is taken for every session now.',
    );
    await go(user, 'when');
    const rows = within(screen.getByTestId('course-starts')).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    // Each row reads "Session n" and its day and time, as the preview draws them.
    expect(plain(rows[0]!.textContent)).toBe('Session 1Mon Oct 19, 2099 · 6:00 PM');
    // A row opens to move that session on its own.
    await user.click(within(rows[3]!).getByRole('button', { name: /^Session 4/ }));
    expect((screen.getByLabelText('Session 4 date') as HTMLInputElement).value).toBe('2099-11-09');
    // Move session 2 a day later.
    await user.click(within(rows[1]!).getByRole('button', { name: /^Session 2/ }));
    fireEvent.change(screen.getByLabelText('Session 2 date'), { target: { value: '2099-10-27' } });
    await go(user, 'title');
    await user.type(screen.getByLabelText('Course title (English)'), 'Beginners');
    await go(user, 'review');
    const review = within(document.querySelector('.tp-wiz-review') as HTMLElement);
    expect(review.getByText('Beginners')).toBeTruthy();
    expect(plain(review.getByText(/sessions from /).textContent)).toMatch(/^4 sessions from .* · 6:00 PM$/);
    await user.click(createButton());
    await waitFor(() => expect(calls('desk_create_course')).toHaveLength(1));
    expect(calls('desk_create_course')[0]![1]).toMatchObject({
      p_coach_id: 'sara',
      p_lesson_type_id: 'c4',
      p_starts: [at(DATE, 18), at('2099-10-27', 18), at('2099-11-02', 18), at('2099-11-09', 18)],
      p_title_en: 'Beginners',
      p_title_ar: '',
    });
    // The refusal names session 3: When opens again, its row is marked, and the line says which.
    expect((await screen.findByRole('alert')).textContent).toMatch(/^Session 3: /);
    expect(screen.getByText('Step 3 of 4')).toBeTruthy();
    expect(
      screen.getByTestId('course-starts').querySelector('[data-session="3"]')!.hasAttribute('data-refused'),
    ).toBe(true);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('a session out of order is said before Create', async () => {
    const user = userEvent.setup();
    open();
    await pickKind(user, 'course');
    await go(user, 'when');
    await user.click(within(screen.getByTestId('course-starts')).getByRole('button', { name: /^Session 3/ }));
    fireEvent.change(screen.getByLabelText('Session 3 date'), { target: { value: '2099-10-20' } });
    expect(
      screen.getAllByText('Each session has to start after the one before ends.').length,
    ).toBeGreaterThan(0);
    await go(user, 'review');
    expect(screen.getByText('Step 3 of 4')).toBeTruthy();
    expect(screen.queryByTestId('lesson.submit')).toBeNull();
  });
});

describe('StartLessonDialog — switched off and offline', () => {
  it('with coaching off the desk still stages, and says guests cannot see it yet (R51)', async () => {
    const user = userEvent.setup();
    open({ lessons: envelope({ coaching_enabled: false }) });
    expect(
      screen.getByText(
        "Lessons are switched off at this branch: guests can't see or book this yet.",
      ),
    ).toBeTruthy();
    await go(user, 'when');
    await screen.findByRole('button', { name: '6:00 PM' });
    await go(user, 'review');
    expect(createButton().disabled).toBe(false);
  });

  it('offline, Create stays on screen, disabled, with the reason (CD-6)', async () => {
    const user = userEvent.setup();
    reachable = false;
    open();
    await go(user, 'when');
    await screen.findByRole('button', { name: '6:00 PM' });
    await go(user, 'review');
    expect(createButton().disabled).toBe(true);
    expect(createButton().title).toBe('Needs a connection: lessons work online only');
  });
});

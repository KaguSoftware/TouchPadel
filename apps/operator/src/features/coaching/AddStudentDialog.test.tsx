import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Add student (operator.md §5.10.7): a typed student or a customer, a group
// session (p_lesson_id) or a course (p_course_id), the last place, the field
// mirrors and refusals, the attach links and offline.

const navigate = vi.fn();
const toast = { ok: vi.fn(), err: vi.fn(), info: vi.fn() };
let reachable = true;

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#record">{children}</a>,
  useNavigate: () => navigate,
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
vi.mock('../../lib/stationReach', () => ({ useStationReach: () => ({ reachable }) }));
vi.mock('../../components/toast', () => ({ useToast: () => toast }));

import { LocaleProvider } from '../../lib/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { AddStudentDialog } from './AddStudentDialog';
import type { LessonCourse, LessonInfo } from './lessonPayloads';

const rpc = vi.mocked(appRpc);
type Raw = Record<string, unknown>;
const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '');

const NOW = '2026-10-01T12:00:00.000Z';

function lesson(over: Partial<LessonInfo> = {}): LessonInfo {
  return {
    id: 'l1',
    venue_id: 'v1',
    kind: 'group',
    status: 'scheduled',
    cancel_reason: null,
    start_at: '2026-10-01T15:00:00.000Z',
    end_at: '2026-10-01T16:00:00.000Z',
    duration_min: 60,
    rescheduled_at: null,
    booked_by_kind: 'staff',
    coach: null,
    lesson_type: null,
    course: null,
    reservation_id: 'r1',
    reservation_status: 'confirmed',
    court_id: 'c1',
    court_name_en: 'Court 1',
    court_name_ar: 'الملعب 1',
    price_iqd: 15000,
    court_share_iqd: 5000,
    max_places: 6,
    min_places: 1,
    places_taken: 3,
    cutoff_at: null,
    hold_expires_at: null,
    created_by_name: null,
    server_now: NOW,
    day_open: true,
    can: {
      add_student: true,
      cancel: true,
      cancel_course: false,
      reschedule: true,
      move_court: true,
    },
    ...over,
  };
}

function course(): LessonCourse {
  const at = (days: number) =>
    new Date(Date.parse('2026-10-01T15:00:00Z') + days * 86_400_000).toISOString();
  const s = (no: number, days: number) => ({
    lesson_id: `s${no}`,
    session_no: no,
    start_at: at(days),
    end_at: at(days),
    status: 'scheduled',
    court_name_en: null,
    court_name_ar: null,
  });
  return {
    course_id: 'co1',
    title_en: 'Autumn',
    title_ar: '',
    status: 'running',
    cancel_reason: null,
    session_no: 2,
    sessions_count: 4,
    signup_closes_at: at(14),
    places_taken: 4,
    max_places: 8,
    // Sessions 1 and 2 have started: a sign-up now joins from session 3.
    sessions: [s(1, -7), s(2, -0.5), s(3, 7), s(4, 14)],
  };
}

let addResult: unknown;
let record: Raw | null;
let coachingOn = true;
const calls: { fn: string; args: Record<string, unknown> }[] = [];

beforeEach(() => {
  reachable = true;
  coachingOn = true;
  record = null;
  addResult = { duplicate: false, enrolment_id: 'e9', price_iqd: 15000, places_left: 2 };
  calls.length = 0;
  navigate.mockClear();
  for (const f of Object.values(toast)) f.mockClear();
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    if (fn === 'customer_record') return record;
    if (fn === 'desk_lessons') {
      return {
        coaching_enabled: coachingOn,
        lesson_payment_mode: 'desk',
        server_now: NOW,
        coaches: [],
        lesson_types: [],
        lessons: [],
      };
    }
    if (fn === 'desk_add_student') {
      if (addResult instanceof Error) throw addResult;
      return addResult;
    }
    return [];
  });
});

async function mount(props: { lesson?: LessonInfo; customerId?: string } = {}) {
  const onClose = vi.fn();
  const onAdded = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <AddStudentDialog
          lesson={props.lesson ?? lesson()}
          customerId={props.customerId}
          onClose={onClose}
          onAdded={onAdded}
        />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  const dialog = await screen.findByRole('dialog');
  return { dialog, onClose, onAdded };
}

const addButton = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: 'Add student' }) as HTMLButtonElement;

describe('AddStudentDialog', () => {
  it('a typed student on a group session: Add waits for a name, then sends it to the lesson with the dialog key', async () => {
    const user = userEvent.setup();
    const { dialog, onClose, onAdded } = await mount();
    expect(within(dialog).getByRole('heading', { name: 'Add student' })).toBeTruthy();
    expect(addButton(dialog).disabled).toBe(true);
    expect(addButton(dialog).title).toBe('Pick a customer or type a name.');
    await user.type(within(dialog).getByLabelText('Student name'), 'Bravo');
    await user.click(addButton(dialog));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const args = calls.find((c) => c.fn === 'desk_add_student')!.args;
    expect(args).toMatchObject({
      p_lesson_id: 'l1',
      p_customer_id: null,
      p_name: 'Bravo',
      p_phone: null,
    });
    // The other target is sent as null (app.desk_add_student has no defaults).
    expect(args).toHaveProperty('p_course_id', null);
    expect(String(args.p_idempotency_key)).toMatch(/^lesson\.add:/);
    expect(plain(toast.ok.mock.calls[0]![0] as string)).toBe('Bravo is in.');
    expect(onAdded).toHaveBeenCalled();
  });

  it('the last place says the session is full', async () => {
    const user = userEvent.setup();
    addResult = { duplicate: false, enrolment_id: 'e9', price_iqd: 15000, places_left: 0 };
    const { dialog } = await mount();
    await user.type(within(dialog).getByLabelText('Student name'), 'Bravo');
    await user.click(addButton(dialog));
    await waitFor(() => expect(toast.ok).toHaveBeenCalled());
    expect(plain(toast.ok.mock.calls[0]![0] as string)).toBe('Bravo is in. The session is full.');
  });

  it('a course session signs up for the course, joining from the next session to start', async () => {
    const user = userEvent.setup();
    const { dialog } = await mount({ lesson: lesson({ kind: 'course', course: course() }) });
    expect(
      within(dialog).getByRole('heading', { name: 'Add a student to the course' }),
    ).toBeTruthy();
    expect(plain(within(dialog).getByText(/^Joins from session/).textContent)).toBe(
      'Joins from session 3: pays for 2 sessions.',
    );
    await user.type(within(dialog).getByLabelText('Student name'), 'Delta');
    await user.type(within(dialog).getByLabelText(/^Phone/), '0770 123 4567');
    await user.click(addButton(dialog));
    await waitFor(() => expect(calls.find((c) => c.fn === 'desk_add_student')).toBeTruthy());
    const args = calls.find((c) => c.fn === 'desk_add_student')!.args;
    expect(args).toMatchObject({ p_course_id: 'co1', p_name: 'Delta', p_phone: '0770 123 4567' });
    expect(args).toHaveProperty('p_lesson_id', null);
  });

  it('a handed-back customer is picked and sent by id, never by a typed name', async () => {
    const user = userEvent.setup();
    record = {
      customer: {
        id: 'c9',
        full_name: 'Noor Salem',
        phone: '0771',
        email: null,
        preferred_lang: 'ar',
      },
      flags: [],
    };
    const { dialog } = await mount({ customerId: 'c9' });
    await waitFor(() => expect(addButton(dialog).disabled).toBe(false));
    expect(within(dialog).getByText(/Noor Salem/)).toBeTruthy();
    await user.click(addButton(dialog));
    await waitFor(() =>
      expect(calls.find((c) => c.fn === 'desk_add_student')?.args).toMatchObject({
        p_customer_id: 'c9',
        p_name: null,
        p_phone: null,
      }),
    );
  });

  it('a phone the server would refuse is said on its box, once the desk leaves it', async () => {
    const user = userEvent.setup();
    const { dialog } = await mount();
    await user.type(within(dialog).getByLabelText('Student name'), 'Bravo');
    const phone = within(dialog).getByLabelText(/^Phone/);
    await user.type(phone, '0770 12');
    expect(addButton(dialog).disabled).toBe(true);
    expect(addButton(dialog).title).toBe('A phone number has 7 to 15 digits.');
    expect(within(dialog).queryByText('A phone number has 7 to 15 digits.')).toBeNull();
    await user.tab();
    expect(within(dialog).getByText('A phone number has 7 to 15 digits.')).toBeTruthy();
  });

  it('INVALID_ARGUMENT p_phone lands on the phone box, not as a generic refusal', async () => {
    const user = userEvent.setup();
    addResult = new AppRpcError('INVALID_ARGUMENT', 'INVALID_ARGUMENT', undefined, 'p_phone');
    const { dialog, onClose } = await mount();
    await user.type(within(dialog).getByLabelText('Student name'), 'Bravo');
    await user.type(within(dialog).getByLabelText(/^Phone/), '07701234567');
    await user.click(addButton(dialog));
    expect(await within(dialog).findByText('A phone number has 7 to 15 digits.')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a refusal stays in the dialog, beside the button', async () => {
    const user = userEvent.setup();
    addResult = new AppRpcError('ALREADY_ENROLLED', 'ALREADY_ENROLLED', undefined, 'coach');
    const { dialog, onClose } = await mount();
    await user.type(within(dialog).getByLabelText('Student name'), 'Echo');
    await user.click(addButton(dialog));
    expect(
      await within(dialog).findByText('That customer is the coach of this lesson.'),
    ).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('coaching switched off at the branch: the desk still adds, and says guests can’t see it yet (R51)', async () => {
    const user = userEvent.setup();
    coachingOn = false;
    const { dialog, onClose } = await mount();
    expect(
      await within(dialog).findByText(
        "Lessons are switched off at this branch: guests can't see or book this yet.",
      ),
    ).toBeTruthy();
    const night = calls.find((c) => c.fn === 'desk_lessons')!.args;
    expect(night).toMatchObject({
      p_from: '2026-09-30T21:00:00.000Z',
      p_to: '2026-10-01T21:00:00.000Z',
    });
    await user.type(within(dialog).getByLabelText('Student name'), 'Bravo');
    await user.click(addButton(dialog));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('coaching on: no staging line', async () => {
    const { dialog } = await mount();
    await waitFor(() => expect(calls.some((c) => c.fn === 'desk_lessons')).toBe(true));
    expect(within(dialog).queryByText(/Lessons are switched off/)).toBeNull();
  });

  it('offline: Add needs a connection', async () => {
    reachable = false;
    const { dialog } = await mount();
    expect(addButton(dialog).disabled).toBe(true);
    expect(addButton(dialog).title).toBe('Needs a connection: lessons work online only');
  });

  it('Create customer and Find in the directory leave in attach mode, naming this lesson', async () => {
    const user = userEvent.setup();
    const { dialog } = await mount();
    await user.click(within(dialog).getByRole('button', { name: 'Create customer' }));
    expect(navigate).toHaveBeenCalledWith({
      to: '/desk/customers/new',
      search: { attach: 'lesson', lesson: 'l1' },
    });
    await user.click(within(dialog).getByRole('button', { name: 'Find in the directory' }));
    expect(navigate).toHaveBeenCalledWith({
      to: '/desk/customers',
      search: { attach: 'lesson', lesson: 'l1' },
    });
  });
});

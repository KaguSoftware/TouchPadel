import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { ConfirmProvider } from '../../../components/ConfirmDialog';
import type * as StorageModule from '../../../lib/storage';

// /admin/coaches › Coaches (coaching operator.md §5.13.1, §5.21): Make a coach
// with a picked customer and a random-folder photo path (R43), the
// waiting-to-accept badge (C-22, R61), the retire confirm that names what it
// cancels and is never refused (C-25, R45), an account-deleted row (R63), the
// coach-price confirm when a type is unticked (R46), and the server-missing
// and switched-off states (§5.5).

const nav = vi.hoisted(() => ({ navigate: vi.fn(), search: {} as Record<string, unknown> }));
const toast = vi.hoisted(() => ({ ok: vi.fn(), err: vi.fn(), info: vi.fn() }));
const who = vi.hoisted(() => ({ role: 'manager' }));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => nav.navigate,
  useSearch: () => nav.search,
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock('../../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 's1', displayName: 'Staff', role: who.role } }),
}));
vi.mock('../../../lib/venue', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useVenue: () => ({
    venues: [
      {
        id: 'v1',
        slug: 'karrada',
        name_en: 'Karrada',
        name_ar: 'الكرادة',
        status: 'open',
        timezone: 'Asia/Baghdad',
        phone: null,
        created_at: '',
      },
      {
        id: 'v2',
        slug: 'mansour',
        name_en: 'Mansour',
        name_ar: 'المنصور',
        status: 'open',
        timezone: 'Asia/Baghdad',
        phone: null,
        created_at: '',
      },
    ],
    branchId: 'v1',
    current: null,
    stationBranchId: null,
    canSwitch: true,
    setBranch: () => undefined,
  }),
}));
vi.mock('../../../lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof StorageModule>();
  return {
    ...actual,
    publicUrl: (p: string) => `https://cdn.test/${p}`,
    removeMedia: vi.fn(async () => undefined),
  };
});
// The upload itself (canvas compression, the bucket) is not under test: the
// field hands back the path lib/storage.ts mints for a coach photo.
vi.mock('../../../components/ImageField', async () => {
  const { mediaPath } = await vi.importActual<typeof StorageModule>('../../../lib/storage');
  return {
    ImageField: ({ label, onChange }: { label: string; onChange: (p: string | null) => void }) => (
      <button type="button" onClick={() => onChange(mediaPath('coaches', null, 'webp'))}>
        {label}
      </button>
    ),
  };
});
vi.mock('../../../components/toast', () => ({ useToast: () => toast }));
vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { CoachesAdmin } from './CoachesAdmin';

const rpc = vi.mocked(appRpc);
const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '');
const calls = (fn: string) => rpc.mock.calls.filter(([name]) => name === fn);
const PHOTO_PATH = /^coaches\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/;

function coach(over: Record<string, unknown> = {}) {
  return {
    coach_id: 'c1',
    profile_id: 'p1',
    full_name: 'Sara Karim',
    phone: '+9647700000001',
    account_deleted: false,
    display_name_en: 'Coach Sara',
    display_name_ar: 'المدرّبة سارة',
    bio_en: '',
    bio_ar: '',
    photo_path: null,
    status: 'active',
    public_accepted_at: '2026-09-30T10:00:00Z',
    sort_order: 0,
    venue_ids: ['v1'],
    lesson_type_ids: ['t1', 't2'],
    prices: [{ lesson_type_id: 't2', price_iqd: 40000 }],
    hours: [{ weekday: 1, start_time: '09:00:00', end_time: '13:00:00' }],
    hours_set_by: 'coach',
    hours_set_by_name: null,
    hours_updated_at: '2026-09-29T08:00:00Z',
    hours_elsewhere: [],
    time_off: [],
    upcoming_lessons: 5,
    open_courses: 1,
    ...over,
  };
}

function lessonType(over: Record<string, unknown> = {}) {
  return {
    lesson_type_id: 't1',
    kind: 'private',
    name_en: 'Private 60',
    name_ar: 'حصة خاصة 60',
    description_en: '',
    description_ar: '',
    duration_min: 60,
    price_iqd: 30000,
    court_share_iqd: 5000,
    max_places: 4,
    min_places: 1,
    cutoff_hours: 0,
    sessions_count: null,
    is_active: true,
    launched_at: '2026-09-01T00:00:00Z',
    sort_order: 0,
    coach_ids: ['c1'],
    pending_run: null,
    ...over,
  };
}

let admin: () => unknown;
let answers: Record<string, (args: Record<string, unknown>) => unknown>;

function mount() {
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown> = {}) => {
    if (fn === 'coaches_admin') return admin();
    const answer = answers[fn];
    return answer ? answer(args) : {};
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <ConfirmProvider>
          <CoachesAdmin />
        </ConfirmProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.mockReset();
  nav.navigate.mockReset();
  nav.search = {};
  toast.ok.mockReset();
  who.role = 'manager';
  admin = () => ({
    coaching_enabled: true,
    server_now: '2026-10-01T09:00:00Z',
    coaches: [coach()],
    lesson_types: [
      lessonType(),
      lessonType({
        lesson_type_id: 't2',
        name_en: 'Group clinic',
        name_ar: 'تدريب جماعي',
        kind: 'group',
      }),
    ],
  });
  answers = {};
});

describe('CoachesAdmin ▸ Coaches', () => {
  it("Make a coach with the record's customer picked: a random-folder photo, then the ticked lesson types", async () => {
    const user = userEvent.setup();
    nav.search = { promote: 'p9' };
    answers.customer_record = () => ({
      customer: { id: 'p9', full_name: 'Ali Hasan', phone: '+9647700000009' },
    });
    answers.coach_promote = () => ({ coach_id: 'c9' });
    answers.set_coach_lesson_types = (args) => ({ lesson_type_ids: args.p_lesson_type_ids });
    mount();
    const dialog = within(await screen.findByRole('dialog', { name: 'Make a coach' }));
    // The record's customer, read and picked.
    expect(await dialog.findByText(/Ali Hasan/)).toBeTruthy();
    await user.type(dialog.getByRole('textbox', { name: 'Display name (English)' }), 'Coach Ali');
    await user.type(dialog.getByRole('textbox', { name: 'Display name (Arabic)' }), 'المدرّب علي');
    await user.click(dialog.getByRole('button', { name: 'Photo' }));
    await user.click(dialog.getByRole('checkbox', { name: /Private 60/ }));
    // The rail's branch comes ticked.
    expect((dialog.getByRole('checkbox', { name: 'Karrada' }) as HTMLInputElement).checked).toBe(
      true,
    );
    await user.click(dialog.getByRole('button', { name: 'Make coach' }));

    await waitFor(() => expect(calls('coach_promote')).toHaveLength(1));
    const args = calls('coach_promote')[0]![1] as Record<string, unknown>;
    expect(args).toMatchObject({
      p_profile_id: 'p9',
      p_display_name_en: 'Coach Ali',
      p_display_name_ar: 'المدرّب علي',
      p_venue_ids: ['v1'],
    });
    // R43: a fresh random folder, never the profile or coach id.
    expect(String(args.p_photo_path)).toMatch(PHOTO_PATH);
    expect(String(args.p_photo_path)).not.toContain('p9');
    await waitFor(() => expect(calls('set_coach_lesson_types')).toHaveLength(1));
    expect(calls('set_coach_lesson_types')[0]![1]).toMatchObject({
      p_coach_id: 'c9',
      p_lesson_type_ids: ['t1'],
    });
    expect(plain(toast.ok.mock.calls[0]![0] as string)).toBe('Coach Ali is now a coach.');
    // The new coach's editor opens.
    expect(nav.navigate).toHaveBeenLastCalledWith({
      to: '/admin/coaches',
      search: { coach: 'c9' },
      replace: true,
    });
  });

  it('the lesson types refused after the promote: the coach exists, and the editor opens on them with the refusal by the types', async () => {
    const user = userEvent.setup();
    nav.search = { promote: 'p9' };
    // The route follows the navigation, as the router would.
    nav.navigate.mockImplementation((to: { search?: Record<string, unknown> }) => {
      nav.search = to.search ?? {};
    });
    let promoted = false;
    admin = () => ({
      coaching_enabled: true,
      server_now: null,
      coaches: promoted
        ? [
            coach(),
            coach({
              coach_id: 'c9',
              profile_id: 'p9',
              display_name_en: 'Coach Ali',
              lesson_type_ids: [],
              prices: [],
            }),
          ]
        : [coach()],
      lesson_types: [lessonType()],
    });
    answers.customer_record = () => ({
      customer: { id: 'p9', full_name: 'Ali Hasan', phone: null },
    });
    answers.coach_promote = () => {
      promoted = true;
      return { coach_id: 'c9' };
    };
    answers.set_coach_lesson_types = () => {
      throw new AppRpcError('COACH_NOT_AT_BRANCH', 'COACH_NOT_AT_BRANCH');
    };
    mount();
    const dialog = within(await screen.findByRole('dialog', { name: 'Make a coach' }));
    await dialog.findByText(/Ali Hasan/);
    await user.type(dialog.getByRole('textbox', { name: 'Display name (English)' }), 'Coach Ali');
    await user.type(dialog.getByRole('textbox', { name: 'Display name (Arabic)' }), 'علي');
    await user.click(dialog.getByRole('checkbox', { name: /Private 60/ }));
    await user.click(dialog.getByRole('button', { name: 'Make coach' }));
    const editor = within(await screen.findByTestId('coach-editor'));
    expect(
      plain((await editor.findByText(/is a coach now, but their lesson types/)).textContent),
    ).toBe(
      "Coach Ali is a coach now, but their lesson types weren't saved. Tick them again below.",
    );
    // The ticks the promote sent are still on screen, ready to save again.
    const types = within(editor.getByRole('group', { name: 'Lesson types here' }));
    expect((types.getByRole('checkbox', { name: /Private 60/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(editor.getByRole('button', { name: 'Save lesson types' })).toBeTruthy();
  });

  it('a promote with no account, names or branch is refused before anything is sent', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Make a coach' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Make a coach' }));
    await user.click(dialog.getByRole('button', { name: 'Make coach' }));
    expect(dialog.getByText('Pick a guest account first.')).toBeTruthy();
    expect(dialog.getByText('Both display names are needed.')).toBeTruthy();
    expect(calls('coach_promote')).toHaveLength(0);
  });

  it('the rail branch unticked with types ticked: the types clear and no types call is made (OP-09)', async () => {
    const user = userEvent.setup();
    nav.search = { promote: 'p9' };
    answers.customer_record = () => ({
      customer: { id: 'p9', full_name: 'Ali Hasan', phone: null },
    });
    answers.coach_promote = () => ({ coach_id: 'c9' });
    mount();
    const dialog = within(await screen.findByRole('dialog', { name: 'Make a coach' }));
    await dialog.findByText(/Ali Hasan/);
    await user.type(dialog.getByRole('textbox', { name: 'Display name (English)' }), 'Coach Ali');
    await user.type(dialog.getByRole('textbox', { name: 'Display name (Arabic)' }), 'علي');
    const privateType = dialog.getByRole('checkbox', { name: /Private 60/ }) as HTMLInputElement;
    await user.click(privateType);
    expect(privateType.checked).toBe(true);
    await user.click(dialog.getByRole('checkbox', { name: 'Mansour' }));
    await user.click(dialog.getByRole('checkbox', { name: 'Karrada' }));
    // This branch's types apply only while it is ticked: cleared and disabled.
    expect(privateType.checked).toBe(false);
    expect(privateType.disabled).toBe(true);
    await user.click(dialog.getByRole('button', { name: 'Make coach' }));
    await waitFor(() => expect(calls('coach_promote')).toHaveLength(1));
    expect(calls('coach_promote')[0]![1]).toMatchObject({ p_venue_ids: ['v2'] });
    await waitFor(() => expect(toast.ok).toHaveBeenCalled());
    expect(calls('set_coach_lesson_types')).toHaveLength(0);
  });

  it('ALREADY_COACH offers to open that coach', async () => {
    const user = userEvent.setup();
    nav.search = { promote: 'p1' };
    answers.customer_record = () => ({
      customer: { id: 'p1', full_name: 'Sara Karim', phone: null },
    });
    answers.coach_promote = () => {
      throw new AppRpcError('ALREADY_COACH', 'ALREADY_COACH');
    };
    mount();
    const dialog = within(await screen.findByRole('dialog', { name: 'Make a coach' }));
    await dialog.findByText(/Sara Karim/);
    await user.type(dialog.getByRole('textbox', { name: 'Display name (English)' }), 'Coach Sara');
    await user.type(dialog.getByRole('textbox', { name: 'Display name (Arabic)' }), 'سارة');
    await user.click(dialog.getByRole('button', { name: 'Make coach' }));
    await user.click(await dialog.findByRole('button', { name: 'Open Coach Sara' }));
    expect(nav.navigate).toHaveBeenLastCalledWith({
      to: '/admin/coaches',
      search: { coach: 'c1' },
      replace: true,
    });
  });

  it('shows "Waiting for the coach to accept" until the coach accepts (C-22, R61), and says who sees what', async () => {
    admin = () => ({
      coaching_enabled: true,
      server_now: null,
      coaches: [coach({ public_accepted_at: null })],
      lesson_types: [],
    });
    nav.search = { coach: 'c1' };
    mount();
    const table = await screen.findByRole('table', { name: 'Coaches' });
    expect(within(table).getByText('Waiting for the coach to accept')).toBeTruthy();
    const editor = screen.getByTestId('coach-editor');
    expect(plain(editor.textContent)).toContain("Coach Sara hasn't accepted a public profile yet.");
  });

  it('retire: the confirm names the lessons to come and the course clause, needs a note, and is never refused', async () => {
    const user = userEvent.setup();
    nav.search = { coach: 'c1' };
    answers.set_coach_status = () => ({
      coach_id: 'c1',
      status: 'retired',
      lessons_cancelled: 5,
      courses_cancelled: 1,
      duplicate: false,
    });
    mount();
    const editor = within(await screen.findByTestId('coach-editor'));
    await user.click(editor.getByRole('button', { name: 'Retire' }));
    const dialog = within(await screen.findByRole('dialog', { name: /^Retire.*Coach Sara.*\?$/ }));
    expect(plain(dialog.getByTestId('retire-body').textContent)).toMatch(
      /^Their lessons to come \(5 lessons\) and any running course are cancelled as coach cancels/,
    );
    const confirm = dialog.getByRole('button', { name: 'Retire' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(dialog.getByRole('textbox', { name: /^Why/ }), 'Moved abroad');
    await user.click(confirm);
    await waitFor(() => expect(calls('set_coach_status')).toHaveLength(1));
    expect(calls('set_coach_status')[0]![1]).toEqual({
      p_coach_id: 'c1',
      p_status: 'retired',
      p_reason: 'Moved abroad',
    });
    await waitFor(() => expect(toast.ok).toHaveBeenCalled());
    expect(plain(toast.ok.mock.calls[0]![0] as string)).toBe(
      'Coach Sara is retired: 5 lessons cancelled.',
    );
  });

  it('a coach with no course to cancel: the confirm leaves the course clause out', async () => {
    const user = userEvent.setup();
    admin = () => ({
      coaching_enabled: true,
      server_now: null,
      coaches: [coach({ upcoming_lessons: 1, open_courses: 0 })],
      lesson_types: [],
    });
    nav.search = { coach: 'c1' };
    mount();
    await user.click(
      within(await screen.findByTestId('coach-editor')).getByRole('button', { name: 'Retire' }),
    );
    const body = plain((await screen.findByTestId('retire-body')).textContent);
    expect(body).toMatch(/^Their lessons to come \(one lesson\) are cancelled/);
    expect(body).not.toContain('running course');
  });

  it('an account-deleted coach: the row says so and the editor is read-only (R63)', async () => {
    admin = () => ({
      coaching_enabled: true,
      server_now: null,
      coaches: [
        coach(),
        coach({
          coach_id: 'c2',
          display_name_en: 'Coach Omar',
          status: 'retired',
          account_deleted: true,
          full_name: null,
          phone: null,
        }),
      ],
      lesson_types: [],
    });
    nav.search = { coach: 'c2' };
    mount();
    const table = await screen.findByRole('table', { name: 'Coaches' });
    // The retired coach being edited stays listed even though retired coaches are folded.
    expect(within(table).getByText('Coach Omar')).toBeTruthy();
    const editor = within(screen.getByTestId('coach-editor'));
    expect(
      editor.getByText(
        'Account deleted: the bio and photo were cleared; the display name stays on their statements.',
      ),
    ).toBeTruthy();
    expect(editor.getByText('Retired. Their statements stay under Coach pay.')).toBeTruthy();
    expect(editor.queryByRole('button', { name: 'Retire' })).toBeNull();
    expect(editor.queryByRole('button', { name: 'Make a coach again' })).toBeNull();
    expect(screen.getAllByText('Account deleted').length).toBeGreaterThan(0);
  });

  it('retired coaches fold behind "Show retired coaches"', async () => {
    const user = userEvent.setup();
    admin = () => ({
      coaching_enabled: true,
      server_now: null,
      coaches: [
        coach(),
        coach({ coach_id: 'c3', display_name_en: 'Coach Huda', status: 'retired' }),
      ],
      lesson_types: [],
    });
    mount();
    const table = await screen.findByRole('table', { name: 'Coaches' });
    expect(within(table).queryByText('Coach Huda')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Show retired coaches/ }));
    expect(
      within(screen.getByRole('table', { name: 'Coaches' })).getByText('Coach Huda'),
    ).toBeTruthy();
  });

  it('unticking a type the coach has an own price for asks first (R46)', async () => {
    const user = userEvent.setup();
    nav.search = { coach: 'c1' };
    answers.set_coach_lesson_types = (args) => ({ lesson_type_ids: args.p_lesson_type_ids });
    mount();
    const editor = within(await screen.findByTestId('coach-editor'));
    const types = within(editor.getByRole('group', { name: 'Lesson types here' }));
    await user.click(types.getByRole('checkbox', { name: /Group clinic/ }));
    await user.click(editor.getByRole('button', { name: 'Save lesson types' }));
    const ask = within(
      await screen.findByRole('dialog', { name: /^Remove.*Coach Sara.*own price\?$/ }),
    );
    expect(plain(ask.getByText(/Unticking/).textContent)).toBe(
      "Unticking Group clinic also removes Coach Sara's own price for it.",
    );
    await user.click(ask.getByRole('button', { name: 'Untick and remove the price' }));
    await waitFor(() => expect(calls('set_coach_lesson_types')).toHaveLength(1));
    expect(calls('set_coach_lesson_types')[0]![1]).toMatchObject({
      p_coach_id: 'c1',
      p_lesson_type_ids: ['t1'],
    });
  });

  it("a manager reads the coach's prices and proposes one; the owner sets it directly", async () => {
    const user = userEvent.setup();
    nav.search = { coach: 'c1' };
    mount();
    const editor = within(await screen.findByTestId('coach-editor'));
    expect(editor.getByText("Prices change through the owner's approval.")).toBeTruthy();
    await user.click(
      editor.getByRole('button', { name: 'Propose a price for Coach Sara: Group clinic' }),
    );
    expect(nav.navigate).toHaveBeenLastCalledWith({
      to: '/protocols',
      search: { start: 'price_promo', change: 'coach_price', lessonType: 't2', coach: 'c1' },
    });
  });

  it('the owner sets an own price; empty removes it', async () => {
    const user = userEvent.setup();
    who.role = 'owner';
    nav.search = { coach: 'c1' };
    answers.set_coach_price = () => ({});
    mount();
    const editor = within(await screen.findByTestId('coach-editor'));
    const price = editor.getByRole('textbox', { name: "Coach Sara's price for Group clinic" });
    await user.clear(price);
    const row = price.closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Set' }));
    await waitFor(() => expect(calls('set_coach_price')).toHaveLength(1));
    expect(calls('set_coach_price')[0]![1]).toEqual({
      p_coach_id: 'c1',
      p_lesson_type_id: 't2',
      p_price_iqd: null,
    });
  });

  it('BRANCH_HAS_BOOKINGS names the branch the coach still has lessons at', async () => {
    const user = userEvent.setup();
    admin = () => ({
      coaching_enabled: true,
      server_now: null,
      coaches: [coach({ venue_ids: ['v1', 'v2'] })],
      lesson_types: [],
    });
    nav.search = { coach: 'c1' };
    answers.set_coach_branches = () => {
      // The branch id is in the hint, the detail is coach_lessons (0290).
      throw new AppRpcError('BRANCH_HAS_BOOKINGS', 'BRANCH_HAS_BOOKINGS', 'v2', 'coach_lessons');
    };
    mount();
    const editor = within(await screen.findByTestId('coach-editor'));
    await user.click(
      within(editor.getByRole('group', { name: 'Branches' })).getByRole('checkbox', {
        name: 'Mansour',
      }),
    );
    await user.click(editor.getByRole('button', { name: 'Save branches' }));
    expect(plain((await editor.findByText(/has lessons at/)).textContent)).toBe(
      'This coach has lessons at Mansour. Cancel them first.',
    );
  });

  it('coaching switched off: an info line, and setup still works', async () => {
    admin = () => ({
      coaching_enabled: false,
      server_now: null,
      coaches: [coach()],
      lesson_types: [],
    });
    mount();
    expect(
      await screen.findByText(
        /Lessons are switched off at this branch\. Coaches and lesson types can be set up now/,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Make a coach' })).toBeTruthy();
  });

  it('a server without coaching (RPC_MISSING) shows the server-update empty state', async () => {
    admin = () => {
      throw new AppRpcError('RPC_MISSING', 'RPC_MISSING');
    };
    mount();
    expect(
      await screen.findByText("Coaching needs a server update that isn't there yet."),
    ).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('the tabs are bound to ?tab=', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('tab', { name: 'Hours' }));
    expect(nav.navigate).toHaveBeenLastCalledWith({
      to: '/admin/coaches',
      search: { tab: 'hours' },
      replace: true,
    });
  });
});

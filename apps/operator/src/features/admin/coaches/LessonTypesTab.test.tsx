import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { readCoachesAdmin } from '../../coaching/lessonPayloads';

// /admin/coaches › Lesson types (coaching operator.md §5.13.2, §5.21; C-17,
// R26, R46): a manager edits a draft's price directly; a launched price is
// read-only with Propose a price; the length is read-only with Make a new
// lesson type…; the Active switch saves directly; the owner edits and
// launches directly.

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
vi.mock('../../../components/toast', () => ({ useToast: () => toast }));
vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { LessonTypesTab } from './LessonTypesTab';
import type { LessonTypeDraft } from './lessonTypeLogic';

const rpc = vi.mocked(appRpc);
const calls = (fn: string) => rpc.mock.calls.filter(([name]) => name === fn);

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

const DRAFT = lessonType({
  lesson_type_id: 't3',
  name_en: 'Group clinic',
  kind: 'group',
  max_places: 8,
  min_places: 2,
  cutoff_hours: 2,
  price_iqd: null,
  launched_at: null,
  is_active: false,
});
const GROUP = lessonType({
  lesson_type_id: 't2',
  name_en: 'Evening group',
  kind: 'group',
  max_places: 8,
  min_places: 2,
  cutoff_hours: 2,
});

function data(types: Record<string, unknown>[]) {
  return readCoachesAdmin({
    coaching_enabled: true,
    server_now: '2026-10-01T09:00:00Z',
    coaches: [
      {
        coach_id: 'c1',
        display_name_en: 'Coach Sara',
        display_name_ar: 'المدرّبة سارة',
        status: 'active',
        venue_ids: ['v1'],
        lesson_type_ids: ['t1'],
      },
    ],
    lesson_types: types,
  });
}

const spies = { onSelect: vi.fn(), onNewDraft: vi.fn(), onCreated: vi.fn() };

function mount(
  selectedId: string | null,
  types: Record<string, unknown>[] = [lessonType(), GROUP, DRAFT],
  newDraft: LessonTypeDraft | null = null,
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <LessonTypesTab
          data={data(types)}
          selectedId={selectedId}
          newDraft={newDraft}
          reachable
          onSelect={spies.onSelect}
          onNewDraft={spies.onNewDraft}
          onCreated={spies.onCreated}
        />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ lesson_type_id: 'tNew' });
  nav.navigate.mockReset();
  toast.ok.mockReset();
  spies.onSelect.mockReset();
  spies.onNewDraft.mockReset();
  spies.onCreated.mockReset();
  who.role = 'manager';
});

describe('LessonTypesTab', () => {
  it('lists the types grouped by kind with their state, and a pending price change links to its run', async () => {
    const user = userEvent.setup();
    mount(null, [
      lessonType({ pending_run: { run_id: 'r1', change: 'lesson_price' } }),
      GROUP,
      DRAFT,
    ]);
    const priv = within(screen.getByRole('table', { name: 'Private lessons' }));
    expect(priv.getByText(/^Up to \W*4\W* people$/)).toBeTruthy();
    expect(priv.getByText('On sale')).toBeTruthy();
    const group = within(screen.getByRole('table', { name: 'Group sessions' }));
    expect(group.getByText('Draft')).toBeTruthy();
    expect(group.getByText('No price yet')).toBeTruthy();
    await user.click(priv.getByRole('button', { name: 'Price change in progress' }));
    expect(nav.navigate).toHaveBeenCalledWith({ to: '/protocols', search: { run: 'r1' } });
  });

  it('manager, draft: the price is edited directly (C-17); Put on sale waits for a price', async () => {
    const user = userEvent.setup();
    mount('t3');
    const editor = within(screen.getByTestId('lesson-type-editor'));
    const launch = editor.getByRole('button', { name: 'Put on sale' }) as HTMLButtonElement;
    expect(launch.disabled).toBe(true);
    expect(launch.title).toBe('Set a price first.');
    await user.type(editor.getByRole('textbox', { name: /^Price/ }), '25000');
    await user.click(editor.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls('upsert_lesson_type')).toHaveLength(1));
    expect(calls('upsert_lesson_type')[0]![1]).toEqual({
      p_venue_id: null,
      p_id: 't3',
      p_patch: { price_iqd: 25000 },
    });
  });

  it('manager, draft with a price: Put on sale starts a lesson_launch proposal', async () => {
    const user = userEvent.setup();
    mount('t3', [{ ...DRAFT, price_iqd: 20000 }]);
    await user.click(
      within(screen.getByTestId('lesson-type-editor')).getByRole('button', { name: 'Put on sale' }),
    );
    expect(nav.navigate).toHaveBeenCalledWith({
      to: '/protocols',
      search: { start: 'price_promo', change: 'lesson_launch', lessonType: 't3' },
    });
    expect(calls('upsert_lesson_type')).toHaveLength(0);
  });

  it('manager, launched: price read-only with Propose a price; length and party size read-only with Make a new lesson type…', async () => {
    const user = userEvent.setup();
    mount('t1');
    const editor = within(screen.getByTestId('lesson-type-editor'));
    expect(editor.queryByRole('textbox', { name: /^Price/ })).toBeNull();
    expect(editor.getByText("Lesson prices change through the owner's approval.")).toBeTruthy();
    expect(editor.getByText('30,000 IQD')).toBeTruthy();
    await user.click(editor.getByRole('button', { name: 'Propose a price' }));
    expect(nav.navigate).toHaveBeenCalledWith({
      to: '/protocols',
      search: { start: 'price_promo', change: 'lesson_price', lessonType: 't1' },
    });
    // The shape a price proposal snapshots (R46): length and a private type's party size.
    expect(editor.queryByRole('combobox', { name: 'Length' })).toBeNull();
    expect(editor.queryByRole('combobox', { name: 'Largest party' })).toBeNull();
    expect(
      editor.getByText('Make a new lesson type to change its length, sessions or party size.'),
    ).toBeTruthy();
    await user.click(editor.getByRole('button', { name: 'Make a new lesson type…' }));
    expect(spies.onNewDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'private',
        nameEn: 'Private 60',
        durationMin: 60,
        price: 30000,
      }),
    );
    // The kind is fixed once on sale.
    expect(
      (editor.getByRole('button', { name: 'Group session' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('manager, launched group type: places and minimum stay editable', async () => {
    const user = userEvent.setup();
    mount('t2');
    const editor = within(screen.getByTestId('lesson-type-editor'));
    const places = editor.getByRole('textbox', { name: 'Places' });
    await user.clear(places);
    await user.type(places, '10');
    await user.click(editor.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls('upsert_lesson_type')).toHaveLength(1));
    expect(calls('upsert_lesson_type')[0]![1]).toMatchObject({
      p_id: 't2',
      p_patch: { max_places: 10 },
    });
  });

  it('the Active switch saves directly, for a manager too (R46)', async () => {
    const user = userEvent.setup();
    mount('t1');
    await user.click(
      within(screen.getByTestId('lesson-type-editor')).getByRole('switch', { name: 'On sale' }),
    );
    await waitFor(() => expect(calls('upsert_lesson_type')).toHaveLength(1));
    expect(calls('upsert_lesson_type')[0]![1]).toEqual({
      p_venue_id: null,
      p_id: 't1',
      p_patch: { is_active: false },
    });
  });

  it('owner: edits a launched price directly', async () => {
    const user = userEvent.setup();
    who.role = 'owner';
    mount('t1');
    const editor = within(screen.getByTestId('lesson-type-editor'));
    const price = editor.getByRole('textbox', { name: /^Price/ });
    await user.clear(price);
    await user.type(price, '35000');
    await user.click(editor.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls('upsert_lesson_type')).toHaveLength(1));
    expect(calls('upsert_lesson_type')[0]![1]).toEqual({
      p_venue_id: null,
      p_id: 't1',
      p_patch: { price_iqd: 35000 },
    });
  });

  it('owner: puts a priced draft on sale directly', async () => {
    const user = userEvent.setup();
    who.role = 'owner';
    mount('t3', [{ ...DRAFT, price_iqd: 20000 }]);
    await user.click(
      within(screen.getByTestId('lesson-type-editor')).getByRole('button', { name: 'Put on sale' }),
    );
    await waitFor(() => expect(calls('upsert_lesson_type')).toHaveLength(1));
    expect(calls('upsert_lesson_type')[0]![1]).toEqual({
      p_venue_id: null,
      p_id: 't3',
      p_patch: { is_active: true },
    });
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('a stale screen refused for its shape shows the way out', async () => {
    const user = userEvent.setup();
    rpc.mockRejectedValueOnce(
      new AppRpcError('PRICE_VIA_PROTOCOL', 'PRICE_VIA_PROTOCOL', undefined, 'shape'),
    );
    mount('t2');
    const editor = within(screen.getByTestId('lesson-type-editor'));
    const places = editor.getByRole('textbox', { name: 'Places' });
    await user.clear(places);
    await user.type(places, '9');
    await user.click(editor.getByRole('button', { name: 'Save' }));
    // The refusal's own line and way out, beside the standing note of a locked group type's length.
    await waitFor(() =>
      expect(
        editor.getAllByText('Make a new lesson type to change its length, sessions or party size.'),
      ).toHaveLength(2),
    );
    expect(editor.getAllByRole('button', { name: 'Make a new lesson type…' })).toHaveLength(2);
  });

  it('a stale screen refused for its price offers Propose a price, never the item wording', async () => {
    const user = userEvent.setup();
    who.role = 'owner';
    rpc.mockRejectedValueOnce(
      new AppRpcError('PRICE_VIA_PROTOCOL', 'PRICE_VIA_PROTOCOL', undefined, 'price'),
    );
    mount('t1');
    const editor = within(screen.getByTestId('lesson-type-editor'));
    const price = editor.getByRole('textbox', { name: /^Price/ });
    await user.clear(price);
    await user.type(price, '1');
    await user.click(editor.getByRole('button', { name: 'Save' }));
    expect(
      await editor.findByText("Lesson prices change through the owner's approval."),
    ).toBeTruthy();
  });

  it('R26: a new group type starts at a 2-hour cut-off, and a minimum above 1 refuses a 0-hour one', async () => {
    const user = userEvent.setup();
    mount(null, [], {
      kind: 'group',
      nameEn: 'Clinic',
      nameAr: 'تدريب',
      descEn: '',
      descAr: '',
      durationMin: 60,
      maxPlaces: '8',
      minPlaces: '2',
      cutoffHours: '2',
      sessions: '',
      price: null,
      courtShare: 0,
      sortOrder: 0,
    });
    const editor = within(screen.getByTestId('lesson-type-editor'));
    const cutoff = editor.getByRole('textbox', { name: /^Cut-off/ });
    expect((cutoff as HTMLInputElement).value).toBe('2');
    await user.clear(cutoff);
    await user.type(cutoff, '0');
    await user.click(editor.getByRole('button', { name: 'Create draft' }));
    expect(await editor.findByText('At least 1 hour when the minimum is above 1.')).toBeTruthy();
    expect(calls('upsert_lesson_type')).toHaveLength(0);
    await user.clear(cutoff);
    await user.type(cutoff, '3');
    await user.click(editor.getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(calls('upsert_lesson_type')).toHaveLength(1));
    expect(calls('upsert_lesson_type')[0]![1]).toMatchObject({
      p_id: null,
      p_patch: { kind: 'group', cutoff_hours: 3, min_places: 2 },
    });
    await waitFor(() => expect(spies.onCreated).toHaveBeenCalledWith('tNew'));
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import type { StaffRole } from '../../lib/auth';

// The Checklists card on /protocols: the current copy of each list, who it is
// for, when it is due and whether it is overdue; who ticked what; and the
// owner's editor (who / repeats / due / lines / archive). Staff tick on the
// phone; nothing here ticks (scheduled-checklists-2026-10-08 §4).

let role: StaffRole = 'manager';
// A photo opens through a signed URL on the private staff-media bucket.
const signed = vi.hoisted(() => vi.fn(async (path: string) => ({ data: { signedUrl: `https://signed.test/${path}` }, error: null })));
vi.mock('../../lib/supabase', () => ({
  supabase: { storage: { from: () => ({ createSignedUrl: (path: string) => signed(path) }) } },
  supabaseUrl: '',
  supabaseAnonKey: '',
}));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../lib/settings', () => ({ useBusinessToday: () => '2026-09-25' }));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 's1', displayName: 'Someone', role } }),
}));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { AppRpcError, appRpc } from '../../lib/appRpc';
import { ChecklistsCard } from './ChecklistsCard';

const rpc = vi.mocked(appRpc);

const dayState = {
  business_date: '2026-09-25',
  lists: [
    { role: 'barista', slot: 'open', name_en: 'Bar opening', name_ar: 'افتتاح البار', total: 2, done: 2, open_items: [], template_id: 't1', assignee_name: null, due_at: '2026-09-25T05:00:00Z', overdue: false },
    { role: 'cashier', slot: 'close', name_en: 'Till closing', name_ar: 'إغلاق الصندوق', total: 2, done: 1, open_items: [{ text_en: 'Empty the bin', text_ar: 'أفرغ السلة' }], template_id: 't3', assignee_name: null, due_at: '2026-09-25T20:00:00Z', overdue: false },
    { role: null, slot: 'open', name_en: 'Deep clean', name_ar: 'تنظيف عميق', total: 1, done: 0, open_items: [{ text_en: 'Fridge', text_ar: 'الثلاجة' }], template_id: 't4', assignee_name: 'Bareq', due_at: '2026-09-21T06:00:00Z', overdue: true },
  ],
};

const run = (over: Record<string, unknown>) => ({ assignee_id: null, assignee_name: null, period_start: '2026-09-25', period_end: '2026-09-25', due_at: null, overdue: false, ...over });

const board = {
  business_date: '2026-09-25',
  templates: [
    {
      template_id: 't1',
      role: 'barista',
      slot: 'open',
      name_en: 'Bar opening',
      name_ar: 'افتتاح البار',
      version: 2,
      audience: 'role',
      copy_mode: 'shared',
      repeat_kind: 'weekdays',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      month_days: null,
      due_time: null,
      assignees: [],
      items: [
        { position: 1, text_en: 'Turn on the machine', text_ar: 'شغّل الماكينة' },
        { position: 2, text_en: 'Fill the beans', text_ar: 'املأ البن' },
      ],
      runs: [
        run({
          run_id: 'r1',
          due_at: '2026-09-25T05:00:00Z',
          done: 1,
          total: 2,
          items: [
            { text_en: 'Turn on the machine', text_ar: 'شغّل الماكينة', done_by_name: 'Yusuf', done_at: '2026-09-25T05:10:00Z', note: null },
            { text_en: 'Fill the beans', text_ar: 'املأ البن', done_by_name: null, done_at: null, note: null },
          ],
        }),
      ],
    },
    {
      template_id: 't2',
      role: 'barista',
      slot: 'close',
      name_en: 'Bar closing',
      name_ar: 'إغلاق البار',
      version: 1,
      audience: 'role',
      copy_mode: 'shared',
      repeat_kind: 'weekdays',
      weekdays: [0, 3],
      month_days: null,
      due_time: null,
      assignees: [],
      items: [{ position: 1, text_en: 'Clean the steam wand', text_ar: 'نظّف أنبوب البخار', photo_required: true }],
      runs: [],
    },
    {
      template_id: 't3',
      role: 'cashier',
      slot: 'close',
      name_en: 'Till closing',
      name_ar: 'إغلاق الصندوق',
      version: 4,
      audience: 'role',
      copy_mode: 'shared',
      repeat_kind: 'weekdays',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      month_days: null,
      due_time: null,
      assignees: [],
      items: [
        { position: 1, text_en: 'Wipe the counter', text_ar: 'امسح الكاونتر', photo_required: true },
        { position: 2, text_en: 'Empty the bin', text_ar: 'أفرغ السلة', photo_required: true },
      ],
      runs: [
        run({
          run_id: 'r3',
          done: 1,
          total: 2,
          items: [
            { text_en: 'Wipe the counter', text_ar: 'امسح الكاونتر', done_by_name: 'Maha', done_at: '2026-09-25T19:40:00Z', note: null, photo_required: true, photo_path: 'v1/checklists/s2/counter.jpg' },
            { text_en: 'Empty the bin', text_ar: 'أفرغ السلة', done_by_name: null, done_at: null, note: null, photo_required: true, photo_path: null },
          ],
        }),
      ],
    },
    {
      template_id: 't4',
      role: null,
      slot: 'open',
      name_en: 'Deep clean',
      name_ar: 'تنظيف عميق',
      version: 1,
      audience: 'people',
      copy_mode: 'each',
      repeat_kind: 'weekdays',
      weekdays: [0],
      month_days: null,
      due_time: '09:00',
      assignees: [
        { id: 'p1', display_name: 'Bareq', role: 'barista' },
        { id: 'p2', display_name: 'Maha', role: 'cashier' },
      ],
      items: [{ position: 1, text_en: 'Fridge', text_ar: 'الثلاجة' }],
      runs: [
        run({ run_id: 'r4a', assignee_id: 'p1', assignee_name: 'Bareq', period_start: '2026-09-20', period_end: '2026-09-26', due_at: '2026-09-20T06:00:00Z', overdue: true, done: 0, total: 1, items: [{ text_en: 'Fridge', text_ar: 'الثلاجة', done_by_name: null, done_at: null, note: null }] }),
        run({ run_id: 'r4b', assignee_id: 'p2', assignee_name: 'Maha', period_start: '2026-09-20', period_end: '2026-09-26', due_at: '2026-09-20T06:00:00Z', done: 1, total: 1, items: [{ text_en: 'Fridge', text_ar: 'الثلاجة', done_by_name: 'Maha', done_at: '2026-09-20T05:00:00Z', note: null }] }),
      ],
    },
  ],
};

const staffOptions = [
  { id: 'p1', display_name: 'Bareq', role: 'barista' },
  { id: 'p2', display_name: 'Maha', role: 'cashier' },
  { id: 'p3', display_name: 'Yusuf', role: 'driver' },
];

let save: (args: Record<string, unknown>) => Promise<unknown>;
let archive: (args: Record<string, unknown>) => Promise<unknown>;

function renderCard(as: StaffRole, state: unknown = dayState, options: unknown = staffOptions) {
  role = as;
  rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    if (fn === 'checklist_day_state') return state;
    if (fn === 'checklist_board') return board;
    if (fn === 'checklist_staff_options') return options;
    if (fn === 'save_checklist') return save(args ?? {});
    if (fn === 'archive_checklist') return archive(args ?? {});
    throw new Error(`unexpected ${fn}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ChecklistsCard />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

async function openEditor(listId?: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Edit the lists' }));
  const dialog = await screen.findByRole('dialog');
  if (listId) await userEvent.click(await within(dialog).findByTestId(`checklist-list-${listId}`));
  return { dialog, editor: await within(dialog).findByTestId('checklist-editor') };
}

beforeEach(() => {
  rpc.mockReset();
  signed.mockClear();
  save = async () => ({ template_id: 'new', version: 1 });
  archive = async () => ({ template_id: 't1', version: 3, archived_at: '2026-09-25T10:00:00Z' });
});

describe('ChecklistsCard', () => {
  it('lists the current copies, overdue first and tagged, with who, repeats and due', async () => {
    renderCard('manager');
    expect(await screen.findByText('1 of 3 lists finished today')).toBeTruthy();
    const rows = [...document.querySelectorAll('[data-list]')];
    expect(rows.map((r) => r.getAttribute('data-list'))).toEqual(['t4:Bareq', 't3:', 't1:']);
    const late = rows[0] as HTMLElement;
    expect(late.getAttribute('data-overdue')).toBe('true');
    expect(within(late).getByText('Overdue')).toBeTruthy();
    expect(within(late).getByText('Bareq')).toBeTruthy();
    // The repeat summary arrives with the board read.
    expect(await within(late).findByText('Every Sunday')).toBeTruthy();
    expect(within(late).getByText(/^Due /)).toBeTruthy();
    const till = rows[1] as HTMLElement;
    expect(within(till).getByText('Cashier')).toBeTruthy();
    expect(within(till).queryByText('Overdue')).toBeNull();
    expect(rpc).toHaveBeenCalledWith('checklist_day_state', { p_business_date: '2026-09-25' });
  });

  it('shows the manager each copy, its person and who ticked what, and gives the manager no editor', async () => {
    renderCard('manager');
    await screen.findByText('1 of 3 lists finished today');
    expect(screen.queryByRole('button', { name: 'Edit the lists' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'See today' }));
    const dialog = await screen.findByRole('dialog');
    const opening = (await within(dialog).findByText('Bar opening')).closest('section')!;
    expect(within(opening).getByText(/^.Yusuf. · /)).toBeTruthy();
    expect(within(opening).getByText('1 of 2')).toBeTruthy();
    expect(within(opening).getByText('Every day, before opening · Barista: one shared list')).toBeTruthy();
    // A list with no copy open shows its lines untouched.
    const closing = within(dialog).getByText('Bar closing').closest('section')!;
    expect(within(closing).getByText('No copy of this list is open today.')).toBeTruthy();
    // A people list: one block per person, the late one tagged.
    const deep = within(dialog).getByText('Deep clean').closest('section')!;
    const bareq = deep.querySelector('[data-run="r4a"]') as HTMLElement;
    expect(within(bareq).getByText('Bareq')).toBeTruthy();
    expect(within(bareq).getByText('Overdue')).toBeTruthy();
    const maha = deep.querySelector('[data-run="r4b"]') as HTMLElement;
    expect(within(maha).getByText('Finished')).toBeTruthy();
    expect(within(maha).queryByText('Overdue')).toBeNull();
    expect(within(dialog).queryByRole('tab', { name: 'Edit the lists' })).toBeNull();
  });

  it('shows the manager which lines need a photo, and the photo of a ticked one', async () => {
    renderCard('manager');
    await userEvent.click(await screen.findByRole('button', { name: 'See today' }));
    const dialog = await screen.findByRole('dialog');
    const till = (await within(dialog).findByText('Till closing')).closest('section')!;
    const bin = till.querySelector('[data-line="2"]') as HTMLElement;
    expect(within(bin).getByText('Needs a photo')).toBeTruthy();
    const counter = till.querySelector('[data-line="1"]') as HTMLElement;
    expect(within(counter).queryByText('Needs a photo')).toBeNull();
    const thumb = within(counter).getByRole('button', { name: 'See the photo: Wipe the counter' });
    await waitFor(() => expect(signed).toHaveBeenCalledWith('v1/checklists/s2/counter.jpg'));
    await userEvent.click(thumb);
    expect(await within(counter).findByAltText('Photo for: Wipe the counter')).toBeTruthy();
    await userEvent.click(within(counter).getByRole('button', { name: 'Hide the photo: Wipe the counter' }));
    expect(within(counter).queryByAltText('Photo for: Wipe the counter')).toBeNull();
    const closing = within(dialog).getByText('Bar closing').closest('section')!;
    expect(within(closing).getByText('Needs a photo')).toBeTruthy();
  });

  it('lets the owner write a new list for named people, on chosen weekdays, by a set time', async () => {
    const calls: Record<string, unknown>[] = [];
    save = async (args) => {
      calls.push(args);
      return { template_id: 't9', version: 1 };
    };
    renderCard('owner', { business_date: '2026-09-25', lists: [] });
    await userEvent.click(await screen.findByRole('button', { name: 'Write a list' }));
    const dialog = await screen.findByRole('dialog');
    // With nothing chosen, the sheet opens on the first list; "New list" starts a blank one.
    await userEvent.click(await within(dialog).findByTestId('checklist-new'));
    const editor = await within(dialog).findByTestId('checklist-editor');
    expect(within(editor).getByText('New list')).toBeTruthy();
    expect(within(editor).queryByTestId('checklist-archive')).toBeNull();

    await userEvent.type(within(editor).getByLabelText('Name (English)'), 'Fridge check');
    await userEvent.type(within(editor).getByLabelText('Name (Arabic)'), 'فحص الثلاجة');
    await userEvent.click(within(editor).getByTestId('checklist-who-people'));
    await userEvent.click(await within(editor).findByTestId('checklist-person-p1'));
    await userEvent.click(within(editor).getByTestId('checklist-person-p3'));
    expect(within(editor).getByText('Chosen: 2')).toBeTruthy();
    await userEvent.click(within(editor).getByTestId('checklist-repeat-weekdays'));
    await userEvent.click(within(editor).getByTestId('checklist-weekday-0'));
    await userEvent.click(within(editor).getByTestId('checklist-weekday-3'));
    await userEvent.click(within(editor).getByTestId('checklist-due-time'));
    await userEvent.type(within(editor).getByLabelText('Time'), '09:30');
    await userEvent.type(within(editor).getByLabelText('Line 1, English'), 'Check the temperature');
    await userEvent.type(within(editor).getByLabelText('Line 1, Arabic'), 'افحص الحرارة');
    expect(within(editor).getByTestId('checklist-summary').textContent).toMatch(/^Every Sunday and Wednesday, by 9:30\sAM · Bareq, Yusuf$/);

    await userEvent.click(within(editor).getByRole('button', { name: 'Save the list' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      p_venue_id: null,
      p_template_id: null,
      p_expected_version: 0,
      p_spec: {
        name_en: 'Fridge check',
        name_ar: 'فحص الثلاجة',
        audience: 'people',
        copy_mode: 'each',
        staff_ids: ['p1', 'p3'],
        repeat_kind: 'weekdays',
        weekdays: [0, 3],
        slot: 'time',
        due_time: '09:30',
        items: [{ text_en: 'Check the temperature', text_ar: 'افحص الحرارة', photo_required: false }],
      },
    });

    // The board has not caught up with the new list (this mock never does):
    // the editor stays on it, not on another list or a blank form, and the
    // next save writes the same list at its new version.
    const after = await within(dialog).findByTestId('checklist-editor');
    expect(await within(after).findByRole('heading', { name: 'Fridge check' })).toBeTruthy();
    expect(within(dialog).getByTestId('checklist-list-t1').getAttribute('aria-pressed')).toBe('false');
    await userEvent.type(within(after).getByLabelText('Name (English)'), ' 2');
    await userEvent.click(within(after).getByRole('button', { name: 'Save the list' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({ p_template_id: 't9', p_expected_version: 1, p_spec: { name_en: 'Fridge check 2' } });
  });

  it('marks someone who left the branch, sends nothing while they are on the list, and takes them off in one press', async () => {
    const calls: Record<string, unknown>[] = [];
    save = async (args) => {
      calls.push(args);
      return { template_id: 't4', version: 2 };
    };
    // Maha (p2) is on the saved list but no longer among the branch's people.
    renderCard('owner', dayState, staffOptions.filter((p) => p.id !== 'p2'));
    const { editor } = await openEditor('t4');
    expect(await within(editor).findByText('No longer at this branch')).toBeTruthy();
    expect(within(editor).getByTestId('checklist-people-away').textContent).toContain('Maha');
    await userEvent.type(within(editor).getByLabelText('Name (English)'), '!');
    await userEvent.click(within(editor).getByRole('button', { name: 'Save the list' }));
    expect(calls).toHaveLength(0);
    await userEvent.click(within(editor).getByTestId('checklist-people-away-remove'));
    expect(within(editor).queryByTestId('checklist-people-away')).toBeNull();
    expect(within(editor).getByTestId<HTMLInputElement>('checklist-person-p2').checked).toBe(false);
    await userEvent.click(within(editor).getByRole('button', { name: 'Save the list' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ p_template_id: 't4', p_spec: { staff_ids: ['p1'] } });
  });

  it('asks for a role, a person, a weekday and a time before anything is sent', async () => {
    const calls: unknown[] = [];
    save = async (args) => {
      calls.push(args);
      return { template_id: 't9', version: 1 };
    };
    renderCard('owner');
    const { dialog } = await openEditor();
    await userEvent.click(within(dialog).getByTestId('checklist-new'));
    const editor = await within(dialog).findByTestId('checklist-editor');
    await userEvent.type(within(editor).getByLabelText('Name (English)'), 'X');
    await userEvent.type(within(editor).getByLabelText('Name (Arabic)'), 'س');
    // A line in one language only.
    await userEvent.type(within(editor).getByLabelText('Line 1, English'), 'Count the float');
    await userEvent.click(within(editor).getByRole('button', { name: 'Save the list' }));
    expect(await within(editor).findByText('Write it in both English and Arabic.')).toBeTruthy();
    expect(within(editor).getByText('Choose a role.')).toBeTruthy();
    await userEvent.click(within(editor).getByTestId('checklist-who-people'));
    expect(within(editor).getByText('Choose at least one person.')).toBeTruthy();
    await userEvent.click(within(editor).getByTestId('checklist-repeat-weekdays'));
    expect(within(editor).getByText('Choose at least one day.')).toBeTruthy();
    await userEvent.click(within(editor).getByTestId('checklist-due-time'));
    expect(within(editor).getByText('Enter a time.')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('edits a saved role list: everyone their own copy, a photo line, twice a month, sent with its version', async () => {
    const calls: Record<string, unknown>[] = [];
    save = async (args) => {
      calls.push(args);
      return { template_id: 't1', version: 3 };
    };
    renderCard('owner');
    const { editor } = await openEditor('t1');
    expect(within(editor).getByRole('heading', { name: 'Bar opening' })).toBeTruthy();
    const switches = within(editor).getAllByRole('switch', { name: 'Needs a photo' });
    expect(switches.map((s) => s.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    await userEvent.click(switches[1]!);
    expect(within(editor).getByText(/Needs a photo: 1/)).toBeTruthy();
    await userEvent.click(within(editor).getByRole('switch', { name: 'Everyone does their own copy' }));
    await userEvent.click(within(editor).getByTestId('checklist-repeat-twiceMonthly'));
    // Two dates, 1 and 15 to start; the second becomes the last day.
    await userEvent.click(within(editor).getByRole('combobox', { name: 'Date 2' }));
    await userEvent.click(screen.getByRole('option', { name: 'Last day' }));
    await userEvent.click(within(editor).getByTestId('checklist-due-close'));
    expect(within(editor).getByTestId('checklist-summary').textContent).toBe('Every month on the 1st and the last day, before closing · Barista: everyone their own copy');
    await userEvent.click(within(editor).getByRole('button', { name: 'Save the list' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      p_venue_id: null,
      p_template_id: 't1',
      p_expected_version: 2,
      p_spec: {
        name_en: 'Bar opening',
        name_ar: 'افتتاح البار',
        audience: 'role',
        role: 'barista',
        copy_mode: 'each',
        repeat_kind: 'monthdays',
        month_days: [1, 31],
        slot: 'close',
        items: [
          { text_en: 'Turn on the machine', text_ar: 'شغّل الماكينة', photo_required: false },
          { text_en: 'Fill the beans', text_ar: 'املأ البن', photo_required: true },
        ],
      },
    });
  });

  it('opens a people list with its people ticked and its weekdays and time', async () => {
    renderCard('owner');
    const { editor } = await openEditor('t4');
    expect((within(editor).getByTestId('checklist-who-people') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    expect((await within(editor).findByTestId<HTMLInputElement>('checklist-person-p1')).checked).toBe(true);
    expect(within(editor).getByTestId<HTMLInputElement>('checklist-person-p3').checked).toBe(false);
    expect(within(editor).getByTestId('checklist-weekday-0').getAttribute('aria-pressed')).toBe('true');
    expect(within(editor).getByTestId('checklist-weekday-1').getAttribute('aria-pressed')).toBe('false');
    expect((within(editor).getByLabelText('Time') as HTMLInputElement).value).toBe('09:00');
    // Nothing changed yet, so nothing to save.
    expect((within(editor).getByRole('button', { name: 'Save the list' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens a saved list with its photo lines switched on', async () => {
    renderCard('owner');
    const { editor } = await openEditor('t3');
    expect(within(editor).getAllByRole('switch', { name: 'Needs a photo' }).map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'true']);
    expect((within(editor).getByRole('button', { name: 'Save the list' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says a copy keeps its lines only for a list with a copy open', async () => {
    renderCard('owner');
    const keeps = /that copy keeps its old lines/;
    const { dialog, editor } = await openEditor('t1');
    expect(within(editor).getByText(keeps)).toBeTruthy();
    await userEvent.click(within(dialog).getByTestId('checklist-list-t2'));
    expect(within(await within(dialog).findByTestId('checklist-editor')).queryByText(keeps)).toBeNull();
  });

  it('shows each list in the left column with who it is for and how it repeats', async () => {
    renderCard('owner');
    const { dialog } = await openEditor();
    const t4 = within(dialog).getByTestId('checklist-list-t4');
    expect(within(t4).getByText('Deep clean')).toBeTruthy();
    expect(within(t4).getByText('Bareq, Maha')).toBeTruthy();
    expect(within(t4).getByText('Every Sunday')).toBeTruthy();
    expect(within(within(dialog).getByTestId('checklist-list-t2')).getByText('Every Sunday and Wednesday')).toBeTruthy();
  });

  it('archives a list after a confirm, with the version it was opened at', async () => {
    const calls: Record<string, unknown>[] = [];
    archive = async (args) => {
      calls.push(args);
      return { template_id: 't3', version: 5, archived_at: '2026-09-25T10:00:00Z' };
    };
    renderCard('owner');
    const { editor } = await openEditor('t3');
    await userEvent.click(within(editor).getByTestId('checklist-archive'));
    const confirm = await screen.findByRole('dialog', { name: 'Archive “Till closing”?' });
    expect(calls).toHaveLength(0);
    await userEvent.click(within(confirm).getByRole('button', { name: 'Archive the list' }));
    await waitFor(() => expect(calls).toEqual([{ p_template_id: 't3', p_expected_version: 4 }]));
  });

  it('sends the version the draft started from, and offers the latest when someone saved meanwhile', async () => {
    const calls: Record<string, unknown>[] = [];
    save = async (args) => {
      calls.push(args);
      throw new AppRpcError('TEMPLATE_CHANGED', 'TEMPLATE_CHANGED');
    };
    renderCard('owner');
    const { editor } = await openEditor('t1');
    expect((within(editor).getByLabelText('Line 2, English') as HTMLInputElement).value).toBe('Fill the beans');
    await userEvent.click(within(editor).getByRole('button', { name: 'Remove line 2' }));
    await userEvent.click(within(editor).getByRole('button', { name: 'Save the list' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ p_template_id: 't1', p_expected_version: 2, p_spec: { items: [{ text_en: 'Turn on the machine', text_ar: 'شغّل الماكينة' }] } });
    expect(await within(editor).findByRole('button', { name: 'Load the latest' })).toBeTruthy();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import type { StaffRole } from '../../lib/auth';

// The Daily checklists card on /protocols: what got done today, who ticked
// what, and the owner's editor. Staff tick on the phone; nothing here ticks.

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
    { role: 'barista', slot: 'open', name_en: 'Bar opening', name_ar: 'افتتاح البار', total: 2, done: 2, open_items: [] },
    { role: 'driver', slot: 'open', name_en: 'Driver opening', name_ar: 'افتتاح السائق', total: 3, done: 1, open_items: [{ text_en: 'Check the van', text_ar: 'افحص السيارة' }] },
  ],
};

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
      items: [
        { position: 1, text_en: 'Turn on the machine', text_ar: 'شغّل الماكينة' },
        { position: 2, text_en: 'Fill the beans', text_ar: 'املأ البن' },
      ],
      today: {
        run_id: 'r1',
        done: 1,
        total: 2,
        items: [
          { text_en: 'Turn on the machine', text_ar: 'شغّل الماكينة', done_by_name: 'Yusuf', done_at: '2026-09-25T05:10:00Z', note: null },
          { text_en: 'Fill the beans', text_ar: 'املأ البن', done_by_name: null, done_at: null, note: null },
        ],
      },
    },
    {
      template_id: 't2',
      role: 'barista',
      slot: 'close',
      name_en: 'Bar closing',
      name_ar: 'إغلاق البار',
      version: 1,
      items: [{ position: 1, text_en: 'Clean the steam wand', text_ar: 'نظّف أنبوب البخار', photo_required: true }],
      today: null,
    },
    {
      template_id: 't3',
      role: 'cashier',
      slot: 'close',
      name_en: 'Till closing',
      name_ar: 'إغلاق الصندوق',
      version: 4,
      items: [
        { position: 1, text_en: 'Wipe the counter', text_ar: 'امسح الكاونتر', photo_required: true },
        { position: 2, text_en: 'Empty the bin', text_ar: 'أفرغ السلة', photo_required: true },
      ],
      today: {
        run_id: 'r3',
        done: 1,
        total: 2,
        items: [
          { text_en: 'Wipe the counter', text_ar: 'امسح الكاونتر', done_by_name: 'Maha', done_at: '2026-09-25T19:40:00Z', note: null, photo_required: true, photo_path: 'v1/checklists/s2/counter.jpg' },
          { text_en: 'Empty the bin', text_ar: 'أفرغ السلة', done_by_name: null, done_at: null, note: null, photo_required: true, photo_path: null },
        ],
      },
    },
  ],
};

let save: (args: Record<string, unknown>) => Promise<unknown>;

function renderCard(as: StaffRole, state: unknown = dayState) {
  role = as;
  rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    if (fn === 'checklist_day_state') return state;
    if (fn === 'checklist_board') return board;
    if (fn === 'save_checklist_template') return save(args ?? {});
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

beforeEach(() => {
  rpc.mockReset();
  signed.mockClear();
  save = async () => ({ template_id: 'new', version: 1 });
});

describe('ChecklistsCard', () => {
  it('says how many lists are finished today, least done first, and asks for the business day', async () => {
    renderCard('manager');
    expect(await screen.findByText('1 of 2 lists finished today')).toBeTruthy();
    const rows = [...document.querySelectorAll('[data-list]')].map((r) => r.getAttribute('data-list'));
    expect(rows).toEqual(['driver:open', 'barista:open']);
    expect(rpc).toHaveBeenCalledWith('checklist_day_state', { p_business_date: '2026-09-25' });
  });

  it('shows the manager who ticked what, and gives the manager no editor', async () => {
    renderCard('manager');
    await screen.findByText('1 of 2 lists finished today');
    expect(screen.queryByRole('button', { name: 'Edit the lists' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'See today' }));
    const dialog = await screen.findByRole('dialog');
    const opening = await within(dialog).findByText('Bar opening');
    const section = opening.closest('section')!;
    expect(within(section).getByText(/^.Yusuf. · /)).toBeTruthy();
    expect(within(section).getByText('1 of 2')).toBeTruthy();
    // A list nobody opened today shows its lines untouched.
    const closing = within(dialog).getByText('Bar closing').closest('section')!;
    expect(within(closing).getByText('Nobody has opened this list today.')).toBeTruthy();
    expect(within(dialog).queryByRole('tab', { name: 'Edit the lists' })).toBeNull();
  });

  it('lets the owner write a new list in both languages, named after its role and slot', async () => {
    const calls: Record<string, unknown>[] = [];
    save = async (args) => {
      calls.push(args);
      return { template_id: 'new', version: 1 };
    };
    renderCard('owner', { business_date: '2026-09-25', lists: [] });
    await userEvent.click(await screen.findByRole('button', { name: 'Write a list' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(dialog.querySelector<HTMLButtonElement>('[data-pick="driver:close"]')!);
    const editor = await within(dialog).findByTestId('checklist-editor');
    expect(within(editor).getByText('Driver · Closing')).toBeTruthy();
    await userEvent.type(within(editor).getByLabelText('Line 1, English'), 'Fill the van');
    await userEvent.type(within(editor).getByLabelText('Line 1, Arabic'), 'املأ السيارة');
    await userEvent.click(within(editor).getByRole('button', { name: 'Save the list' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      p_venue_id: null,
      p_role: 'driver',
      p_slot: 'close',
      p_expected_version: 0,
      p_name_en: 'Driver: Closing',
      p_name_ar: 'سائق: الإغلاق',
      p_items: [{ text_en: 'Fill the van', text_ar: 'املأ السيارة', photo_required: false }],
    });
  });

  it('shows the manager which lines need a photo, and the photo of a ticked one', async () => {
    renderCard('manager');
    await userEvent.click(await screen.findByRole('button', { name: 'See today' }));
    const dialog = await screen.findByRole('dialog');
    const till = (await within(dialog).findByText('Till closing')).closest('section')!;
    // The line still to tick says it needs a photo; the ticked one shows it.
    const bin = till.querySelector('[data-line="2"]') as HTMLElement;
    expect(within(bin).getByText('Needs a photo')).toBeTruthy();
    const counter = till.querySelector('[data-line="1"]') as HTMLElement;
    expect(within(counter).queryByText('Needs a photo')).toBeNull();
    const thumb = within(counter).getByRole('button', { name: 'See the photo: Wipe the counter' });
    await waitFor(() => expect(signed).toHaveBeenCalledWith('v1/checklists/s2/counter.jpg'));
    // Pressed, it opens larger under its line, and closes the same way.
    await userEvent.click(thumb);
    expect(await within(counter).findByAltText('Photo for: Wipe the counter')).toBeTruthy();
    await userEvent.click(within(counter).getByRole('button', { name: 'Hide the photo: Wipe the counter' }));
    expect(within(counter).queryByAltText('Photo for: Wipe the counter')).toBeNull();
    // A list nobody opened today still says which of its lines need one.
    const closing = within(dialog).getByText('Bar closing').closest('section')!;
    expect(within(closing).getByText('Needs a photo')).toBeTruthy();
  });

  it('lets the owner mark a line "Needs a photo", and sends it with the list', async () => {
    const calls: Record<string, unknown>[] = [];
    save = async (args) => {
      calls.push(args);
      return { template_id: 't1', version: 3 };
    };
    renderCard('owner');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit the lists' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(dialog.querySelector<HTMLButtonElement>('[data-pick="barista:open"]')!);
    const editor = await within(dialog).findByTestId('checklist-editor');
    const switches = within(editor).getAllByRole('switch', { name: 'Needs a photo' });
    expect(switches.map((s) => s.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    await userEvent.click(switches[1]!);
    expect(within(editor).getByText(/Needs a photo: 1/)).toBeTruthy();
    await userEvent.click(within(editor).getByRole('button', { name: 'Save the list' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      p_role: 'barista',
      p_slot: 'open',
      p_expected_version: 2,
      p_items: [
        { text_en: 'Turn on the machine', text_ar: 'شغّل الماكينة', photo_required: false },
        { text_en: 'Fill the beans', text_ar: 'املأ البن', photo_required: true },
      ],
    });
  });

  it('opens a saved list with its photo lines switched on', async () => {
    renderCard('owner');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit the lists' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(dialog.querySelector<HTMLButtonElement>('[data-pick="cashier:close"]')!);
    const editor = await within(dialog).findByTestId('checklist-editor');
    expect(within(editor).getAllByRole('switch', { name: 'Needs a photo' }).map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'true']);
    // Nothing changed yet, so nothing to save.
    expect((within(editor).getByRole('button', { name: 'Save the list' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says a list keeps today’s lines only for a list someone opened today', async () => {
    renderCard('owner');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit the lists' }));
    const dialog = await screen.findByRole('dialog');
    const keeps = /today’s copy keeps its old lines/;
    // Bar opening was opened today (it has a run); Bar closing was not.
    await userEvent.click(dialog.querySelector<HTMLButtonElement>('[data-pick="barista:open"]')!);
    expect(within(await within(dialog).findByTestId('checklist-editor')).getByText(keeps)).toBeTruthy();
    await userEvent.click(dialog.querySelector<HTMLButtonElement>('[data-pick="barista:close"]')!);
    expect(within(await within(dialog).findByTestId('checklist-editor')).queryByText(keeps)).toBeNull();
  });

  it('refuses a line in one language before anything is sent', async () => {
    const calls: unknown[] = [];
    save = async (args) => {
      calls.push(args);
      return { template_id: 't1', version: 3 };
    };
    renderCard('owner');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit the lists' }));
    const dialog = await screen.findByRole('dialog');
    const editor = await within(dialog).findByTestId('checklist-editor');
    // The first list (Cashier · Opening) is not written yet.
    await userEvent.type(within(editor).getByLabelText('Line 1, English'), 'Count the float');
    await userEvent.click(within(editor).getByRole('button', { name: 'Save the list' }));
    expect(await within(editor).findByText('Write it in both English and Arabic.')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('sends the version the draft started from, and offers the latest when someone saved meanwhile', async () => {
    const calls: Record<string, unknown>[] = [];
    save = async (args) => {
      calls.push(args);
      throw new AppRpcError('TEMPLATE_CHANGED', 'TEMPLATE_CHANGED');
    };
    renderCard('owner');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit the lists' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(dialog.querySelector<HTMLButtonElement>('[data-pick="barista:open"]')!);
    const editor = await within(dialog).findByTestId('checklist-editor');
    expect((within(editor).getByLabelText('Line 2, English') as HTMLInputElement).value).toBe('Fill the beans');
    await userEvent.click(within(editor).getByRole('button', { name: 'Remove line 2' }));
    await userEvent.click(within(editor).getByRole('button', { name: 'Save the list' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ p_role: 'barista', p_slot: 'open', p_expected_version: 2, p_items: [{ text_en: 'Turn on the machine', text_ar: 'شغّل الماكينة' }] });
    expect(await within(editor).findByRole('button', { name: 'Load the latest' })).toBeTruthy();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { ConfirmProvider } from '../../components/ConfirmDialog';
import type { StaffRole } from '../../lib/auth';

// /protocols over a real query client (build-contracts-2026-09-23 §5.4): the
// cards and lists from the engine's reads, a run sheet with a decision that
// wants a reason, a start that sends its first step, and the owner's How it
// works with the fixed OK hidden. RPCs are mocked at appRpc, the router at its
// hooks; the two neighbouring cards (Daily checklists, Recipe changes) and the
// ideas line are their own lanes' and stubbed here.

const R1 = '0a000000-0000-4000-8000-000000000001';
const PROPOSE = '0b000000-0000-4000-8000-000000000001';
const TEST = '0b000000-0000-4000-8000-000000000002';
const ANALYSIS = '0b000000-0000-4000-8000-000000000003';
const MARKETING = '0b000000-0000-4000-8000-000000000004';
const LAUNCH = '0b000000-0000-4000-8000-000000000005';
const SUB = '0c000000-0000-4000-8000-000000000001';
const TPL = '0d000000-0000-4000-8000-000000000001';

let role: StaffRole = 'manager';
/** The venue's "Needs my OK" on New item › Proposal, as How it works saved it. */
let proposeOk = false;
const search: Record<string, string | undefined> = {};
const { navigateSpy, toastOk } = vi.hoisted(() => ({ navigateSpy: vi.fn(), toastOk: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy,
  useSearch: () => search,
}));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 'me', displayName: 'Me', role } }),
}));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: toastOk, info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return {
    supabase: { from: () => chain, storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://x.test/p' }, error: null }) }) } },
    supabaseUrl: '',
    supabaseAnonKey: '',
  };
});
vi.mock('../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchActiveCourts: vi.fn(async () => []),
}));
vi.mock('../checklists/ChecklistsCard', () => ({ ChecklistsCard: () => <section data-testid="checklists-card" /> }));
vi.mock('../roleExtras/Ideas', () => ({ IdeasFromTeamButton: () => null }));
vi.mock('../roleExtras/RecipeChanges', () => ({ RecipeChangesCard: () => <section data-testid="recipe-changes-card" /> }));

import { appRpc } from '../../lib/appRpc';
import { ProtocolsPageScreen } from './ProtocolsPage';

const rpc = vi.mocked(appRpc);

const tpl = (kind: string, variant: string | null, running: number, waiting: number) => ({
  template_id: kind === 'product_release' ? TPL : `${kind}-${variant ?? ''}`,
  kind,
  variant,
  name_en: kind,
  name_ar: kind,
  version: 3,
  running,
  waiting_on_me: waiting,
  finished_30d: 0,
});

const runRow = {
  id: R1,
  kind: 'product_release',
  variant: null,
  title_en: 'Rose latte',
  title_ar: null,
  status: 'active',
  started_by: 'u-rusul',
  started_by_name: 'Rusul',
  started_at: '2026-09-24T09:00:00Z',
  finished_at: null,
  scheduled_for: null,
  live_at: null,
  menu_item_id: null,
  promotion_id: null,
  current_steps: [{ id: PROPOSE, position: 1, step_key: 'propose', name_en: 'Proposal', name_ar: 'الاقتراح', status: 'submitted', round: 1 }],
  waiting_on_me: true,
};

const stepRow = (id: string, position: number, key: string, name: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  position,
  step_key: key,
  name_en: name,
  name_ar: `ع ${name}`,
  status,
  round: 1,
  actor_roles: key === 'launch' ? ['owner'] : key === 'analysis' ? ['manager'] : key === 'marketing' ? ['marketing'] : ['head_barista', 'head_chef'],
  assigned_to: null,
  assigned_to_name: null,
  needs_owner_ok: key === 'analysis' || key === 'marketing',
  optional: false,
  after_keys: [],
  opened_at: null,
  passed_at: null,
  skip_note: null,
  skipped_by_name: null,
  skipped_at: null,
  items: [],
  submissions: [],
  ...extra,
});

const proposal = {
  id: SUB,
  round: 1,
  submitted_by: 'u-rusul',
  submitted_by_name: 'Rusul',
  submitted_at: '2026-09-24T09:00:00Z',
  record: { name_en: 'Rose latte', item_kind: 'drink', lines: [{ label: 'Rose syrup', qty: 20, unit: 'ml' }], sizes: [{ name_en: 'Regular' }], notes: 'For spring' },
  photos: [],
  withdrawn_at: null,
  superseded_at: null,
  decision: null,
  decided_by: null,
  decided_by_name: null,
  decided_at: null,
  decision_note: null,
  send_back_to: null,
};

const steps = [
  stepRow(PROPOSE, 1, 'propose', 'Proposal', 'submitted', { submissions: [proposal] }),
  stepRow(TEST, 2, 'test', 'Test', 'waiting', { after_keys: ['propose'] }),
  stepRow(ANALYSIS, 3, 'analysis', 'Price', 'waiting', { after_keys: ['test'] }),
  stepRow(MARKETING, 4, 'marketing', 'Marketing', 'waiting', { after_keys: ['test'] }),
  stepRow(LAUNCH, 5, 'launch', 'Launch', 'waiting', { after_keys: ['analysis', 'marketing'] }),
];

const noCan = { submit: false, withdraw_submission_id: null, decide_submission_id: null, send_back_targets: [], skip: false, tick: false, edit_items: false, add_step: false, stop: false, withdraw_run: false, cancel_schedule: false };

const defs = [
  { step_key: 'propose', after: [], fixed: 'first', ok_fixed: false, actor_roles: ['head_barista', 'head_chef'], needs_owner_ok: false },
  { step_key: 'test', after: ['propose'], fixed: null, ok_fixed: false, actor_roles: ['head_barista', 'head_chef'], needs_owner_ok: false },
  { step_key: 'analysis', after: ['test'], fixed: null, ok_fixed: true, actor_roles: ['manager'], needs_owner_ok: true },
  { step_key: 'marketing', after: ['test'], fixed: null, ok_fixed: false, actor_roles: ['marketing'], needs_owner_ok: true },
  { step_key: 'launch', after: ['analysis', 'marketing'], fixed: 'last', ok_fixed: true, actor_roles: ['owner'], needs_owner_ok: false },
];

beforeEach(() => {
  role = 'manager';
  proposeOk = false;
  for (const k of Object.keys(search)) delete search[k];
  navigateSpy.mockReset();
  toastOk.mockReset();
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    switch (fn) {
      case 'protocols_overview':
        return { templates: [tpl('product_release', null, 2, 1), tpl('tournament', 'type1', 1, 0), tpl('tournament', 'type2', 0, 0), tpl('tournament', 'type3', 0, 0), tpl('hiring', null, 0, 0), tpl('price_promo', null, 0, 0)] };
      case 'protocol_runs_page':
        return args?.p_filter === 'waiting' ? { runs: [runRow], total: 1 } : { runs: [], total: 0 };
      case 'protocol_run_detail':
        return { run: { ...runRow, template_name_en: 'New item', template_name_ar: 'صنف جديد', data: {} }, steps, can: { ...noCan, stop: true } };
      case 'protocol_step_detail': {
        const s = steps.find((x) => x.id === args?.p_run_step_id) ?? steps[0]!;
        const can = s.id === PROPOSE ? { ...noCan, decide_submission_id: SUB, send_back_targets: [PROPOSE], stop: true } : { ...noCan, stop: true };
        return { run: { ...runRow, data: {} }, step: s, can, def: defs.find((d) => d.step_key === s.step_key) };
      }
      case 'protocol_template_detail':
        if (args?.p_template_id === 'hiring-') {
          return {
            template: { id: 'hiring-', kind: 'hiring', variant: null, name_en: 'Hiring', name_ar: 'توظيف', version: 1, updated_at: null, updated_by_name: null },
            steps: [{ position: 1, step_key: 'open_position', name_en: 'Open position', name_ar: 'الوظيفة', actor_roles: ['manager', 'owner'], needs_owner_ok: true, optional: false, items: [] }],
            defs: [],
          };
        }
        return {
          template: { id: TPL, kind: 'product_release', variant: null, name_en: 'New item', name_ar: 'صنف جديد', version: 3, updated_at: '2026-09-20T10:00:00Z', updated_by_name: 'Owner' },
          steps: steps.map((s) => ({
            position: s.position,
            step_key: s.step_key,
            name_en: s.name_en,
            name_ar: s.name_ar,
            actor_roles: s.actor_roles,
            needs_owner_ok: s.step_key === 'propose' ? proposeOk : s.needs_owner_ok,
            optional: false,
            items: [],
          })),
          defs,
        };
      case 'decide_step':
        return { submission_id: SUB, decision: args?.p_decision, step_status: 'open', run_status: 'active', opened_step_ids: [] };
      case 'start_protocol':
        return { run_id: R1, status: 'active', first_step_id: PROPOSE, submission_id: SUB, auto: false };
      case 'save_protocol_template':
        return { template_id: TPL, version: 4 };
      case 'staff_ingredient_options':
        return { ingredients: [] };
      default:
        return null;
    }
  });
});

function renderPage(locale: 'en' | 'ar' = 'en') {
  try {
    localStorage.setItem('touch-operator-locale', locale);
  } catch {
    /* no storage */
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <ConfirmProvider>
          <ProtocolsPageScreen />
        </ConfirmProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

describe('/protocols', () => {
  it('shows the four protocols with their counts, then what waits on you, and opens a run from the list', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Protocols' })).toBeTruthy();
    const release = await screen.findByTestId('protocol-card-product_release');
    await waitFor(() => expect(within(release).getByText('2 running')).toBeTruthy());
    expect(within(release).getByRole('button', { name: '1 waiting on you' })).toBeTruthy();
    // A tournament's three types are one card.
    expect(within(screen.getByTestId('protocol-card-tournament')).getByText('1 running')).toBeTruthy();
    expect(screen.getByTestId('checklists-card')).toBeTruthy();
    expect(screen.getByTestId('recipe-changes-card')).toBeTruthy();
    // How it works is the owner's.
    expect(screen.queryByRole('button', { name: 'How it works' })).toBeNull();

    const row = await screen.findByText('Rose latte');
    // The row says it waits on the reader.
    expect(within(row.closest('tr')!).getByText('Waiting on you')).toBeTruthy();
    await user.click(row);
    expect(navigateSpy).toHaveBeenCalledWith(expect.objectContaining({ to: '/protocols' }));
    const next = navigateSpy.mock.calls.at(-1)![0].search({ filter: 'waiting' });
    expect(next).toEqual({ filter: 'waiting', run: R1 });
  });

  it('opens a run, and a send-back wants a reason and a place to go before it is sent', async () => {
    const user = userEvent.setup();
    search.run = R1;
    renderPage();
    const sheet = await screen.findByTestId('run-sheet');
    expect(within(sheet).getAllByTestId('run-step')).toHaveLength(5);
    const panel = await screen.findByTestId('step-panel');
    expect(within(panel).getByText('Rose latte')).toBeTruthy();
    expect(within(panel).getByText(/For spring/)).toBeTruthy();

    await user.click(within(panel).getByTestId('decide'));
    const dialog = await screen.findByRole('dialog', { name: /Decide: Proposal/ });
    await user.click(within(dialog).getByRole('button', { name: 'Send back for changes' }));
    await user.click(within(dialog).getByTestId('decision-send'));
    expect(within(dialog).getByText('A reason is required.')).toBeTruthy();
    expect(rpc).not.toHaveBeenCalledWith('decide_step', expect.anything());

    await user.type(within(dialog).getByRole('textbox'), 'Name the syrup brand');
    await user.click(within(dialog).getByTestId('decision-send'));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('decide_step', {
        p_submission_id: SUB,
        p_decision: 'send_back',
        p_note: 'Name the syrup brand',
        p_send_back_to: PROPOSE,
        p_data: {},
      }),
    );
    expect(toastOk).toHaveBeenCalledWith('Sent back.');
  });

  it('approving a proposal asks for the cafe section its draft is filed in', async () => {
    const user = userEvent.setup();
    search.run = R1;
    renderPage();
    const panel = await screen.findByTestId('step-panel');
    await user.click(within(panel).getByTestId('decide'));
    const dialog = await screen.findByRole('dialog', { name: /Decide: Proposal/ });
    expect(within(dialog).getByText('Menu category for the new item')).toBeTruthy();
    await user.click(within(dialog).getByTestId('decision-send'));
    expect(rpc).not.toHaveBeenCalledWith('decide_step', expect.anything());
  });

  it('starts a hiring with its open position, which goes to the owner', async () => {
    const user = userEvent.setup();
    search.start = 'hiring';
    renderPage();
    const sheet = await screen.findByTestId('start-sheet');
    expect(await within(sheet).findByText('Starting sends this first step for a decision.')).toBeTruthy();

    // Nothing filled: marked, not sent.
    await user.click(screen.getByTestId('start-send'));
    expect(await within(sheet).findByText('Check the marked fields.')).toBeTruthy();
    expect(rpc).not.toHaveBeenCalledWith('start_protocol', expect.anything());

    await user.type(within(sheet).getByTestId('title-en'), 'A second barista');
    await user.click(within(sheet).getByRole('combobox', { name: 'Role' }));
    await user.click(await screen.findByRole('option', { name: 'Barista' }));
    const textareas = within(sheet).getAllByRole('textbox').filter((el) => el.tagName === 'TEXTAREA');
    await user.type(textareas[0]!, 'Weekend mornings are short');
    await user.type(textareas[1]!, 'Fri and Sat, 7 to 3');
    fireEvent.change(sheet.querySelector('input[type="date"]')!, { target: { value: '2026-10-15' } });
    await user.click(screen.getByTestId('start-send'));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('start_protocol', expect.objectContaining({ p_kind: 'hiring', p_variant: null, p_title_en: 'A second barista', p_title_ar: null })));
    const args = rpc.mock.calls.find(([fn]) => fn === 'start_protocol')![1] as Record<string, unknown>;
    expect(args.p_first_record).toEqual({ role: 'barista', why: 'Weekend mornings are short', hours: 'Fri and Sat, 7 to 3', start_date: '2026-10-15' });
    expect(String(args.p_idempotency_key)).toMatch(/^protocol\.start:/);
    expect(toastOk).toHaveBeenCalledWith('Started.');
    // The new run opens.
    const next = navigateSpy.mock.calls.at(-1)![0].search({ start: 'hiring' });
    expect(next).toEqual({ run: R1 });
  });

  it('says who decides a new item’s proposal from the venue’s template, not the built-in default', async () => {
    search.start = 'product_release';
    const first = renderPage();
    let sheet = await screen.findByTestId('start-sheet');
    // Default: the manager decides the proposal, so it passes at once and asks for the menu section.
    expect(await within(sheet).findByText('You decide this first step, so it passes as soon as you start.')).toBeTruthy();
    expect(within(sheet).getByText('Menu category')).toBeTruthy();
    first.unmount();

    // The owner turned "Needs my OK" on for it: the manager's start waits for the owner.
    proposeOk = true;
    renderPage();
    sheet = await screen.findByTestId('start-sheet');
    expect(await within(sheet).findByText('Starting sends this first step for a decision.')).toBeTruthy();
    expect(within(sheet).queryByText('You decide this first step, so it passes as soon as you start.')).toBeNull();
    expect(within(sheet).queryByText('Menu category')).toBeNull();
    expect(rpc).toHaveBeenCalledWith('protocol_template_detail', { p_template_id: TPL });
  });

  it('gives the owner How it works: the fixed OK is hidden, and a step of their own is saved above the launch', async () => {
    const user = userEvent.setup();
    role = 'owner';
    renderPage();
    await user.click(await screen.findByTestId('how-product_release'));
    const how = await screen.findByTestId('how-it-works');
    const rows = await within(how).findAllByTestId('how-step');
    expect(rows).toHaveLength(5);
    const byKey = (k: string) => rows.find((r) => r.getAttribute('data-step') === k)!;
    expect(within(byKey('analysis')).getByTestId('ok-fixed').textContent).toBe('Always needs your OK');
    expect(within(byKey('launch')).getByTestId('ok-fixed').textContent).toBe('You do this step');
    expect(within(byKey('test')).getByRole('switch', { name: 'Needs my OK' })).toBeTruthy();
    expect(within(byKey('analysis')).queryByRole('switch', { name: 'Needs my OK' })).toBeNull();

    await user.click(within(how).getByRole('button', { name: 'Add a step of your own' }));
    const mine = within(how).getAllByTestId('how-step').find((r) => r.getAttribute('data-step') === 'own')!;
    await user.type(within(mine).getByRole('textbox', { name: 'Step name (English)' }), 'Tasting');
    await user.type(within(mine).getByRole('textbox', { name: 'Step name (Arabic)' }), 'تذوق');
    await user.click(within(how).getByTestId('how-save'));
    const confirm = await screen.findByRole('dialog', { name: 'Save how it works?' });
    await user.click(within(confirm).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('save_protocol_template', expect.objectContaining({ p_template_id: TPL, p_expected_version: 3 })));
    const body = rpc.mock.calls.find(([fn]) => fn === 'save_protocol_template')![1] as { p_steps: Array<Record<string, unknown>> };
    expect(body.p_steps.map((s) => s.step_key)).toEqual(['propose', 'test', 'analysis', 'marketing', null, 'launch']);
    expect(body.p_steps[4]).toMatchObject({ name_en: 'Tasting', name_ar: 'تذوق', actor_roles: ['manager'] });
  });

  it('sends the interviews as the candidates list says, by id, once one is picked', async () => {
    const user = userEvent.setup();
    const H1 = '0a000000-0000-4000-8000-000000000009';
    const OPEN = '0b000000-0000-4000-8000-000000000011';
    const INTERVIEWS = '0b000000-0000-4000-8000-000000000012';
    const HIRE = '0b000000-0000-4000-8000-000000000013';
    const C1 = '0e000000-0000-4000-8000-000000000001';
    const C2 = '0e000000-0000-4000-8000-000000000002';
    let picked = false;
    const hiring = { ...runRow, id: H1, kind: 'hiring', title_en: 'Weekend barista', current_steps: [] };
    const hiringSteps = [
      stepRow(OPEN, 1, 'open_position', 'Open position', 'passed', { actor_roles: ['manager'] }),
      stepRow(INTERVIEWS, 2, 'interviews', 'Interviews and pick', 'open', { actor_roles: ['manager'], needs_owner_ok: true }),
      stepRow(HIRE, 3, 'add_staff', 'Add staff', 'waiting', { actor_roles: ['owner'] }),
    ];
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
      switch (fn) {
        case 'protocol_run_detail':
          return { run: { ...hiring, template_name_en: 'Hiring', template_name_ar: 'توظيف', data: {} }, steps: hiringSteps, can: { ...noCan, stop: true } };
        case 'protocol_step_detail': {
          const st = hiringSteps.find((x) => x.id === args?.p_run_step_id) ?? hiringSteps[1]!;
          return { run: { ...hiring, data: {} }, step: st, can: st.id === INTERVIEWS ? { ...noCan, submit: true } : noCan, def: null };
        }
        case 'hiring_candidates':
          return {
            purged: false,
            candidates: [
              { id: C1, candidate_name: 'Ali', candidate_phone: '0770', brief: '', interview_at: null, picked: false, pick_reason: null },
              { id: C2, candidate_name: 'Sara', candidate_phone: '0780', brief: '', interview_at: null, picked, pick_reason: null },
            ],
          };
        case 'save_hiring_candidate':
          picked = true;
          return { id: C2 };
        case 'submit_step':
          return { submission_id: SUB, auto: false, step_status: 'submitted', run_status: 'active', opened_step_ids: [] };
        default:
          return base(fn as Parameters<typeof base>[0], args);
      }
    });
    search.run = H1;
    search.step = INTERVIEWS;
    renderPage();
    const form = await screen.findByTestId('step-form');
    // Nobody picked yet: Send waits for a pick.
    await waitFor(() => expect(within(form).getByTestId('interviews-state').textContent).toBe('Pick the candidate you want to hire first.'));
    expect((within(form).getByTestId('step-send') as HTMLButtonElement).disabled).toBe(true);

    const list = screen.getByTestId('candidates');
    await user.click(within(list).getAllByRole('button', { name: 'Pick' })[1]!);
    await waitFor(() => expect(within(form).getByTestId('interviews-state').textContent).toMatch(/Sends 2 candidates, with .*Sara.* picked/));
    await user.click(within(form).getByTestId('step-send'));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('submit_step', expect.objectContaining({ p_run_step_id: INTERVIEWS, p_record: { candidate_ids: [C1, C2], picked_id: C2 } })));
    // The record carries ids only; the names stay in the list.
    const sent = rpc.mock.calls.find(([fn]) => fn === 'submit_step')![1] as Record<string, unknown>;
    expect(JSON.stringify(sent.p_record)).not.toContain('Sara');
  });

  it('reads in Arabic', async () => {
    renderPage('ar');
    expect(screen.getByRole('heading', { level: 1, name: 'البروتوكولات' })).toBeTruthy();
    const release = await screen.findByTestId('protocol-card-product_release');
    await waitFor(() => expect(within(release).getByText('2 قيد التنفيذ')).toBeTruthy());
    expect(within(release).getByText('صنف جديد')).toBeTruthy();
  });
});

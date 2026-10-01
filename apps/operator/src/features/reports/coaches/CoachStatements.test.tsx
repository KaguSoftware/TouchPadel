import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';

// Coach pay at /reports/coaches (coaching operator.md §5.16, §5.21): the list
// of a month's statements and the statement dialog, against the shapes
// COACHING_SHAPES names, with app RPCs mocked at appRpc so what each action
// SENDS is what is asserted.

const navigate = vi.fn();
const search: { current: Record<string, unknown> } = { current: {} };
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useSearch: () => search.current,
}));
vi.mock('../../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));
vi.mock('../../../lib/idem', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deviceId: () => 'DESK-1',
}));
const toast = { ok: vi.fn(), err: vi.fn(), info: vi.fn() };
vi.mock('../../../components/toast', () => ({ useToast: () => toast }));
const venue = { branchId: 'venue-a' as string | null };
vi.mock('../../../lib/venue', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useVenue: () => ({
    venues: [],
    branchId: venue.branchId,
    current: null,
    stationBranchId: null,
    canSwitch: false,
    setBranch: () => undefined,
  }),
}));
const role = { current: 'manager' };
vi.mock('../../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { role: role.current } }),
}));

import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { CoachStatementsScreen } from './CoachStatements';

const rpc = vi.mocked(appRpc);
const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '');

function statement(over: Record<string, unknown> = {}) {
  return {
    statement_id: 's1',
    coach_id: 'c1',
    coach_name_en: 'Sara',
    coach_name_ar: 'سارة',
    venue_id: 'venue-a',
    venue_name_en: 'Mansour',
    venue_name_ar: 'المنصور',
    status: 'draft',
    lessons_count: 4,
    collected_iqd: 200000,
    court_share_iqd: 40000,
    coach_iqd: 96000,
    adjustments_iqd: 0,
    total_iqd: 96000,
    payable_iqd: 96000,
    drafted_at: '2026-10-01T00:05:00Z',
    refreshed_at: null,
    approved_at: null,
    approved_by_name: null,
    paid_at: null,
    paid_by_name: null,
    paid_reference: null,
    voided_at: null,
    void_reason: null,
    ...over,
  };
}

const TOTALS = {
  statements: 2,
  collected_iqd: 320000,
  court_share_iqd: 60000,
  coach_iqd: 156000,
  adjustments_iqd: -6000,
  total_iqd: 150000,
  payable_iqd: 150000,
  approved_unpaid_iqd: 54000,
  unpaid_iqd: 150000,
  paid_iqd: 0,
};

function list(statements: unknown[], over: Record<string, unknown> = {}) {
  return {
    month: '2026-10-01',
    current_month: '2026-10-01',
    server_now: '2026-10-05T10:00:00Z',
    statements,
    missing: [],
    totals: TOTALS,
    ...over,
  };
}

function line(over: Record<string, unknown> = {}) {
  return {
    line_id: 'l1',
    lesson_id: 'lesson-1',
    start_at: '2026-10-02T15:00:00Z',
    kind: 'group',
    type_name_en: 'Beginners',
    type_name_ar: 'مبتدئون',
    course_id: null,
    course_title_en: null,
    course_title_ar: null,
    session_no: null,
    lesson_status: 'completed',
    is_adjustment: false,
    collected_iqd: 100000,
    court_share_iqd: 20000,
    share_bp: 6000,
    coach_iqd: 48000,
    enrolments: 4,
    attended: 3,
    no_shows: 1,
    ...over,
  };
}

const ALL_CAN = { refresh: true, approve: true, void: true, mark_paid: true };

function detail(st: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return {
    statement: st,
    stale: false,
    can: ALL_CAN,
    coach_booked_no_shows: [],
    lines: [line()],
    ...over,
  };
}

let listPayload: unknown;
let details: Record<string, unknown>;
let writes: Record<string, unknown>;

function mount() {
  rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    if (fn === 'report_coach_statements') {
      if (listPayload instanceof Error) throw listPayload;
      return listPayload;
    }
    if (fn === 'coach_statement_detail') return details[String(args?.p_statement_id)];
    if (fn in writes) {
      const w = writes[fn];
      if (w instanceof Error) throw w;
      return w;
    }
    throw new Error(`unexpected ${fn}`);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <CoachStatementsScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const callsOf = (fn: string) => rpc.mock.calls.filter(([name]) => name === fn);

async function openStatement(coach: string) {
  const user = userEvent.setup();
  const table = await screen.findByRole('table', { name: 'Statements' });
  await user.click(within(table).getByText(coach));
  const dialog = await screen.findByRole('dialog', { name: new RegExp(coach) });
  await within(dialog).findByTestId('statement.figures');
  return { user, dialog };
}

beforeEach(() => {
  rpc.mockReset();
  navigate.mockReset();
  toast.ok.mockReset();
  search.current = {};
  venue.branchId = 'venue-a';
  role.current = 'manager';
  listPayload = list([statement()]);
  details = { s1: detail(statement()) };
  writes = {};
});

describe('Coach pay: the month', () => {
  it('reads the current month with no month sent, and shows its figures and rows', async () => {
    listPayload = list([
      statement(),
      statement({
        statement_id: 's2',
        coach_name_en: 'Omar',
        status: 'approved',
        adjustments_iqd: -6000,
      }),
    ]);
    mount();
    const table = await screen.findByRole('table', { name: 'Statements' });
    expect(callsOf('report_coach_statements')[0]![1]).toEqual({});
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeTruthy();
    const band = screen.getByTestId('coachPay.totals');
    expect(within(band).getByText('Collected')).toBeTruthy();
    expect(within(band).getByText('320,000 IQD')).toBeTruthy();
    expect(within(band).getByText('Approved, not paid')).toBeTruthy();
    expect(within(table).getByText('Draft')).toBeTruthy();
    expect(within(table).getByText('Approved')).toBeTruthy();
    expect(plain(table.textContent)).toContain('-6,000 IQD');
    // One branch on screen: no branch column.
    expect(within(table).queryByRole('columnheader', { name: 'Branch' })).toBeNull();
    // The stepper never passes the current month.
    expect((screen.getByTestId('coachPay.month.next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('steps back through ?month=, and the asked month is read', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('table', { name: 'Statements' });
    await user.click(screen.getByTestId('coachPay.month.prev'));
    expect(navigate).toHaveBeenCalledWith({
      to: '/reports/coaches',
      search: { month: '2026-09-01' },
      replace: true,
    });
  });

  it('an earlier month with nothing says so, and the current month explains when statements come', async () => {
    search.current = { month: '2026-08-01' };
    listPayload = list([], { month: '2026-08-01' });
    mount();
    expect(await screen.findByText('No statements for August 2026.')).toBeTruthy();
    expect(
      callsOf('report_coach_statements').some(
        ([, a]) => (a as Record<string, unknown>).p_month === '2026-08-01',
      ),
    ).toBe(true);
  });

  it('the current month, empty, says statements are drafted on the 1st', async () => {
    listPayload = list([]);
    mount();
    expect(
      await screen.findByText('Statements are drafted on the 1st for the month before.'),
    ).toBeTruthy();
  });

  it('lists the coaches not drafted yet', async () => {
    listPayload = list([statement()], {
      missing: [
        {
          coach_id: 'c2',
          coach_name_en: 'Omar',
          coach_name_ar: 'عمر',
          venue_id: 'venue-a',
          reason: 'not_drafted',
        },
        {
          coach_id: 'c3',
          coach_name_en: 'Lina',
          coach_name_ar: 'لينا',
          venue_id: 'venue-a',
          reason: 'older_draft',
        },
      ],
    });
    mount();
    const missing = await screen.findByTestId('coachPay.missing');
    expect(plain(missing.textContent)).toContain('Omar: not drafted yet');
    expect(plain(missing.textContent)).toContain("Lina: waits for an older month's draft");
  });

  it('on a server without statements, says coaching needs an update', async () => {
    listPayload = new AppRpcError('RPC_MISSING', 'missing');
    mount();
    expect(
      await screen.findByText("Coaching needs a server update that isn't there yet."),
    ).toBeTruthy();
  });

  it("R21: another branch's rows are read-only under All branches, with the branch column", async () => {
    const user = userEvent.setup();
    listPayload = list([
      statement(),
      statement({
        statement_id: 's9',
        coach_name_en: 'Hiba',
        venue_id: 'venue-b',
        venue_name_en: 'Zayouna',
      }),
    ]);
    mount();
    const mine = await screen.findByRole('table', { name: 'Statements' });
    expect(within(mine).getByRole('columnheader', { name: 'Branch' })).toBeTruthy();
    const others = screen.getByTestId('coachPay.otherBranches');
    expect(plain(others.textContent)).toContain('Switch to Zayouna to approve or pay.');
    await user.click(within(others).getByText('Hiba'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(callsOf('coach_statement_detail')).toHaveLength(0);
  });
});

describe('Coach pay: the statement dialog', () => {
  it('a draft is approved after a confirm, with no PIN (R4)', async () => {
    writes.coach_statement_approve = {
      statement_id: 's1',
      status: 'approved',
      next_statement_id: null,
    };
    mount();
    const { user, dialog } = await openStatement('Sara');
    expect(callsOf('coach_statement_detail')[0]![1]).toEqual({ p_statement_id: 's1' });
    await user.click(within(dialog).getByTestId('statement.action.approve'));
    const confirm = await screen.findByRole('dialog', {
      name: /Approve .*Sara.*statement for October 2026/,
    });
    expect(
      within(confirm).getByText("It can't change after this, except by voiding it."),
    ).toBeTruthy();
    await user.click(within(confirm).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(callsOf('coach_statement_approve')).toHaveLength(1));
    expect(callsOf('coach_statement_approve')[0]![1]).toEqual({ p_statement_id: 's1' });
    expect(callsOf('verify_manager_pin')).toHaveLength(0);
    expect(screen.queryByLabelText(/^PIN/)).toBeNull();
    expect(toast.ok).toHaveBeenCalledWith('Statement approved.');
  });

  it('Recount sends a refresh of this statement', async () => {
    writes.coach_statement_refresh = { statement_id: 's1', status: 'draft', created: false };
    details.s1 = detail(statement(), { stale: true });
    mount();
    const { user, dialog } = await openStatement('Sara');
    expect(
      within(dialog).getByText(
        'Lessons changed since this draft was counted. Recount to include them.',
      ),
    ).toBeTruthy();
    await user.click(within(dialog).getByTestId('statement.action.recount'));
    await waitFor(() => expect(callsOf('coach_statement_refresh')).toHaveLength(1));
    expect(callsOf('coach_statement_refresh')[0]![1]).toEqual({ p_statement_id: 's1' });
  });

  it('Mark paid refuses a card number, then sends the reference, the PIN and this station (R4, R49)', async () => {
    const approved = statement({
      statement_id: 's2',
      status: 'approved',
      approved_at: '2026-10-02T09:00:00Z',
      approved_by_name: 'Maha',
    });
    listPayload = list([approved]);
    details.s2 = detail(approved);
    writes.coach_statement_mark_paid = {
      duplicate: false,
      statement_id: 's2',
      status: 'paid',
      paid_at: '2026-10-05T10:00:00Z',
      total_iqd: 96000,
    };
    mount();
    const { user, dialog } = await openStatement('Sara');
    expect(plain(within(dialog).getByTestId('statement.history').textContent)).toContain(
      'Approved',
    );
    await user.click(within(dialog).getByTestId('statement.action.markPaid'));
    const pay = await screen.findByRole('dialog', { name: 'Mark paid' });
    expect(
      within(pay).getByText(
        'Records that the money was handed over. Nothing is taken from the drawer.',
      ),
    ).toBeTruthy();
    const reference = within(pay).getByRole('textbox', { name: /Payment reference/ });
    await user.type(reference, '4111 1111 1111 1111');
    await user.click(within(pay).getByTestId('markPaid.next'));
    expect(
      await within(pay).findByText(
        "A card or account number can't go here. Use a receipt or transfer number.",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/^PIN/)).toBeNull();
    await user.clear(reference);
    await user.type(reference, 'Receipt 4471');
    await user.click(within(pay).getByTestId('markPaid.next'));
    await user.type(await screen.findByLabelText(/^PIN/), '4821');
    await user.click(screen.getByRole('button', { name: 'Authorise' }));
    await waitFor(() => expect(callsOf('coach_statement_mark_paid')).toHaveLength(1));
    expect(callsOf('coach_statement_mark_paid')[0]![1]).toEqual({
      p_statement_id: 's2',
      p_reference: 'Receipt 4471',
      p_pin: '4821',
      p_device_id: 'DESK-1',
    });
    expect(toast.ok).toHaveBeenCalledWith('Marked paid.');
  });

  it('a statement below zero cannot be marked paid, and says why (R59)', async () => {
    const negative = statement({
      statement_id: 's3',
      status: 'approved',
      total_iqd: -12000,
      payable_iqd: -12000,
      adjustments_iqd: -60000,
    });
    listPayload = list([negative]);
    details.s3 = detail(negative);
    mount();
    const { dialog } = await openStatement('Sara');
    expect(
      (within(dialog).getByTestId('statement.action.markPaid') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(plain(dialog.textContent)).toContain(
      'This statement is below zero (-12,000 IQD). Void it; the next statement carries it.',
    );
    // Void stays open.
    expect(
      (within(dialog).getByTestId('statement.action.void') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('a void from approved asks the PIN and sends it; a void from draft does not (R59, R70)', async () => {
    const approved = statement({ statement_id: 's2', status: 'approved', coach_name_en: 'Omar' });
    listPayload = list([statement(), approved]);
    details.s2 = detail(approved);
    writes.coach_statement_void = { statement_id: 's2', status: 'void' };
    mount();
    const { user, dialog } = await openStatement('Sara');
    // The draft (s1) is voided with a reason alone.
    await user.click(within(dialog).getByTestId('statement.action.void'));
    let voidDialog = await screen.findByRole('dialog', { name: 'Void statement' });
    expect(within(voidDialog).queryByText(/Voiding it needs a manager PIN/)).toBeNull();
    await user.type(within(voidDialog).getByRole('textbox', { name: /Reason/ }), 'Counted twice');
    await user.click(within(voidDialog).getByTestId('void.confirm'));
    await waitFor(() => expect(callsOf('coach_statement_void')).toHaveLength(1));
    expect(callsOf('coach_statement_void')[0]![1]).toEqual({
      p_statement_id: 's1',
      p_reason: 'Counted twice',
    });
    expect(screen.queryByLabelText(/^PIN/)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: /Close/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Sara/ })).toBeNull());

    // The approved one (s2) asks the PIN.
    const table = screen.getByRole('table', { name: 'Statements' });
    await user.click(within(table).getByText('Omar'));
    const second = await screen.findByRole('dialog', { name: /Omar/ });
    await within(second).findByTestId('statement.action.markPaid');
    await user.click(within(second).getByTestId('statement.action.void'));
    voidDialog = await screen.findByRole('dialog', { name: 'Void statement' });
    expect(within(voidDialog).getByText(/Voiding it needs a manager PIN/)).toBeTruthy();
    await user.type(within(voidDialog).getByRole('textbox', { name: /Reason/ }), 'Wrong month');
    await user.click(within(voidDialog).getByTestId('void.confirm'));
    await user.type(await screen.findByLabelText(/^PIN/), '4821');
    await user.click(screen.getByRole('button', { name: 'Authorise' }));
    await waitFor(() => expect(callsOf('coach_statement_void')).toHaveLength(2));
    expect(callsOf('coach_statement_void')[1]![1]).toEqual({
      p_statement_id: 's2',
      p_reason: 'Wrong month',
      p_pin: '4821',
      p_device_id: 'DESK-1',
    });
  });

  it("the caller's own statement offers nothing and says who settles it (CM-11)", async () => {
    details.s1 = detail(statement(), {
      can: { refresh: false, approve: false, void: false, mark_paid: false },
    });
    mount();
    const { dialog } = await openStatement('Sara');
    expect(
      within(dialog).getByText(
        'This is your own statement. Another manager or the owner approves and pays it.',
      ),
    ).toBeTruthy();
    expect(within(dialog).queryByTestId('statement.action.approve')).toBeNull();
  });

  it('marks adjustment lines, lists coach-booked no-shows, and a line opens its lesson', async () => {
    details.s1 = detail(statement(), {
      lines: [
        line(),
        line({
          line_id: 'l2',
          lesson_id: 'lesson-2',
          is_adjustment: true,
          collected_iqd: -20000,
          coach_iqd: -12000,
          kind: 'course',
          course_title_en: 'Autumn',
          session_no: 3,
        }),
      ],
      coach_booked_no_shows: [
        { lesson_id: 'lesson-7', start_at: '2026-10-03T16:00:00Z', student_label: 'Ali Hasan' },
      ],
    });
    mount();
    const { user, dialog } = await openStatement('Sara');
    const lines = within(dialog).getByRole('table', { name: 'Lessons on this statement' });
    expect(within(lines).getByText('Adjustment')).toBeTruthy();
    expect(plain(lines.textContent)).toContain('Autumn · Session 3');
    expect(plain(lines.textContent)).toContain('-20,000 IQD');
    expect(plain(lines.textContent)).toContain('60.0%');
    expect(
      within(dialog).getByText(
        'This lesson was on an approved statement; its money changed since.',
      ),
    ).toBeTruthy();
    const noShows = within(dialog).getByTestId('statement.noShows');
    expect(within(noShows).getByText("Booked by the coach, the student didn't come")).toBeTruthy();
    const noShow = within(noShows).getByRole('button', { name: /Ali Hasan/ });
    expect(plain(noShow.textContent)).toMatch(/Oct.* · Ali Hasan/);
    await user.click(noShow);
    expect(navigate).toHaveBeenCalledWith({ to: '/desk/lessons/$id', params: { id: 'lesson-7' } });
    await user.click(within(lines).getByText('Beginners', { exact: false }));
    expect(navigate).toHaveBeenLastCalledWith({
      to: '/desk/lessons/$id',
      params: { id: 'lesson-1' },
    });
  });

  it('a paid statement shows who paid it and its reference, and offers nothing', async () => {
    const paid = statement({
      status: 'paid',
      paid_at: '2026-10-04T12:00:00Z',
      paid_by_name: 'Maha',
      paid_reference: 'Receipt 4471',
    });
    listPayload = list([paid]);
    details.s1 = detail(paid, {
      can: { refresh: false, approve: false, void: false, mark_paid: false },
    });
    mount();
    const { dialog } = await openStatement('Sara');
    expect(plain(within(dialog).getByTestId('statement.history').textContent)).toMatch(
      /Paid .* by Maha · Ref Receipt 4471/,
    );
    expect(within(dialog).queryByText(/your own statement/)).toBeNull();
    expect(within(dialog).queryByTestId('statement.action.void')).toBeNull();
  });

  it('a refusal shows its own line in place (STATEMENT_NOT_DRAFT live_draft)', async () => {
    const voided = statement({
      status: 'void',
      voided_at: '2026-10-03T10:00:00Z',
      void_reason: 'Wrong month',
    });
    listPayload = list([voided]);
    details.s1 = detail(voided);
    writes.coach_statement_refresh = new AppRpcError(
      'STATEMENT_NOT_DRAFT',
      'x',
      undefined,
      'live_draft',
    );
    mount();
    const { user, dialog } = await openStatement('Sara');
    await user.click(within(dialog).getByTestId('statement.action.redraft'));
    expect(
      await within(dialog).findByText(
        'This coach already has a draft for that month. Open it instead.',
      ),
    ).toBeTruthy();
  });
});

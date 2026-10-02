import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// "Lesson refunds due" on Ops (coaching operator.md §5.17; R36, R62, R75):
// hideWhenEmpty, a row's lines, Refund through the till's RefundDialog capped
// at the due with the goodwill switch lifting it (lesson_refund /
// lesson_goodwill on the queued payment.refund), a course leave, a share Qi
// could not refund and its handback record, and a role without refund.

const navigate = vi.fn();
const toast = { ok: vi.fn(), err: vi.fn(), info: vi.fn() };
let role = 'manager';
let reachable = true;

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
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
vi.mock('../../lib/mutate', () => ({ mutate: vi.fn() }));
vi.mock('../../ipc/bridge', () => ({ touch: { pinObserved: vi.fn() } }));
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

import { LocaleProvider } from '../../lib/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { mutate } from '../../lib/mutate';
import { LessonRefundsDuePanel } from './LessonRefundsDuePanel';

const rpc = vi.mocked(appRpc);
const queued = vi.mocked(mutate);
type Raw = Record<string, unknown>;
const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '');

function rawItem(over: Raw = {}): Raw {
  return {
    enrolment_id: 'e1',
    lesson_id: 'l1',
    course_id: null,
    kind: 'group',
    coach_id: 'k1',
    coach_name_en: 'Coach Sara',
    coach_name_ar: 'المدرّبة سارة',
    type_name_en: 'Beginners',
    type_name_ar: 'مبتدئين',
    start_at: '2026-10-01T15:00:00.000Z',
    label: 'Ali Hasan',
    phone: '0770 123 4567',
    cancel_kind: 'staff',
    cancelled_at: '2026-10-01T10:00:00.000Z',
    refund_due_iqd: 15000,
    refund_due_desk_iqd: 15000,
    online_blocked_iqd: 0,
    payments: [
      {
        payment_id: 'p1',
        tab_id: 't1',
        method: 'cash',
        amount_iqd: 30000,
        refunded_iqd: 10000,
        refundable_iqd: 20000,
        created_at: null,
      },
    ],
    ...over,
  };
}

let refunds: Raw;
const calls: { fn: string; args: Record<string, unknown> }[] = [];

beforeEach(() => {
  role = 'manager';
  reachable = true;
  refunds = { venue_id: 'v1', total_iqd: 15000, items: [rawItem()] };
  calls.length = 0;
  localStorage.clear();
  navigate.mockClear();
  for (const f of Object.values(toast)) f.mockClear();
  queued.mockReset();
  queued.mockResolvedValue({ queued: false, localId: 'q1' } as never);
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    if (fn === 'lesson_refunds_due') return structuredClone(refunds);
    if (fn === 'lesson_blocked_refund_record') return { enrolment_id: 'e1' };
    return {};
  });
});

function mount(props: { hideWhenEmpty?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <LessonRefundsDuePanel {...props} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const refundsReads = () => calls.filter((c) => c.fn === 'lesson_refunds_due').length;

async function openRefund(user: ReturnType<typeof userEvent.setup>) {
  const panel = await screen.findByTestId('lesson-refunds');
  await user.click(within(panel).getByRole('button', { name: 'Refund' }));
  return screen.getByLabelText(/^Amount to refund/) as HTMLInputElement;
}

async function confirmPin(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Manager PIN'), '1234');
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
}

describe('LessonRefundsDuePanel', () => {
  it('hideWhenEmpty: nothing while nothing is due; otherwise it says so', async () => {
    refunds = { venue_id: 'v1', total_iqd: 0, items: [] };
    const first = mount({ hideWhenEmpty: true });
    await waitFor(() => expect(refundsReads()).toBe(1));
    expect(screen.queryByTestId('lesson-refunds')).toBeNull();
    first.unmount();
    mount();
    expect(await screen.findByText('No lesson money is waiting to go back.')).toBeTruthy();
  });

  it('a row: the student as recorded, the lesson, each payment, what is due and the header total', async () => {
    const user = userEvent.setup();
    mount({ hideWhenEmpty: true });
    const row = await screen.findByTestId('lesson-refund');
    expect(within(row).getByText('Ali Hasan')).toBeTruthy();
    expect(within(row).getByText('0770 123 4567').getAttribute('dir')).toBe('ltr');
    expect(within(row).getByText('Group session')).toBeTruthy();
    expect(within(row).getByText('Coach Sara')).toBeTruthy();
    expect(within(row).getByText('Paid 30,000 IQD by cash')).toBeTruthy();
    expect(within(row).getByText('Refunded so far 10,000 IQD')).toBeTruthy();
    expect(within(row).getByText('Due 15,000 IQD')).toBeTruthy();
    expect(screen.getByText('Lesson refunds due')).toBeTruthy();
    expect(
      screen.getByText(
        'Desk money for lessons that were cancelled or left. Online money goes back by itself.',
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText('Total due').textContent).toBe('15,000 IQD');
    await user.click(within(row).getByRole('button', { name: 'Open lesson' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/desk/lessons/$id', params: { id: 'l1' } });
  });

  it('Refund opens the till’s RefundDialog on that payment, capped at the due, with the lesson_refund reason (R36)', async () => {
    const user = userEvent.setup();
    mount({ hideWhenEmpty: true });
    const amount = await openRefund(user);
    expect(amount.value).toBe('15000');
    expect(screen.getByText('At most 15,000 IQD.')).toBeTruthy();
    // Past the due: refused here before the server refuses it.
    await user.clear(amount);
    await user.type(amount, '20000');
    const refund = screen
      .getAllByRole('button', { name: 'Refund' })
      .find((b) => b.closest('[role="dialog"]')) as HTMLButtonElement;
    expect(refund.disabled).toBe(true);
    expect(refund.title).toBe('At most 15,000 IQD.');
    await user.clear(amount);
    await user.type(amount, '15000');
    await user.click(refund);
    expect(await screen.findByText('Lesson refund')).toBeTruthy();
    await confirmPin(user);
    await waitFor(() =>
      expect(queued).toHaveBeenCalledWith('payment.refund', {
        paymentId: 'p1',
        amountIqd: 15000,
        pin: '1234',
        reasonCode: 'lesson_refund',
      }),
    );
    await waitFor(() => expect(toast.ok).toHaveBeenCalledWith('Refund recorded.'));
  });

  it('goodwill lifts the cap to what is left on the payment and sends lesson_goodwill', async () => {
    const user = userEvent.setup();
    mount({ hideWhenEmpty: true });
    const amount = await openRefund(user);
    await user.click(screen.getByRole('switch', { name: 'Goodwill: refund more than is due' }));
    expect(await screen.findByText('At most 20,000 IQD.')).toBeTruthy();
    await user.clear(amount);
    await user.type(amount, '20000');
    const refund = screen
      .getAllByRole('button', { name: 'Refund' })
      .find((b) => b.closest('[role="dialog"]')) as HTMLButtonElement;
    expect(refund.disabled).toBe(false);
    await user.click(refund);
    expect(await screen.findByText('Goodwill refund')).toBeTruthy();
    await confirmPin(user);
    await waitFor(() =>
      expect(queued).toHaveBeenCalledWith('payment.refund', {
        paymentId: 'p1',
        amountIqd: 20000,
        pin: '1234',
        reasonCode: 'lesson_goodwill',
      }),
    );
  });

  it('REFUND_EXCEEDS_DUE stays beside the control and re-reads the list', async () => {
    const user = userEvent.setup();
    queued.mockRejectedValueOnce(new AppRpcError('REFUND_EXCEEDS_DUE', 'REFUND_EXCEEDS_DUE'));
    mount({ hideWhenEmpty: true });
    await openRefund(user);
    const before = refundsReads();
    const refund = screen
      .getAllByRole('button', { name: 'Refund' })
      .find((b) => b.closest('[role="dialog"]')) as HTMLButtonElement;
    await user.click(refund);
    await confirmPin(user);
    expect(await screen.findByRole('alert')).toBeTruthy();
    await waitFor(() => expect(refundsReads()).toBeGreaterThan(before));
    expect(toast.ok).not.toHaveBeenCalled();
  });

  it('a course leave says the due is for the sessions still to come (C-23, R62)', async () => {
    refunds = {
      venue_id: 'v1',
      total_iqd: 15000,
      items: [rawItem({ course_id: 'co1', kind: 'course', cancel_kind: 'guest_late' })],
    };
    mount({ hideWhenEmpty: true });
    const row = await screen.findByTestId('lesson-refund');
    expect(
      within(row).getByText('Left the course: due for the sessions still to come'),
    ).toBeTruthy();
  });

  it('a share Qi could not refund (R75): its line, the online refunds link and the handback record under a PIN', async () => {
    const user = userEvent.setup();
    refunds = {
      venue_id: 'v1',
      total_iqd: 0,
      items: [rawItem({ refund_due_desk_iqd: 0, online_blocked_iqd: 7000 })],
    };
    mount({ hideWhenEmpty: true });
    const row = await screen.findByTestId('lesson-refund');
    expect(within(row).getByText('Online refund needs attention: 7,000 IQD')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Online refunds' })).toBeTruthy();
    // Nothing is due at the desk, so no Refund.
    expect(within(row).queryByRole('button', { name: 'Refund' })).toBeNull();
    await user.click(within(row).getByRole('button', { name: 'Record the handback' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record money handed back' });
    expect(
      within(dialog).getByText(/nothing leaves the drawer through this record\./),
    ).toBeTruthy();
    expect((within(dialog).getByLabelText(/^Amount handed back/) as HTMLInputElement).value).toBe(
      '7000',
    );
    const record = within(dialog).getByRole('button', { name: 'Record' }) as HTMLButtonElement;
    expect(record.title).toBe('Enter a reference.');
    const reference = within(dialog).getByLabelText(/^Reference/);
    await user.type(reference, '4111 1111 1111 1111');
    expect(record.disabled).toBe(true);
    expect(record.title).toBe(
      "A card or account number can't go here. Use a receipt or transfer number.",
    );
    await user.clear(reference);
    await user.type(reference, 'TRX-55102');
    expect(record.disabled).toBe(false);
    await user.click(record);
    await user.type(await screen.findByLabelText('PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Authorise' }));
    await waitFor(() =>
      expect(calls.find((c) => c.fn === 'lesson_blocked_refund_record')?.args).toEqual({
        p_enrolment_id: 'e1',
        p_amount_iqd: 7000,
        p_reference: 'TRX-55102',
        p_pin: '1234',
        // 0293 (DB-23): one key per amount and reference, replayed on a retry.
        p_idempotency_key: expect.stringMatching(/^lesson\.blocked_refund:/),
        p_device_id: 'DESK-1',
      }),
    );
    expect(toast.ok).toHaveBeenCalledWith('Handback recorded.');
  });

  it('offline the handback needs a connection; Refund stays (it is the till’s queued refund)', async () => {
    const user = userEvent.setup();
    reachable = false;
    refunds = { venue_id: 'v1', total_iqd: 15000, items: [rawItem({ online_blocked_iqd: 7000 })] };
    mount({ hideWhenEmpty: true });
    const row = await screen.findByTestId('lesson-refund');
    expect(
      (within(row).getByRole('button', { name: 'Refund' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    await user.click(within(row).getByRole('button', { name: 'Record the handback' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record money handed back' });
    await user.type(within(dialog).getByLabelText(/^Reference/), 'TRX-1');
    expect(
      (within(dialog).getByRole('button', { name: 'Record' }) as HTMLButtonElement).title,
    ).toBe('Needs a connection: lessons work online only');
  });

  it('a handback retried after a lost answer sends the same key (DB-23)', async () => {
    const user = userEvent.setup();
    refunds = {
      venue_id: 'v1',
      total_iqd: 0,
      items: [rawItem({ refund_due_desk_iqd: 0, online_blocked_iqd: 7000 })],
    };
    let lost = true;
    rpc.mockImplementation(async (fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args });
      if (fn === 'lesson_refunds_due') return structuredClone(refunds);
      if (fn === 'lesson_blocked_refund_record' && lost) {
        lost = false;
        throw new AppRpcError('UNKNOWN', 'Failed to fetch');
      }
      if (fn === 'lesson_blocked_refund_record') return { enrolment_id: 'e1' };
      return {};
    });
    mount({ hideWhenEmpty: true });
    const row = await screen.findByTestId('lesson-refund');
    await user.click(within(row).getByRole('button', { name: 'Record the handback' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record money handed back' });
    const reference = within(dialog).getByLabelText(/^Reference/);
    await user.type(reference, 'TRX-1');
    const record = within(dialog).getByRole('button', { name: 'Record' });
    const sendWithPin = async () => {
      await user.click(record);
      await user.type(await screen.findByLabelText('PIN'), '1234');
      await user.click(screen.getByRole('button', { name: 'Authorise' }));
    };
    const keys = () =>
      calls
        .filter((c) => c.fn === 'lesson_blocked_refund_record')
        .map((c) => c.args.p_idempotency_key as string);
    await sendWithPin();
    await waitFor(() => expect(keys()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByLabelText('PIN')).toBeNull());
    // The same amount and reference again: the server replays the first record, if it landed.
    await sendWithPin();
    await waitFor(() => expect(keys()).toHaveLength(2));
    expect(keys()[1]).toBe(keys()[0]);
    expect(toast.ok).toHaveBeenCalledWith('Handback recorded.');
  });

  it('an edited reference is a new record with its own key (DB-23)', async () => {
    const user = userEvent.setup();
    refunds = {
      venue_id: 'v1',
      total_iqd: 0,
      items: [rawItem({ refund_due_desk_iqd: 0, online_blocked_iqd: 7000 })],
    };
    rpc.mockImplementation(async (fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args });
      if (fn === 'lesson_refunds_due') return structuredClone(refunds);
      if (fn === 'lesson_blocked_refund_record')
        throw new AppRpcError('UNKNOWN', 'Failed to fetch');
      return {};
    });
    mount({ hideWhenEmpty: true });
    const row = await screen.findByTestId('lesson-refund');
    await user.click(within(row).getByRole('button', { name: 'Record the handback' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record money handed back' });
    const reference = within(dialog).getByLabelText(/^Reference/);
    await user.type(reference, 'TRX-1');
    const record = within(dialog).getByRole('button', { name: 'Record' });
    const sendWithPin = async () => {
      await user.click(record);
      await user.type(await screen.findByLabelText('PIN'), '1234');
      await user.click(screen.getByRole('button', { name: 'Authorise' }));
    };
    const keys = () =>
      calls
        .filter((c) => c.fn === 'lesson_blocked_refund_record')
        .map((c) => c.args.p_idempotency_key as string);
    await sendWithPin();
    await waitFor(() => expect(keys()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByLabelText('PIN')).toBeNull());
    await user.type(reference, '2');
    await sendWithPin();
    await waitFor(() => expect(keys()).toHaveLength(2));
    expect(keys()[1]).not.toBe(keys()[0]);
  });

  it('a role without refund sees nothing and reads nothing', async () => {
    role = 'court_desk';
    const { container } = mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
    expect(refundsReads()).toBe(0);
  });

  it('the name and phone are the recorded ones, in Arabic too, with Latin digits', async () => {
    localStorage.setItem('touch-operator-locale', 'ar');
    mount({ hideWhenEmpty: true });
    const row = await screen.findByTestId('lesson-refund');
    expect(within(row).getByText('Ali Hasan')).toBeTruthy();
    expect(plain(within(row).getByText(/^دُفع/).textContent)).toMatch(/30,000/);
    expect(within(row).getByText('المدرّبة سارة')).toBeTruthy();
  });
});

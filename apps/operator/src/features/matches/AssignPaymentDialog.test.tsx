import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// Assign (operator.md §5.13.6): the pre-fill in seat order, one
// app.match_link_payment per payment, the caps on the fields, and "Keep on
// the booking" only on a live court-only bill.

const toast = { ok: vi.fn(), err: vi.fn(), info: vi.fn() };
let reachable = true;

vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/realtime', () => ({ useBroadcast: vi.fn() }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));
vi.mock('../../lib/stationReach', () => ({ useStationReach: () => ({ reachable }) }));
vi.mock('../../components/toast', () => ({ useToast: () => toast }));

import { AppRpcError, appRpc } from '../../lib/appRpc';
import { AssignPaymentDialog } from './AssignPaymentDialog';
import { readMatchDetail, type MatchDetail } from './matchPayloads';

const rpc = vi.mocked(appRpc);
type Raw = Record<string, unknown>;

function seat(no: number, owed: number, money: Raw = {}): Raw {
  return {
    seat_id: `s${no}`,
    seat_no: no,
    kind: 'desk',
    status: 'attended',
    carrying: true,
    full_name: `Player ${'ABCD'[no - 1]}`,
    money: { share_iqd: 10000, paid_desk_iqd: 10000 - owed, credit_iqd: 0, owed_iqd: owed, written_off_iqd: 0, write_off: null, open_iqd: 0, take_iqd: owed, ...money },
    can: { take_share: owed > 0 },
  };
}

/** A seat the credit pool covered to 0 (money.md §10 #21): nothing linked, owes nothing. */
const credited = (no: number) => seat(no, 0, { paid_desk_iqd: 0, credit_iqd: 10000 });

function payment(id: string, amount: number, over: Raw = {}): Raw {
  return { payment_id: id, tab_id: `tab-${id}`, tab_live: false, method: 'cash', amount_iqd: amount, unassigned_iqd: amount, created_at: '2026-10-01T18:05:00.000Z', ...over };
}

function detail(unassigned: Raw[], seats: Raw[] = [seat(1, 10000), seat(2, 10000), seat(3, 0), seat(4, 10000)]): MatchDetail {
  return readMatchDetail({
    match: { id: 'm1', status: 'booked', start_at: '2026-10-01T18:00:00.000Z', end_at: '2026-10-01T19:30:00.000Z', category: 'open', can: {} },
    seats,
    requests: [],
    money: { unassigned_iqd: unassigned.reduce((s, p) => s + Number(p.unassigned_iqd), 0), unassigned, vacant: [] },
    events: [],
  })!;
}

const calls: { fn: string; args: Record<string, unknown> }[] = [];
let answer: (args: Record<string, unknown>) => unknown;

beforeEach(() => {
  reachable = true;
  calls.length = 0;
  for (const f of Object.values(toast)) f.mockClear();
  answer = () => ({ links: [], unassigned_iqd: 0, tab_closed: false });
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    return answer(args);
  });
});

function mount(d: MatchDetail, props: { focusPaymentId?: string; notice?: string } = {}) {
  const onClose = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <AssignPaymentDialog detail={d} tz="Asia/Baghdad" onClose={onClose} {...props} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { dialog: screen.getByRole('dialog'), onClose };
}

const box = (scope: HTMLElement, name: string) => within(scope).getByLabelText(new RegExp(`Amount for .*${name}`)) as HTMLInputElement;
const links = () => calls.filter((c) => c.fn === 'match_link_payment');

describe('AssignPaymentDialog', () => {
  it('pre-fills each payment in seat order up to what each player owes, and saves one call per payment', async () => {
    const user = userEvent.setup();
    const { dialog, onClose } = mount(
      detail([payment('a', 15000, { created_at: '2026-10-01T18:00:00.000Z' }), payment('b', 8000, { method: 'card', created_at: '2026-10-01T18:10:00.000Z' })]),
    );
    const [first, second] = within(dialog).getAllByRole('region');
    expect(box(first!, 'Player A').value).toBe('10000');
    expect(box(first!, 'Player B').value).toBe('5000');
    expect(box(first!, 'Player D').value).toBe('');
    // Player C's share is paid at the desk already, so has no box.
    expect(within(first!).queryByLabelText(/Amount for .*Player C/)).toBeNull();
    expect(box(second!, 'Player B').value).toBe('5000');
    expect(box(second!, 'Player D').value).toBe('3000');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(links().map((c) => c.args.p_payment_id)).toEqual(['a', 'b']);
    expect(links()[0]!.args.p_allocations).toEqual([
      { seat_id: 's1', amount_iqd: 10000 },
      { seat_id: 's2', amount_iqd: 5000 },
    ]);
    expect(String(links()[0]!.args.p_idempotency_key)).toMatch(/^match\.link:/);
    expect(links()[0]!.args.p_idempotency_key).not.toBe(links()[1]!.args.p_idempotency_key);
    expect(toast.ok).toHaveBeenCalledWith('Money assigned to players.');
  });

  it('#21: the pool credited every seat to 0, and the payment on the bill still goes back on all four', async () => {
    const user = userEvent.setup();
    const { dialog, onClose } = mount(detail([payment('a', 40000)], [credited(1), credited(2), credited(3), credited(4)]));
    expect(within(dialog).queryByText('Every share is already paid at the desk.')).toBeNull();
    for (const name of ['Player A', 'Player B', 'Player C', 'Player D']) expect(box(dialog, name).value).toBe('10000');
    expect(within(dialog).getAllByText('Seat 1 · Covered from the booking 10,000 IQD').length).toBe(1);
    const save = within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await user.click(save);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(links()[0]!.args.p_allocations).toEqual([
      { seat_id: 's1', amount_iqd: 10000 },
      { seat_id: 's2', amount_iqd: 10000 },
      { seat_id: 's3', amount_iqd: 10000 },
      { seat_id: 's4', amount_iqd: 10000 },
    ]);
  });

  it("a no-show's written-off share takes a link the desk types (it lowers the write-off)", async () => {
    const user = userEvent.setup();
    const absent = { ...seat(2, 0, { paid_desk_iqd: 0, written_off_iqd: 10000, write_off: 'no_show' }), status: 'no_show' };
    const { dialog, onClose } = mount(detail([payment('a', 10000)], [seat(1, 0), absent]));
    const b = box(dialog, 'Player B');
    expect(b.value).toBe('');
    expect(within(dialog).getByText('Seat 2 · Written off 10,000 IQD')).toBeTruthy();
    await user.type(b, '10000');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(links()[0]!.args.p_allocations).toEqual([{ seat_id: 's2', amount_iqd: 10000 }]);
  });

  it('every share already linked: nobody to assign to, and no Save', () => {
    const { dialog } = mount(detail([payment('a', 5000)], [seat(1, 0), seat(2, 0), seat(3, 0), seat(4, 0)]));
    expect(within(dialog).getByText('Every share is already paid at the desk.')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('more than is left of a share is caught on the field, and Save says why', async () => {
    const user = userEvent.setup();
    const { dialog } = mount(detail([payment('a', 30000)]));
    const a = box(dialog, 'Player A');
    await user.clear(a);
    await user.type(a, '12000');
    expect(within(dialog).getByText("That is more than is left of this player's share (10,000 IQD).")).toBeTruthy();
    const save = within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.title).toBe("That is more than is left of this player's share (10,000 IQD).");
  });

  it('more than the payment has left is caught on the payment', async () => {
    const user = userEvent.setup();
    const { dialog } = mount(detail([payment('a', 12000)]));
    const d = box(dialog, 'Player D');
    await user.type(d, '5000');
    expect(within(dialog).getByText('That is more than this payment has left to assign (12,000 IQD).')).toBeTruthy();
  });

  it('Keep on the booking: only on a live bill, sending no allocations', async () => {
    const user = userEvent.setup();
    const { dialog, onClose } = mount(detail([payment('a', 5000, { tab_live: true }), payment('b', 3000, { tab_live: false })]));
    const [live, settled] = within(dialog).getAllByRole('region');
    expect(within(settled!).queryByRole('button', { name: 'Keep on the booking' })).toBeNull();
    await user.click(within(live!).getByRole('button', { name: 'Keep on the booking' }));
    await waitFor(() => expect(links()).toHaveLength(1));
    expect(links()[0]!.args).toMatchObject({ p_payment_id: 'a', p_allocations: [] });
    expect(toast.ok).toHaveBeenCalledWith('Kept on the booking.');
    // One payment is still waiting: the dialog stays, without the kept one.
    expect(onClose).not.toHaveBeenCalled();
    expect(within(dialog).getAllByRole('region')).toHaveLength(1);
  });

  it('a refusal lands on its payment and keeps the dialog open', async () => {
    const user = userEvent.setup();
    answer = () => {
      throw new AppRpcError('AMOUNT_OVER_SEAT', 'AMOUNT_OVER_SEAT');
    };
    const { dialog, onClose } = mount(detail([payment('a', 5000)]));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText("That's more than is left of this player's share.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('opened for a bill: that payment first, with the reason on top', () => {
    const { dialog } = mount(detail([payment('a', 5000), payment('b', 3000, { tab_id: 'tab-9', tab_live: true })]), {
      focusPaymentId: 'b',
      notice: 'This booking has a bill open with money on it.',
    });
    expect(within(dialog).getByText('This booking has a bill open with money on it.')).toBeTruthy();
    const [first] = within(dialog).getAllByRole('region');
    expect(within(first!).getByRole('button', { name: 'Keep on the booking' })).toBeTruthy();
  });

  it('offline: nothing can be saved', () => {
    reachable = false;
    const { dialog } = mount(detail([payment('a', 5000, { tab_live: true })]));
    const save = within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.title).toBe('Needs a connection: open matches work online only');
    expect((within(dialog).getByRole('button', { name: 'Keep on the booking' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

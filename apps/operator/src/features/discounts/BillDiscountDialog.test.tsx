import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// "Customer discount" at the close of a bill (0342): with "Keep for <name>" on
// (the default) the discount is saved to the record and the bill refreshed;
// with it off the parts go on this bill only; Remove takes them off. No PIN
// anywhere. A bill with no customer points at the member block.

let staffId = 's1';
const toastOk = vi.fn();
const toastInfo = vi.fn();

vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: staffId, displayName: 'Staff', role: 'cashier' } }),
}));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: toastOk, err: vi.fn(), info: toastInfo }) }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async () => ({})),
}));
vi.mock('../../lib/idem', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deviceId: () => 'TILL-1',
}));

import { appRpc } from '../../lib/appRpc';
import { BillDiscountDialog } from './BillDiscountDialog';
import type { BillDiscountState } from './discountLogic';

const rpc = vi.mocked(appRpc);
const onClose = vi.fn();

function state(over: Partial<BillDiscountState> = {}): BillDiscountState {
  return {
    customer: { id: 'c1', name: 'Sara Karim' },
    standing: null,
    cafe: null,
    court: null,
    cafe_needs_refresh: false,
    court_needs_refresh: false,
    court_allowed: true,
    cafe_waived: false,
    court_waived: false,
    ...over,
  };
}

function open(s: BillDiscountState, ids: { tabId: string | null; reservationId: string | null } = { tabId: 't1', reservationId: null }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <BillDiscountDialog tabId={ids.tabId} reservationId={ids.reservationId} state={s} onClose={onClose} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return within(screen.getByRole('dialog'));
}

/** The calls made, in order, as [name, args]. */
const sent = () => rpc.mock.calls.map(([fn, args]) => [fn, args]);

beforeEach(() => {
  staffId = 's1';
  rpc.mockReset();
  rpc.mockImplementation(async () => ({}));
  toastOk.mockReset();
  toastInfo.mockReset();
  onClose.mockReset();
});

describe('BillDiscountDialog', () => {
  it("keep (the default): saves 20% café for the customer, then puts it on the tab with 'standing'; no PIN", async () => {
    const user = userEvent.setup();
    const d = open(state());
    expect(d.getByText('Sara Karim')).toBeTruthy();
    const keep = d.getByRole('checkbox', { name: /Keep for .*Sara Karim.* on every bill/ }) as HTMLInputElement;
    expect(keep.checked).toBe(true);
    // A tab with no booking: the café part only.
    expect(d.queryByTestId('discount-court')).toBeNull();
    await user.click(within(d.getByTestId('discount-cafe')).getByRole('button', { name: '%' }));
    await user.type(d.getByRole('textbox', { name: 'Café and shop: how much' }), '20');
    await user.click(d.getByRole('radio', { name: 'Coach' }));
    await user.click(d.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent()).toEqual([
      [
        'set_customer_discount',
        { p_customer_id: 'c1', p_cafe_kind: 'percent', p_cafe_value: 2000, p_court_kind: null, p_court_value: null, p_reason: 'coach', p_note: null },
      ],
      ['apply_customer_discount', { p_tab_id: 't1', p_kind: 'standing', p_device_id: 'TILL-1' }],
    ]);
    expect(rpc.mock.calls.some(([fn]) => fn === 'verify_manager_pin')).toBe(false);
    expect(toastOk).toHaveBeenCalledTimes(1);
  });

  it('keep with a standing court part the till cannot show: the court part is kept as it was', async () => {
    const user = userEvent.setup();
    const d = open(state({ standing: { cafe: { kind: 'percent', value: 1000 }, court: { kind: 'amount', value: 5000 }, reason: 'family', note: null, set_by: null, set_at: null } }));
    // Opens on the standing discount.
    expect((d.getByRole('textbox', { name: 'Café and shop: how much' }) as HTMLInputElement).value).toBe('10');
    expect(d.getByTestId('discount-standing').textContent).toContain('Family');
    await user.click(d.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent()[0]).toEqual([
      'set_customer_discount',
      { p_customer_id: 'c1', p_cafe_kind: 'percent', p_cafe_value: 1000, p_court_kind: 'amount', p_court_value: 5000, p_reason: 'family', p_note: null },
    ]);
  });

  it('this bill only: the café and court parts go on with kind, value and reason, and the record is not touched', async () => {
    const user = userEvent.setup();
    const d = open(state(), { tabId: 't1', reservationId: 'r1' });
    await user.click(within(d.getByTestId('discount-cafe')).getByRole('button', { name: 'IQD' }));
    await user.type(d.getByRole('textbox', { name: 'Café and shop: how much' }), '3000');
    await user.click(within(d.getByTestId('discount-court')).getByRole('button', { name: '%' }));
    await user.type(d.getByRole('textbox', { name: 'Court fee: how much' }), '50');
    await user.click(d.getByRole('radio', { name: 'Sponsored' }));
    await user.click(d.getByRole('checkbox'));
    expect(d.getByText('This bill only. Their record stays as it is.')).toBeTruthy();
    // "This bill only" has no note: the note belongs to the record.
    expect(d.queryByRole('textbox', { name: /Note/ })).toBeNull();
    await user.click(d.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent()).toEqual([
      ['apply_customer_discount', { p_tab_id: 't1', p_kind: 'amount', p_value: 3000, p_reason: 'sponsored', p_device_id: 'TILL-1' }],
      ['apply_customer_court_discount', { p_reservation_id: 'r1', p_kind: 'percent', p_value: 5000, p_reason: 'sponsored', p_device_id: 'TILL-1' }],
    ]);
  });

  it('Apply with nothing set says so and sends nothing', async () => {
    const user = userEvent.setup();
    const d = open(state());
    await user.click(d.getByRole('button', { name: 'Apply' }));
    expect(d.getByText('Set a discount on the café, the court fee, or both.')).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('Remove from this bill sends "none" (the server waives it for this bill)', async () => {
    const user = userEvent.setup();
    const d = open(state({ cafe: { kind: 'percent', value: 2000, amount_iqd: 1000, standing: true, adjustment_id: 'a1' } }));
    await user.click(d.getByRole('button', { name: 'Remove from this bill' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent()).toEqual([['apply_customer_discount', { p_tab_id: 't1', p_kind: 'none', p_device_id: 'TILL-1' }]]);
  });

  it('keep on a booking whose fee is already paid: the record is saved and the refusal told, not shown as a failure', async () => {
    const user = userEvent.setup();
    const { AppRpcError } = await import('../../lib/appRpc');
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'apply_customer_court_discount') throw new AppRpcError('COURT_FEE_PAID', 'COURT_FEE_PAID');
      return {};
    });
    const d = open(state({ standing: { cafe: null, court: { kind: 'percent', value: 2000 }, reason: 'coach', note: null, set_by: null, set_at: null } }), { tabId: null, reservationId: 'r1' });
    await user.click(d.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent().map(([fn]) => fn)).toEqual(['set_customer_discount', 'apply_customer_court_discount']);
    expect(toastInfo).toHaveBeenCalledTimes(1);
  });

  it('a refusal stays in the dialog beside the buttons', async () => {
    const user = userEvent.setup();
    const { AppRpcError } = await import('../../lib/appRpc');
    rpc.mockImplementation(async () => {
      throw new AppRpcError('DISCOUNT_REQUIRES_REFUND', 'DISCOUNT_REQUIRES_REFUND');
    });
    const d = open(state({ standing: { cafe: { kind: 'percent', value: 1000 }, court: null, reason: 'coach', note: null, set_by: null, set_at: null } }));
    await user.click(d.getByRole('checkbox'));
    await user.click(d.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(d.getByRole('alert')).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('no customer on the bill: says so and points at the member block, with nothing to apply', () => {
    const d = open(state({ customer: null }));
    expect(d.getByTestId('discount-no-customer').textContent).toContain('No customer on this bill yet.');
    expect(d.queryByRole('button', { name: 'Apply' })).toBeNull();
    // The footer's Close, beside the dialog's own X.
    expect(d.getAllByRole('button', { name: 'Close' })).toHaveLength(2);
  });

  it("the cashier's own bill: refused before anything is sent", () => {
    staffId = 'c1';
    const d = open(state());
    expect(d.getByText('This is your own bill. A colleague has to give you a discount.')).toBeTruthy();
    expect(d.queryByRole('button', { name: 'Apply' })).toBeNull();
  });
});

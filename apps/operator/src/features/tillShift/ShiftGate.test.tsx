import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { LocaleProvider } from '../../lib/i18n';
import { ToastProvider } from '../../components/toast';
import type * as AuthModule from '../../lib/auth';
import type * as BridgeModule from '../../ipc/bridge';

// Till shifts on the screen (wave5-addendum-2026-09-25 §5.1, §6.2; §8 Q29,
// Q30): the payment pane meets the start panel under the gate, never on an
// offline tab, and FAILS OPEN whenever the station's shift cannot be known;
// Sign out and the idle lock's Switch user ask first while one's own shift is
// open; the close is blind until it is signed.

const h = vi.hoisted(() => ({
  role: 'cashier' as string,
  mode: 'till' as 'till' | 'desk' | 'kds',
  signOut: vi.fn(),
  /** What app.till_shift_status answers; an Error rejects, 'never' never answers. */
  status: null as unknown,
  hasOwnPin: true,
  calls: [] as { fn: string; args: Record<string, unknown> }[],
}));

vi.mock('../../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthModule>();
  return {
    ...actual,
    useAuth: () => ({ staff: { id: 'maha', displayName: 'Maha', role: h.role }, signOut: h.signOut }),
    usePermissions: () => actual.permissionsFor(h.role as Parameters<typeof actual.permissionsFor>[0]),
  };
});
vi.mock('../../ipc/bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof BridgeModule>();
  return {
    ...actual,
    touch: {
      ...actual.touch,
      getStation: () => ({ stationId: 'DEV1', mode: h.mode, configured: true, appVersion: 'test' }),
      getQueueRows: async () => [],
    },
  };
});
vi.mock('../../lib/offlineTabs', () => ({
  getOfflineTab: () => ({ idemKey: 'k1', localId: 'l1', label: null, tableNumber: '3', openedAt: '', lines: [{ name: 'Latte', qty: 1, priceIqd: 5000 }], settled: false }),
  markOfflineSettled: vi.fn(),
}));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { appRpc } from '../../lib/appRpc';
import { PaymentPane } from '../till/PaymentPane';
import { OfflineTabPanel } from '../till/OfflineTabPanel';
import { ShiftProvider } from './ShiftProvider';
import { useTillShift } from './shiftContext';
import { LockLeaveGuard } from './LockLeaveGuard';
import { TillShiftPanel } from './TillShiftPanel';

const rpc = vi.mocked(appRpc);

/** Names are isolate()d (FSI … PDI) wherever they are interpolated; read past the marks. */
const bare = (s: string) => s.replace(/[\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
const N = { normalizer: bare };
const named = (label: string) => (name: string) => bare(name) === label;

const DAY = { id: 'd1', business_date: '2026-09-26', opening_float_iqd: 100_000 };
const MINE = {
  id: 's-mine', staff_id: 'maha', staff_name: 'Maha', is_mine: true, opened_at: '2026-09-26T06:02:00Z',
  opening_float_iqd: 100_000, payment_count: 3, refund_count: 0, drawer_open_count: 0,
};
const ALI = { ...MINE, id: 's-ali', staff_id: 'ali', staff_name: 'Ali', is_mine: false };
const status = (over: Record<string, unknown> = {}) => ({
  station_id: 'DEV1', day: DAY, shift: null, last_closed: null, mine_elsewhere: null, queue_depth: 0, ...over,
});

const CLOSED = {
  ok: true, duplicate: false, till_shift_id: 's-mine', station_id: 'DEV1', staff_id: 'maha', staff_name: 'Maha',
  opened_at: MINE.opened_at, closed_at: '2026-09-26T13:02:00Z', closed_via: 'own_pin', authorized_by_name: 'Maha',
  opening_float_iqd: 100_000, cash_payments_iqd: 250_000, cash_refunds_iqd: 0, cash_expected_iqd: 350_000,
  cash_counted_iqd: 345_000, cash_variance_iqd: -5_000, card_payments_iqd: 80_000, card_refunds_iqd: 0,
  payment_count: 12, refund_count: 0, drawer_open_count: 1, left_in_drawer_iqd: 345_000,
};

beforeEach(() => {
  h.role = 'cashier';
  h.mode = 'till';
  h.status = status();
  h.hasOwnPin = true;
  h.calls.length = 0;
  h.signOut.mockReset();
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    h.calls.push({ fn, args: args ?? {} });
    if (fn === 'till_shift_status') {
      if (h.status === 'never') return new Promise(() => {});
      if (h.status instanceof Error) throw h.status;
      return h.status;
    }
    if (fn === 'heartbeat') return {};
    if (fn === 'has_own_pin') return h.hasOwnPin;
    if (fn === 'open_till_shift') {
      h.status = status({ shift: MINE });
      return {
        duplicate: false,
        till_shift: { id: 's-mine', station_id: 'DEV1', staff_id: 'maha', staff_name: 'Maha', opened_at: MINE.opened_at, opening_float_iqd: args?.p_opening_float_iqd, handover_from: null, handover_difference_iqd: null },
      };
    }
    if (fn === 'close_till_shift' || fn === 'close_till_shift_for') {
      h.status = status();
      return fn === 'close_till_shift' ? CLOSED : { ...CLOSED, closed_via: 'manager_pin', authorized_by_name: 'Dev Manager' };
    }
    if (fn === 'verify_manager_pin') return 'manager-id';
    throw new Error(`unexpected ${fn}`);
  });
});

function mount(ui: ReactNode, { offline = false } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <ShiftProvider offline={offline}>{ui}</ShiftProvider>
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const pane = <PaymentPane mode="cash" due={18_000} busy={false} error={null} onCancel={vi.fn()} onSettle={vi.fn()} />;
const statusRead = () => waitFor(() => expect(h.calls.some((c) => c.fn === 'till_shift_status')).toBe(true));

describe('the payment gate (§8 Q30)', () => {
  it('shows the start panel first, and the tender once the shift is open', async () => {
    const user = userEvent.setup();
    mount(pane);
    expect(await screen.findByText('Start your shift to take payment.')).toBeTruthy();
    // The day's first shift at the till: the day's float, confirmed with one tap.
    expect(screen.getByText('The day opened with 100,000 IQD in the drawer.')).toBeTruthy();
    expect(screen.getByText('Is 100,000 IQD in the drawer now?')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'That’s right' }));
    const open = h.calls.find((c) => c.fn === 'open_till_shift');
    expect(open?.args).toMatchObject({ p_opening_float_iqd: 100_000, p_device_id: 'DEV1', p_note: null });
    expect(String(open?.args.p_idempotency_key)).toMatch(/^till_shift\.open:/);
    // It beat as the station right before the write (the write form of the station check).
    expect(h.calls.findIndex((c) => c.fn === 'heartbeat')).toBeLessThan(h.calls.findIndex((c) => c.fn === 'open_till_shift'));
    expect(await screen.findByRole('button', { name: 'Record payment' })).toBeTruthy();
  });

  it('takes a counted amount instead when the cashier found a different one', async () => {
    const user = userEvent.setup();
    h.status = status({ last_closed: { id: 's0', staff_name: 'Ali', closed_at: '2026-09-26T13:02:00Z', left_in_drawer_iqd: 1_250_000, outside_cash_since_iqd: 0 } });
    mount(pane);
    expect(await screen.findByText(/Ali left 1,250,000 IQD in the drawer at/, N)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'I counted a different amount' }));
    await user.type(screen.getByLabelText('Cash in the drawer now'), '1245000');
    await user.click(screen.getByRole('button', { name: 'Start my shift' }));
    expect(h.calls.find((c) => c.fn === 'open_till_shift')?.args).toMatchObject({ p_opening_float_iqd: 1_245_000 });
  });

  it('holds a cashier at someone else’s open shift: it is closed first, with a manager’s PIN', async () => {
    h.status = status({ shift: ALI });
    mount(pane);
    expect(await screen.findByText('Ali’s shift is still open', N)).toBeTruthy();
    expect(screen.getByRole('button', { name: named('Close Ali’s shift') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull();
  });

  it('lets a manager work anyone’s drawer, with a banner saying whose', async () => {
    h.role = 'manager';
    h.status = status({ shift: { ...ALI, cash_expected_iqd: 350_000 } });
    mount(pane);
    expect(await screen.findByText('This payment goes into Ali’s drawer.', N)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeTruthy();
  });

  it('asks the desk to count its own box on its first shift (§2.9.9)', async () => {
    h.mode = 'desk';
    h.role = 'court_desk';
    mount(pane);
    expect(await screen.findByText('Count the cash in the desk’s box to start.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'That’s right' })).toBeNull();
    expect(screen.getByLabelText('Cash in the drawer now')).toBeTruthy();
  });

  it('FAILS OPEN offline: the tender, with no start panel', async () => {
    mount(pane, { offline: true });
    await statusRead();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeTruthy();
    expect(screen.queryByText('Start your shift to take payment.')).toBeNull();
  });

  it('FAILS OPEN while the status is loading, and when it cannot be read', async () => {
    h.status = 'never';
    const { unmount } = mount(pane);
    await statusRead();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeTruthy();
    unmount();

    h.calls.length = 0;
    h.status = new Error('network down');
    mount(pane);
    await statusRead();
    expect(await screen.findByRole('button', { name: 'Record payment' })).toBeTruthy();
    expect(screen.queryByText('Start your shift to take payment.')).toBeNull();
  });

  it('never gates an offline tab: it takes its own payment', async () => {
    mount(<OfflineTabPanel idemKey="k1" onSettled={vi.fn()} />);
    await statusRead();
    expect(screen.getByRole('button', { name: 'Card' })).toBeTruthy();
    expect(screen.queryByText('Start your shift to take payment.')).toBeNull();
  });
});

/** Stands in for the rail: the same calls the rail's Sign out and End my shift make. */
function Rail() {
  const shift = useTillShift();
  return (
    <>
      <button type="button" onClick={() => (shift.guardSignOut(h.signOut) ? undefined : h.signOut())}>
        Rail sign out
      </button>
      <button type="button" onClick={() => shift.openClose()}>
        Rail end
      </button>
      <span data-testid="mine">{String(shift.mineHere)}</span>
    </>
  );
}

describe('the leaving guard (§5.1)', () => {
  it('asks before Sign out while my shift is open, and signs out only when told to', async () => {
    const user = userEvent.setup();
    h.status = status({ shift: MINE });
    mount(<Rail />);
    await waitFor(() => expect(screen.getByTestId('mine').textContent).toBe('true'));
    await user.click(screen.getByRole('button', { name: 'Rail sign out' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Your shift is still open')).toBeTruthy();
    expect(h.signOut).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Sign out anyway' }));
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });

  it('offers to end the shift first, into the blind count', async () => {
    const user = userEvent.setup();
    h.status = status({ shift: MINE });
    mount(<Rail />);
    await waitFor(() => expect(screen.getByTestId('mine').textContent).toBe('true'));
    await user.click(screen.getByRole('button', { name: 'Rail sign out' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'End my shift' }));
    expect(await screen.findByText(/Count all the cash in the drawer, float included/)).toBeTruthy();
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it('signs out at once with no shift of mine open', async () => {
    const user = userEvent.setup();
    mount(<Rail />);
    await statusRead();
    await user.click(screen.getByRole('button', { name: 'Rail sign out' }));
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks inside the idle lock’s card, and signs out only when told to', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onSignOut = vi.fn();
    render(
      <LocaleProvider>
        <LockLeaveGuard name="Maha" onBack={onBack} onSignOut={onSignOut} />
      </LocaleProvider>,
    );
    expect(screen.getByRole('alert').textContent).toContain('shift is still open here');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onSignOut).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Sign out anyway' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('ending a shift (§8 Q29: blind, then the difference)', () => {
  it('counts with no expected figure, signs with my PIN, then shows the difference and Sign out', async () => {
    const user = userEvent.setup();
    h.status = status({ shift: MINE });
    mount(<Rail />);
    await waitFor(() => expect(screen.getByTestId('mine').textContent).toBe('true'));
    await user.click(screen.getByRole('button', { name: 'Rail end' }));
    const dialog = await screen.findByRole('dialog');
    // Blind: nothing on the count step names what the drawer should hold.
    expect(dialog.textContent).not.toMatch(/Expected|350,000/);
    await user.type(within(dialog).getByLabelText('Cash in the drawer'), '345000');
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(await within(dialog).findByText('Your PIN signs a count of 345,000 IQD.')).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Your PIN'), '482193');
    await user.click(within(dialog).getByRole('button', { name: 'End my shift' }));

    const close = h.calls.find((c) => c.fn === 'close_till_shift');
    expect(close?.args).toMatchObject({ p_till_shift_id: 's-mine', p_counted_iqd: 345_000, p_pin: '482193', p_device_id: 'DEV1', p_note: null });
    expect(String(close?.args.p_idempotency_key)).toMatch(/^till_shift\.close:/);
    expect(await screen.findByText('Short by 5,000 IQD')).toBeTruthy();
    expect(screen.getByText('345,000 IQD stays in the drawer for the next shift.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });

  it('sends a cashier with no PIN to a manager’s, through the grant', async () => {
    const user = userEvent.setup();
    h.status = status({ shift: MINE });
    h.hasOwnPin = false;
    mount(<Rail />);
    await waitFor(() => expect(screen.getByTestId('mine').textContent).toBe('true'));
    await user.click(screen.getByRole('button', { name: 'Rail end' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Cash in the drawer'), '0');
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(await within(dialog).findByText('You have no PIN yet, so a manager signs this count.')).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Manager’s PIN'), '380517');
    await user.click(within(dialog).getByRole('button', { name: 'End my shift' }));
    const order = h.calls.map((c) => c.fn);
    expect(order.indexOf('verify_manager_pin')).toBeLessThan(order.indexOf('close_till_shift_for'));
    expect(h.calls.find((c) => c.fn === 'close_till_shift_for')?.args).toMatchObject({ p_till_shift_id: 's-mine', p_counted_iqd: 0 });
    expect(await screen.findByText('Signed with Dev Manager’s PIN.', N)).toBeTruthy();
  });
});

describe('the start panel on the page (§5.1: "a start panel on /till")', () => {
  it('asks for the shift on /till before any payment, inline, with no Cancel, and goes once one is open', async () => {
    const user = userEvent.setup();
    mount(<TillShiftPanel fallback={<p>sound strip</p>} />);
    const panel = await screen.findByTestId('shift-panel');
    // A panel on the page, not a dialog, and it does not take the till's focus.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(panel).getByText('Start your shift before the first payment.')).toBeTruthy();
    expect(within(panel).getByText('Is 100,000 IQD in the drawer now?')).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(document.activeElement).not.toBe(within(panel).getByRole('button', { name: 'That’s right' }));
    await user.click(within(panel).getByRole('button', { name: 'That’s right' }));
    expect(h.calls.find((c) => c.fn === 'open_till_shift')?.args).toMatchObject({ p_opening_float_iqd: 100_000 });
    // The shift is open: what the panel stood in for comes back.
    expect(await screen.findByText('sound strip')).toBeTruthy();
    expect(screen.queryByTestId('shift-panel')).toBeNull();
  });

  it('says “You left …” when the last shift here was the viewer’s own', async () => {
    h.status = status({ last_closed: { id: 's0', staff_name: 'Maha', closed_at: '2026-09-26T13:02:00Z', left_in_drawer_iqd: 98_000, outside_cash_since_iqd: 0 } });
    mount(<TillShiftPanel />);
    expect(await screen.findByText(/^You left 98,000 IQD in the drawer at/, N)).toBeTruthy();
  });

  it('draws nothing for a manager, and nothing offline: the page is never held up', async () => {
    h.role = 'manager';
    const first = mount(<TillShiftPanel fallback={<p>sound strip</p>} />);
    await statusRead();
    expect(screen.getByText('sound strip')).toBeTruthy();
    expect(screen.queryByTestId('shift-panel')).toBeNull();
    first.unmount();
    h.role = 'cashier';
    mount(<TillShiftPanel fallback={<p>sound strip</p>} />, { offline: true });
    await statusRead();
    expect(screen.queryByTestId('shift-panel')).toBeNull();
  });
});

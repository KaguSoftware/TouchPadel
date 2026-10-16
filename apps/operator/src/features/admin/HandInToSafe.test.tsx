import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { ToastProvider } from '../../components/toast';

// "Hand cash to the safe" (0343, main cash): after the close, one row per
// drawer box with the server's figures, each input prefilled with the box's
// net cash, and one button that moves the total in one call.

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { AppRpcError, appRpc } from '../../lib/appRpc';
import { HandInToSafe } from './HandInToSafe';

const rpc = vi.mocked(appRpc);
const calls: { fn: string; args: Record<string, unknown> }[] = [];

let boxes: unknown[] = [];
let failBoxes = false;
let handIn: (args: Record<string, unknown>) => unknown = () => ({ handed_in: 2, total_iqd: 1320000, balance_iqd: 1320000 });

function payload(status = 'closed') {
  return { day_session_id: 'ds1', business_date: '2026-10-15', status, opening_float_iqd: 50000, boxes };
}

function mount(mode: 'closed' | 'pending' = 'closed') {
  rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    calls.push({ fn, args: args ?? {} });
    if (fn === 'main_cash_day_boxes') {
      if (failBoxes) throw new AppRpcError('UNKNOWN', 'down');
      return payload();
    }
    if (fn === 'main_cash_hand_in_day') {
      const res = handIn(args ?? {});
      if (res instanceof Error) throw res;
      // The server now has them: the refetch reads them back as handed in.
      const sent = (args?.p_boxes ?? []) as { box: string; amount_iqd: number }[];
      boxes = boxes.map((b) => {
        const row = b as { box: string };
        const hit = sent.find((s) => s.box === row.box);
        return hit ? { ...row, handed_in_iqd: hit.amount_iqd } : row;
      });
      return res;
    }
    throw new Error(`unexpected ${fn}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <HandInToSafe mode={mode} daySessionId="ds1" />
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

beforeEach(() => {
  rpc.mockReset();
  navigate.mockReset();
  calls.length = 0;
  failBoxes = false;
  boxes = [
    { box: 'cafe', cash_in_iqd: 1250000, cash_out_iqd: 20000, net_iqd: 1230000, handed_in_iqd: null },
    { box: 'desk', cash_in_iqd: 90000, cash_out_iqd: 0, net_iqd: 90000, handed_in_iqd: null },
  ];
  handIn = () => ({ handed_in: 2, total_iqd: 1320000, balance_iqd: 1320000 });
});

describe('Day close ▸ Hand cash to the safe', () => {
  it('lists each box with what it took and an amount prefilled with its net cash', async () => {
    mount();
    await screen.findByText('Café till');
    const cafe = screen.getByTestId('hand-in-cafe');
    expect(cafe.textContent).toContain('Took 1,250,000 IQD in cash, less 20,000 IQD refunded');
    expect(input('Café till: cash to the safe').value.replace(/\D/g, '')).toBe('1230000');
    expect(input('Court desk: cash to the safe').value.replace(/\D/g, '')).toBe('90000');
    expect(screen.getByTestId('hand-in-desk').textContent).toContain('Took 90,000 IQD in cash');
    expect(screen.getByRole('button', { name: 'Move 1,320,000 IQD to the safe' })).toBeTruthy();
  });

  it('moves the boxes in one call with an idempotency key, then shows them handed in', async () => {
    mount();
    const button = await screen.findByRole('button', { name: 'Move 1,320,000 IQD to the safe' });
    await userEvent.click(button);
    await waitFor(() => expect(calls.some((c) => c.fn === 'main_cash_hand_in_day')).toBe(true));
    const call = calls.find((c) => c.fn === 'main_cash_hand_in_day')!;
    expect(call.args.p_day_session_id).toBe('ds1');
    expect(call.args.p_boxes).toEqual([
      { box: 'cafe', amount_iqd: 1230000 },
      { box: 'desk', amount_iqd: 90000 },
    ]);
    expect(String(call.args.p_idempotency_key)).toMatch(/^safe\.handin:[0-9a-f-]{36}$/);
    expect(await screen.findByText('Moved 1,320,000 IQD to the safe.')).toBeTruthy();
    expect(within(screen.getByTestId('hand-in-cafe')).getByText('Handed in 1,230,000 IQD')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /to the safe$/ })).toBeNull();
    expect(screen.getByText('This day’s cash is in the safe.')).toBeTruthy();
  });

  it('sends what the manager typed, skips a box left at 0, and reads it as kept', async () => {
    handIn = () => ({ handed_in: 1, total_iqd: 1000000, balance_iqd: 1000000 });
    mount();
    await screen.findByText('Café till');
    await userEvent.clear(input('Café till: cash to the safe'));
    await userEvent.type(input('Café till: cash to the safe'), '1000000');
    await userEvent.clear(input('Court desk: cash to the safe'));
    const button = await screen.findByRole('button', { name: 'Move 1,000,000 IQD to the safe' });
    await userEvent.click(button);
    await waitFor(() => expect(calls.some((c) => c.fn === 'main_cash_hand_in_day')).toBe(true));
    expect(calls.find((c) => c.fn === 'main_cash_hand_in_day')!.args.p_boxes).toEqual([{ box: 'cafe', amount_iqd: 1000000 }]);
    expect(await within(screen.getByTestId('hand-in-desk')).findByText('Kept in the drawer')).toBeTruthy();
  });

  it('holds the button when every amount is 0', async () => {
    mount();
    await screen.findByText('Café till');
    await userEvent.clear(input('Café till: cash to the safe'));
    await userEvent.clear(input('Court desk: cash to the safe'));
    const button = (await screen.findByRole('button', { name: 'Move 0 IQD to the safe' })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('shows a refusal beside the button and keeps the rows', async () => {
    handIn = () => new AppRpcError('MAIN_CASH_HANDED_IN', 'MAIN_CASH_HANDED_IN');
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Move 1,320,000 IQD to the safe' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText('Café till: cash to the safe')).toBeTruthy();
  });

  it('collapses to one line with the way to the Safe page on "Not now"', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.getByText('Not handed in. You can do it from the Safe page.')).toBeTruthy();
    expect(screen.queryByText('Café till')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open the Safe page' }));
    expect(navigate).toHaveBeenCalledWith({ href: '/safe' });
  });

  it('says there is nothing to hand in when no box took cash', async () => {
    boxes = [
      { box: 'cafe', cash_in_iqd: 0, cash_out_iqd: 0, net_iqd: 0, handed_in_iqd: null },
      { box: 'desk', cash_in_iqd: 0, cash_out_iqd: 0, net_iqd: 0, handed_in_iqd: null },
    ];
    mount();
    expect(await screen.findByText('No cash to hand in for this day.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers a retry when the drawers cannot be read', async () => {
    failBoxes = true;
    mount();
    expect(await screen.findByText('The drawers could not be loaded.')).toBeTruthy();
    failBoxes = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Café till')).toBeTruthy();
  });

  it('pending mode stays silent when every box is handed in', async () => {
    boxes = [{ box: 'cafe', cash_in_iqd: 5000, cash_out_iqd: 0, net_iqd: 5000, handed_in_iqd: 5000 }];
    const { container } = mount('pending');
    await waitFor(() => expect(calls.some((c) => c.fn === 'main_cash_day_boxes')).toBe(true));
    expect(container.textContent).toBe('');
  });

  it('pending mode names the closed day when its cash is still in the drawers', async () => {
    mount('pending');
    expect(await screen.findByText(/Business day .* is closed, but its cash has not reached the safe yet\./)).toBeTruthy();
  });
});

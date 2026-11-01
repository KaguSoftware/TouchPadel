import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';

// F-32: a share taken in cash goes through the cash pane, so the cashier sees
// the change to give; it used to be recorded as tendered exactly.

vi.mock('../../lib/appRpc', () => ({
  AppRpcError: class extends Error {},
  appRpc: vi.fn(async (fn: string) => (fn === 'split_evenly' ? [6000, 6000] : null)),
}));

import { SplitBillDialog } from './SplitBillDialog';

function mount(onSettleShare = vi.fn(async () => true)) {
  render(
    <LocaleProvider>
      <SplitBillDialog tabId="t1" lines={[]} due={12_000} busy={false} settleError={null} onSettleShare={onSettleShare} onClose={vi.fn()} />
    </LocaleProvider>,
  );
  return onSettleShare;
}

describe('SplitBillDialog — cash shares (F-32)', () => {
  it('asks what was handed over, shows the change, and sends the tender with the share', async () => {
    const onSettleShare = mount();
    const cash = await screen.findAllByRole('button', { name: 'Cash' });
    await userEvent.click(cash[0]!);
    const panes = await screen.findAllByRole('dialog');
    const pane = within(panes[panes.length - 1]!);
    await userEvent.type(pane.getByRole('textbox', { name: 'Tendered' }), '10000');
    expect(pane.getByRole('status').textContent).toMatch(/4,000/);
    await userEvent.click(pane.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(onSettleShare).toHaveBeenCalledWith(6000, 'cash', 10_000));
    expect(await screen.findByText(/Change 4,000/)).toBeTruthy();
  });

  it('a card share is recorded straight away, with no tender', async () => {
    const onSettleShare = mount();
    const card = await screen.findAllByRole('button', { name: 'Card' });
    await userEvent.click(card[0]!);
    await waitFor(() => expect(onSettleShare).toHaveBeenCalledWith(6000, 'card', null));
  });

  it('closing the cash pane takes nothing', async () => {
    const onSettleShare = mount();
    await userEvent.click((await screen.findAllByRole('button', { name: 'Cash' }))[0]!);
    const panes = await screen.findAllByRole('dialog');
    await userEvent.click(within(panes[panes.length - 1]!).getByRole('button', { name: 'Cancel' }));
    expect(onSettleShare).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
import { ToastProvider } from '../../components/toast';
import { PaymentPane, quickTenders } from './PaymentPane';

describe('quickTenders', () => {
  it('offers the exact amount, then the round sums a guest pays it with', () => {
    expect(quickTenders(18_000)).toEqual([18_000, 20_000, 25_000, 50_000]);
    expect(quickTenders(8_000)).toEqual([8_000, 10_000, 25_000, 50_000]);
  });
  it('does not repeat an amount that is already round', () => {
    expect(quickTenders(10_000)).toEqual([10_000, 25_000, 50_000]);
  });
  it('offers nothing when nothing is owed', () => {
    expect(quickTenders(0)).toEqual([]);
  });
});

function renderCash(over: Partial<Parameters<typeof PaymentPane>[0]> = {}) {
  const onSettle = vi.fn();
  render(
    <LocaleProvider>
      <ToastProvider>
        <PaymentPane mode="cash" due={18_000} busy={false} error={null} onCancel={vi.fn()} onSettle={onSettle} {...over} />
      </ToastProvider>
    </LocaleProvider>,
  );
  return { onSettle };
}

describe('PaymentPane — cash', () => {
  it('prints the amount to pay once, and opens without a shortfall alarm', () => {
    renderCash();
    expect(screen.getAllByText('18,000 IQD')).toHaveLength(1);
    expect(screen.queryByText(/short/i)).toBeNull();
    // Record says why it cannot be pressed yet — once.
    expect(screen.getAllByText('Enter what the guest handed over.')).toHaveLength(1);
  });

  it('a note button tenders it and says the change to give', async () => {
    const user = userEvent.setup();
    const { onSettle } = renderCash();
    await user.click(screen.getByRole('button', { name: '20,000 IQD' }));
    expect(screen.getByText('Change to give')).toBeTruthy();
    expect(screen.getByText('2,000 IQD')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(onSettle).toHaveBeenCalledWith('cash', null, 20_000);
  });

  it('"Exact amount" tenders the due with no change', async () => {
    const user = userEvent.setup();
    const { onSettle } = renderCash();
    await user.click(screen.getByRole('button', { name: 'Exact amount' }));
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(onSettle).toHaveBeenCalledWith('cash', null, 18_000);
  });

  it('a short tender says by how much and cannot be recorded', async () => {
    const user = userEvent.setup();
    const { onSettle } = renderCash();
    await user.type(screen.getByLabelText('Tendered'), '15000');
    expect(screen.getByText('Still short')).toBeTruthy();
    expect(screen.getByText('3,000 IQD')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(onSettle).not.toHaveBeenCalled();
  });

});

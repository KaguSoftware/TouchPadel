import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../lib/i18n';

const printReceipt = vi.fn();
const printWithSystemDialog = vi.fn();
vi.mock('../lib/print', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  printReceipt: (job: unknown) => printReceipt(job),
  printWithSystemDialog: (html: unknown) => printWithSystemDialog(html),
}));

const { PrintStatus, usePrint } = await import('./PrintStatus');

function Harness() {
  const printer = usePrint('till_bill', () => '<p>receipt</p>');
  return (
    <LocaleProvider>
      <button type="button" onClick={() => void printer.print()}>
        go
      </button>
      <PrintStatus printer={printer} />
    </LocaleProvider>
  );
}

beforeEach(() => {
  printReceipt.mockReset();
  printWithSystemDialog.mockReset();
});

describe('PrintStatus (F-30)', () => {
  it('a missing printer says so, and offers Print again and another printer', async () => {
    printReceipt.mockResolvedValue({ ok: false, reason: 'no-printer', detail: null });
    render(<Harness />);
    await userEvent.click(screen.getByText('go'));
    const status = await screen.findByTestId('print-status');
    expect(status.getAttribute('data-state')).toBe('no-printer');
    expect(status.textContent).toContain('no receipt printer is set up on this station');
    await userEvent.click(screen.getByTestId('print-elsewhere'));
    expect(printWithSystemDialog).toHaveBeenCalledWith('<p>receipt</p>');
    printReceipt.mockResolvedValue({ ok: true, via: 'printer' });
    await userEvent.click(screen.getByTestId('print-again'));
    expect(printReceipt).toHaveBeenLastCalledWith({ html: '<p>receipt</p>', what: 'till_bill', again: true, browser: 'page' });
    expect((await screen.findByTestId('print-status')).getAttribute('data-state')).toBe('printed');
  });

  it('a printed receipt still offers Print again, and no other printer', async () => {
    printReceipt.mockResolvedValue({ ok: true, via: 'printer' });
    render(<Harness />);
    await userEvent.click(screen.getByText('go'));
    expect((await screen.findByTestId('print-status')).textContent).toContain('Sent to the printer.');
    expect(screen.getByTestId('print-again')).toBeTruthy();
    expect(screen.queryByTestId('print-elsewhere')).toBeNull();
  });
});

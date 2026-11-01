import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../lib/i18n';

// F-15: every crash screen carries "Report crash", which sends the error to
// dev monitoring itself (userReported) and says what happened to the report.

const reportError = vi.fn();
vi.mock('../lib/monitoring', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

import { CrashPanel } from './CrashScreen';

beforeEach(() => {
  reportError.mockReset();
});

function renderPanel() {
  return render(
    <LocaleProvider>
      <CrashPanel error={new Error('KABOOM')} onRetry={() => {}} />
    </LocaleProvider>,
  );
}

describe('Report crash', () => {
  it('sends the error as user reported and confirms "Sent"', async () => {
    reportError.mockResolvedValue('sent');
    renderPanel();
    const button = screen.getByTestId('crash-report');
    expect(button.textContent).toContain('Report crash');
    await userEvent.click(button);
    expect(reportError).toHaveBeenCalledTimes(1);
    const [kind, error, opts] = reportError.mock.calls[0]!;
    expect(kind).toBe('crash');
    expect((error as Error).message).toBe('KABOOM');
    expect(opts).toMatchObject({ userReported: true });
    expect(await screen.findByText('Sent. Thank you.')).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('says it will go out later when the station is offline', async () => {
    reportError.mockResolvedValue('queued');
    renderPanel();
    await userEvent.click(screen.getByTestId('crash-report'));
    expect(await screen.findByText('Saved. It goes out when the connection is back.')).toBeTruthy();
  });

  it('lets the person try again when it failed', async () => {
    reportError.mockResolvedValue('failed');
    renderPanel();
    await userEvent.click(screen.getByTestId('crash-report'));
    expect(await screen.findByText('Could not send it. Try again.')).toBeTruthy();
    expect((screen.getByTestId('crash-report') as HTMLButtonElement).disabled).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
import { MatchReadNotice } from './MatchReadNotice';

// operator.md §5.5: a first read that failed says so with Retry; kept data says how old it is.

function renderNotice(status: Parameters<typeof MatchReadNotice>[0]['status'], onRetry = vi.fn(), compact = false) {
  const { container } = render(
    <LocaleProvider>
      <MatchReadNotice status={status} onRetry={onRetry} tz="Asia/Baghdad" compact={compact} />
    </LocaleProvider>,
  );
  return { container, onRetry };
}

describe('MatchReadNotice', () => {
  it('a failed first read: the line and Retry', async () => {
    const user = userEvent.setup();
    const { onRetry } = renderNotice({ kind: 'failed', error: new TypeError('x') });
    expect(screen.getByText("Open matches can't be shown without a connection")).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('compact: one muted line, no button', () => {
    renderNotice({ kind: 'failed', error: new TypeError('x') }, vi.fn(), true);
    expect(screen.getByText("Open matches can't be shown without a connection")).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('stale data: Last updated {time}; fresh data, loading and absent: nothing', () => {
    renderNotice({ kind: 'ready', data: 1, stale: true, updatedAt: Date.parse('2026-10-01T18:05:00Z') });
    expect(screen.getByText(/^Last updated /)).toBeTruthy();
    for (const status of [
      { kind: 'ready' as const, data: 1, stale: false, updatedAt: 1 },
      { kind: 'loading' as const },
      { kind: 'absent' as const },
    ]) {
      const { container } = renderNotice(status);
      expect(container.textContent).toBe('');
    }
  });
});

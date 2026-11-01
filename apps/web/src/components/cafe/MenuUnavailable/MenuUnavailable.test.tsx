import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { t } from '@touch/i18n';
import { MenuUnavailable } from './MenuUnavailable';

/**
 * The menu stage with no menu (F-43): empty and failed are two different screens, and the
 * failed one's Retry calls through and, once it has not helped, says what to do instead.
 */
describe.each(['en', 'ar'] as const)('MenuUnavailable (%s)', (locale) => {
  it('an empty menu is a plain fact: no spinner, no retry', () => {
    render(
      <MenuUnavailable locale={locale} status="empty" retrying={false} canRefresh onRetry={() => {}} />,
    );
    const status = screen.getByRole('status');
    expect(status.getAttribute('data-state')).toBe('empty');
    expect(screen.getByText(t(locale, 'cafe.menuEmpty.title'))).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a failed load retries, and explains once the retry has not helped', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <MenuUnavailable locale={locale} status="error" retrying={false} canRefresh onRetry={onRetry} />,
    );
    expect(screen.getByText(t(locale, 'cafe.menuUnavailable.title'))).toBeTruthy();
    expect(screen.queryByText(t(locale, 'cafe.menuUnavailable.stillDown'))).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: t(locale, 'common.retry') }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<MenuUnavailable locale={locale} status="error" retrying canRefresh onRetry={onRetry} />);
    expect(screen.getByRole('button', { name: t(locale, 'common.loading') })).toHaveProperty('disabled', true);
    rerender(
      <MenuUnavailable locale={locale} status="error" retrying={false} canRefresh onRetry={onRetry} />,
    );
    expect(screen.getByText(t(locale, 'cafe.menuUnavailable.stillDown'))).toBeTruthy();
  });

  it('explains at once when the page cannot reach the menu itself', () => {
    render(
      <MenuUnavailable
        locale={locale}
        status="error"
        retrying={false}
        canRefresh={false}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(t(locale, 'cafe.menuUnavailable.stillDown'))).toBeTruthy();
    expect(screen.getByRole('button', { name: t(locale, 'common.retry') })).toBeTruthy();
  });
});

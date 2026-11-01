import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { t } from '@touch/i18n';
import { SITE_MODE_COOKIE } from '@/lib/site/mode';
import LocaleError from './error';

/**
 * The segment error boundary: "Let. Play that one again." It is a client component that
 * reads its locale from `useParams()` (an error boundary gets no `params`), so the locale
 * is driven through the mock below. `reset()` is the way back for a guest whose page blew
 * up, so it is asserted as a real click. Its sheet's size budget is in site-css.test.ts.
 */
const nav = vi.hoisted(() => ({ locale: 'ar' as string | undefined }));

/** What reached dev monitoring (F-43). */
const reports = vi.hoisted(() => [] as { kind: string; userReported?: boolean; detail?: unknown }[]);
vi.mock('@/lib/monitoring', () => ({
  reportError: (kind: string, _e: unknown, opts: { userReported?: boolean; detail?: unknown } = {}) => {
    reports.push({ kind, userReported: opts.userReported, detail: opts.detail });
    return Promise.resolve('sent');
  },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: nav.locale }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

beforeEach(() => {
  reports.length = 0;
  // The boundary logs the error it caught; keep the suite output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('locale error boundary', () => {
  it('says what happened, retries through reset() and links home', async () => {
    nav.locale = 'en';
    const reset = vi.fn();
    render(<LocaleError error={new Error('x')} reset={reset} />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('en', 'site.error.title'));
    await userEvent.click(screen.getByRole('button', { name: t('en', 'site.error.retry') }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: t('en', 'site.error.home') }).getAttribute('href')).toBe(
      '/en',
    );
  });

  it('falls back to Arabic, the default locale, without a locale param', () => {
    nav.locale = undefined;
    render(<LocaleError error={new Error('x')} reset={() => {}} />);
    expect(screen.getByText(t('ar', 'site.error.body'))).toBeTruthy();
  });

  it('is night by default and follows a saved light mode', () => {
    const { unmount } = render(<LocaleError error={new Error('x')} reset={() => {}} />);
    expect(document.querySelector('[data-theme="padel"]')?.getAttribute('data-mode')).toBe('night');
    unmount();

    document.cookie = `${SITE_MODE_COOKIE}=light; Path=/`;
    render(<LocaleError error={new Error('x')} reset={() => {}} />);
    expect(document.querySelector('[data-theme="padel"]')?.getAttribute('data-mode')).toBe('light');
    document.cookie = `${SITE_MODE_COOKIE}=; Path=/; Max-Age=0`;
  });

  it.each(['en', 'ar'] as const)(
    'retries through Next 16 retry() (a fresh server fetch), not reset() (%s)',
    async (locale) => {
      nav.locale = locale;
      const retry = vi.fn();
      const reset = vi.fn();
      render(<LocaleError error={new Error('x')} retry={retry} reset={reset} />);
      await userEvent.click(screen.getByRole('button', { name: t(locale, 'site.error.retry') }));
      expect(retry).toHaveBeenCalledTimes(1);
      expect(reset).not.toHaveBeenCalled();
    },
  );

  it.each(['en', 'ar'] as const)(
    'reports the error to monitoring on open, and again from the Report button (%s)',
    async (locale) => {
      nav.locale = locale;
      const boom = Object.assign(new Error('x'), { digest: 'dg-9' });
      render(<LocaleError error={boom} retry={() => {}} />);
      expect(reports).toEqual([
        { kind: 'web_error', userReported: undefined, detail: { where: 'route', digest: 'dg-9' } },
      ]);

      await userEvent.click(screen.getByRole('button', { name: t(locale, 'site.error.report') }));
      expect(reports[1]).toEqual({
        kind: 'crash',
        userReported: true,
        detail: { where: 'route', digest: 'dg-9' },
      });
      expect(screen.getByRole('status').textContent).toBe(t(locale, 'site.error.reported'));
      expect(
        (screen.getByRole('button', { name: t(locale, 'site.error.report') }) as HTMLButtonElement).disabled,
      ).toBe(true);
    },
  );
});

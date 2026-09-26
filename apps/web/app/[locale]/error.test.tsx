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

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: nav.locale }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

beforeEach(() => {
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
});

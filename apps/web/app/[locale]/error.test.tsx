import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { t, type Locale } from '@touch/i18n';
import { SITE_MODE_COOKIE } from '@/lib/site/mode';
import LocaleError from './error';

/**
 * The segment error boundary: "Let. Play that one again." It is a client component that
 * reads its locale from `useParams()` (an error boundary gets no `params`), so the locale
 * is driven through the mock below; its mode comes from the `tp-site-mode` cookie.
 *
 * `reset()` is the way back for a guest whose page blew up, so it is asserted as a real
 * click, and the page carries only its own small sheet (it ships inside every route of
 * the segment, the café menu's included).
 */
const nav = vi.hoisted(() => ({ locale: 'ar' as string | undefined }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: nav.locale }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const LOCALES = ['en', 'ar'] as const;

beforeEach(() => {
  // The boundary logs the error it caught; keep the suite output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  document.cookie = `${SITE_MODE_COOKIE}=; Max-Age=0; Path=/`;
});

describe.each(LOCALES)('locale error boundary (%s)', (locale: Locale) => {
  beforeEach(() => {
    nav.locale = locale;
  });

  it('says what happened in the reading language', () => {
    render(<LocaleError error={new Error('x')} reset={() => {}} />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      t(locale, 'site.error.title'),
    );
    expect(screen.getByText(t(locale, 'site.error.body'))).toBeTruthy();
    expect(screen.getByRole('button', { name: t(locale, 'site.error.retry') })).toBeTruthy();
    // The other language's copy must not be on the page.
    expect(screen.queryByText(t(locale === 'ar' ? 'en' : 'ar', 'site.error.body'))).toBeNull();
  });

  it('calls reset when the retry button is pressed', async () => {
    const reset = vi.fn();
    render(<LocaleError error={new Error('x')} reset={reset} />);

    await userEvent.click(screen.getByRole('button', { name: t(locale, 'site.error.retry') }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('links home with a plain anchor', () => {
    render(<LocaleError error={new Error('x')} reset={() => {}} />);
    expect(
      screen.getByRole('link', { name: t(locale, 'site.error.home') }).getAttribute('href'),
    ).toBe(`/${locale}`);
  });

  it('is night by default and follows a saved light mode', () => {
    const { unmount } = render(<LocaleError error={new Error('x')} reset={() => {}} />);
    expect(document.querySelector('[data-theme="padel"]')?.getAttribute('data-mode')).toBe('night');
    unmount();

    document.cookie = `${SITE_MODE_COOKIE}=light; Path=/`;
    render(<LocaleError error={new Error('x')} reset={() => {}} />);
    expect(document.querySelector('[data-theme="padel"]')?.getAttribute('data-mode')).toBe('light');
  });

  it('ships its own small sheet, not the whole site stylesheet', () => {
    render(<LocaleError error={new Error('x')} reset={() => {}} />);
    const css = document.querySelector('style')?.textContent ?? '';
    expect(css).toContain('.tp-lost');
    expect(css).not.toContain('.tp-front');
    expect(css.length).toBeLessThan(4000);
  });
});

describe('locale error boundary without a locale param', () => {
  it('falls back to Arabic, the default locale', () => {
    nav.locale = undefined;
    render(<LocaleError error={new Error('x')} reset={() => {}} />);
    expect(screen.getByText(t('ar', 'site.error.body'))).toBeTruthy();
  });
});

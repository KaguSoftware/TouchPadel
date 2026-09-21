import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { t, type Locale } from '@touch/i18n';
import LocaleError from './error';

/**
 * The segment error boundary. It is a client component that reads its locale
 * from `useParams()` (there are no `params` props in an error boundary), so the
 * locale is driven through the mock below.
 *
 * `reset()` is the only interactive thing on the page and the only way back for
 * a guest whose menu blew up mid-scan — it is asserted as a real click.
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

describe.each(LOCALES)('locale error boundary (%s)', (locale: Locale) => {
  beforeEach(() => {
    nav.locale = locale;
  });

  it('says what went wrong in the reading language', async () => {
    render(<LocaleError error={new Error('x')} reset={() => {}} />);

    expect(screen.getByText(t(locale, 'errors.generic'))).toBeTruthy();
    expect(screen.getByRole('button', { name: t(locale, 'common.retry') })).toBeTruthy();
    // The other language's copy must not be on the page.
    expect(screen.queryByText(t(locale === 'ar' ? 'en' : 'ar', 'errors.generic'))).toBeNull();
  });

  it('calls reset when the retry button is pressed', async () => {
    const reset = vi.fn();
    render(<LocaleError error={new Error('x')} reset={reset} />);

    await userEvent.click(screen.getByRole('button', { name: t(locale, 'common.retry') }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe('locale error boundary without a locale param', () => {
  it('falls back to Arabic, the default locale', () => {
    nav.locale = undefined;
    render(<LocaleError error={new Error('x')} reset={() => {}} />);
    expect(screen.getByText(t('ar', 'errors.generic'))).toBeTruthy();
  });
});

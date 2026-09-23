import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { t, type Locale } from '@touch/i18n';
import { resetServerData } from '@/test/fixtures';
import { renderServerPage } from '@/test/renderPage';
import DeleteAccountPage from './page';

/**
 * The Google Play account-deletion URL. Play's reviewer reads it without the
 * app, so the page must explain deletion in server-rendered text — what is
 * deleted, what is kept, the in-app path — and carry both the web form and a
 * way to ask when signing in is not possible. The form itself is
 * DeleteAccountForm.test.tsx.
 */
vi.mock('@/lib/menu.server', async () => {
  const { serverData } = await import('@/test/fixtures');
  return {
    getCachedMenu: () => Promise.resolve(serverData.menu),
    getCachedCafeSettings: () => Promise.resolve(serverData.settings),
    getCachedVenue: () => Promise.resolve(serverData.venue),
  };
});

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

// The form's Supabase client is created on first use; a page render never
// touches it, so nothing here needs a live project.
vi.mock('@/lib/supabase/client', () => ({
  createEphemeralBrowserSupabase: () => {
    throw new Error('not in a page render');
  },
}));

const LOCALES = ['en', 'ar'] as const;

beforeEach(() => {
  resetServerData();
});

describe.each(LOCALES)('delete-account page (%s)', (locale: Locale) => {
  it('explains deletion in server-rendered text', async () => {
    await renderServerPage(DeleteAccountPage, locale);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t(locale, 'legal.deleteAccount.title'));
    expect(screen.getByText(t(locale, 'legal.deleteAccount.inApp.body'))).toBeTruthy();
    expect(screen.getByText(t(locale, 'legal.deleteAccount.what.deleted'))).toBeTruthy();
    expect(screen.getByText(t(locale, 'legal.deleteAccount.what.kept'))).toBeTruthy();
    expect(
      screen.getByRole('link', { name: t(locale, 'legal.deleteAccount.what.more') }).getAttribute('href'),
    ).toBe(`/${locale}/privacy#retention`);
  });

  it('carries the sign-in form inside the web section', async () => {
    await renderServerPage(DeleteAccountPage, locale);

    const web = document.querySelector('section#web');
    const form = screen.getByRole('form', { name: t(locale, 'legal.deleteAccount.form.label') });
    expect(web?.contains(form)).toBe(true);
    expect(screen.getByRole('button', { name: t(locale, 'legal.deleteAccount.form.signIn') })).toBeTruthy();
  });

  it('offers a request route for anyone who cannot sign in', async () => {
    await renderServerPage(DeleteAccountPage, locale);

    const request = document.querySelector('section#request');
    expect(request?.querySelector('a[href^="tel:"]')).not.toBeNull();
    // The privacy email is still a placeholder, so no mailto: button yet.
    expect(request?.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it('is marked as the current page in the legal nav', async () => {
    await renderServerPage(DeleteAccountPage, locale);

    const nav = screen.getByRole('navigation', { name: t(locale, 'legal.nav.label') });
    expect(nav.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe(`/${locale}/delete-account`);
  });
});

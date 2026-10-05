import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { t, type Locale } from '@touch/i18n';
import { resetServerData } from '@/test/fixtures';
import { renderServerPage } from '@/test/renderPage';
import { fakeAccountClient, type FakeUser } from '@/test/accountFakes';
import AccountPage, { generateMetadata } from './page';

/**
 * /{locale}/account (loyalty plan §5.2): the server renders the shell and the heading, the
 * client island signs in through the account client and shows the member card and points.
 * The account client is mocked at `@/lib/supabase/client`; never a live Supabase.
 */
vi.mock('@/lib/menu.server', async () => {
  const { serverData } = await import('@/test/fixtures');
  return {
    getCachedMenu: () => Promise.resolve(serverData.menu),
    getCachedCafeSettings: () => Promise.resolve(serverData.settings),
    getCachedVenue: () => Promise.resolve(serverData.venue),
  };
});

vi.mock('@/lib/site/mode.server', async () => {
  const { siteRequest } = await import('@/lib/site/testSupport');
  return {
    getSiteMode: () => Promise.resolve(siteRequest.mode),
    getRequestNonce: () => Promise.resolve(siteRequest.nonce),
  };
});

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

/** What the mocked account client factory hands out in the current case. */
const account: { client: unknown } = { client: null };

vi.mock('@/lib/supabase/client', () => ({
  accountBrowserSupabase: () => account.client,
}));

const SARA: FakeUser = { id: 'u1', phone: '9647701234567', user_metadata: { given_name: 'Sara' } };

beforeEach(() => {
  resetServerData();
  account.client = null;
});

describe.each(['en', 'ar'] as const)('account page (%s)', (locale: Locale) => {
  it('is never indexed', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ locale }) });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.title).toBe(t(locale, 'loyalty.web.account.metaTitle'));
  });

  it('signed out: the heading and the sign-in form', async () => {
    account.client = fakeAccountClient().client;
    await renderServerPage(AccountPage, locale);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      t(locale, 'loyalty.web.account.title'),
    );
    expect(await screen.findByLabelText(t(locale, 'loyalty.web.signIn.phoneLabel'))).toBeTruthy();
    expect(screen.getByLabelText(t(locale, 'loyalty.web.signIn.passwordLabel'))).toBeTruthy();
    expect(
      screen.getByRole('button', { name: t(locale, 'loyalty.web.signIn.submit') }),
    ).toBeTruthy();
    // Google and Apple wait for NEXT_PUBLIC_WEB_OAUTH.
    expect(screen.queryByText(t(locale, 'loyalty.web.signIn.google'))).toBeNull();
    // The footer links the page.
    const links = screen.getAllByRole('link', { name: t(locale, 'loyalty.web.account.navLink') });
    expect(links[0]!.getAttribute('href')).toBe(`/${locale}/account`);
  });

  it('signed in: the member card, the balance, the tier, rewards and history', async () => {
    account.client = fakeAccountClient({ user: SARA }).client;
    await renderServerPage(AccountPage, locale);

    expect(await screen.findByText(t(locale, 'loyalty.web.account.card.title'))).toBeTruthy();
    const qr = screen.getByRole('img', { name: t(locale, 'loyalty.web.account.card.qrLabel') });
    expect(qr.getAttribute('data-token')).toMatch(/^TP-8F3K2QXM-\d{6}$/);
    expect(screen.getByText('8F3K2QXM')).toBeTruthy();
    expect(screen.getByText('0770 123 4567')).toBeTruthy();
    expect(screen.getByText(t(locale, 'loyalty.web.account.hello', { name: 'Sara' }))).toBeTruthy();
    expect(screen.getByText(t(locale, 'loyalty.web.account.balanceTitle'))).toBeTruthy();
    expect(
      screen.getByText(
        t(locale, 'loyalty.web.account.tier', { tier: locale === 'ar' ? 'عضو' : 'Member' }),
      ),
    ).toBeTruthy();
    expect(screen.getByText(locale === 'ar' ? 'قهوة مجانية' : 'Free coffee')).toBeTruthy();
    expect(screen.getByText(t(locale, 'loyalty.web.account.history.kind.earn'))).toBeTruthy();
    expect(
      screen.getByRole('button', { name: t(locale, 'loyalty.web.account.signOut') }),
    ).toBeTruthy();
  });

  it('signs in by phone, then shows the card', async () => {
    const { client } = fakeAccountClient();
    account.client = client;
    await renderServerPage(AccountPage, locale);

    fireEvent.change(await screen.findByLabelText(t(locale, 'loyalty.web.signIn.phoneLabel')), {
      target: { value: '0770 123 4567' },
    });
    fireEvent.change(screen.getByLabelText(t(locale, 'loyalty.web.signIn.passwordLabel')), {
      target: { value: 'secret-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'loyalty.web.signIn.submit') }));

    await waitFor(() =>
      expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
        phone: '+9647701234567',
        password: 'secret-password',
      }),
    );
    expect(await screen.findByText(t(locale, 'loyalty.web.account.card.title'))).toBeTruthy();
  });

  it('with no Supabase env: says so instead of a blank page', async () => {
    account.client = null;
    await renderServerPage(AccountPage, locale);
    expect(await screen.findByText(t(locale, 'loyalty.web.account.unavailable'))).toBeTruthy();
  });

  it('keeps only an on-site ?return= (the café chip’s way back)', async () => {
    account.client = fakeAccountClient().client;
    await renderServerPage(AccountPage, locale, { return: `/${locale}/menu` });
    const back = await screen.findByRole('link', { name: t(locale, 'loyalty.web.account.back') });
    expect(back.getAttribute('href')).toBe(`/${locale}/menu`);
  });

  it('drops a ?return= to another site', async () => {
    account.client = fakeAccountClient().client;
    await renderServerPage(AccountPage, locale, { return: '//evil.example/x' });
    await screen.findByLabelText(t(locale, 'loyalty.web.signIn.phoneLabel'));
    expect(screen.queryByRole('link', { name: t(locale, 'loyalty.web.account.back') })).toBeNull();
  });
});

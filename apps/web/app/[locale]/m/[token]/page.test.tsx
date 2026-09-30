import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { countPhrase, t, type Locale } from '@touch/i18n';
import { resetSiteRequest } from '@/lib/site/testSupport';
import { inviteWhen, type MatchInvite } from '@/lib/site/matchInvite';
import MatchInvitePage, { dynamic, generateMetadata } from './page';

/**
 * The open-match invite, `/{locale}/m/<token>` (guest.md §4.20). What this proves in both
 * languages: each state of the read renders its own words from the catalog; nothing names
 * a player, a phone, a price or an id even when the server's answer carries them (DF-9,
 * GD-4); the page is never indexed and sends no referrer; its share image is static; the
 * Open in the app button carries the app's match link and nothing jumps by itself; a
 * token that is no token is never sent. The read is mocked at
 * `@/lib/site/matchInvite.server`; its parsing is matchInvite.test.ts, the rendered
 * direction and the live headers are Playwright's.
 */
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

/**
 * What the mocked read answers, as mutable state (a module mock factory runs once, and
 * `restoreMocks: true` would wipe a `vi.fn()` implementation between cases). `raw` goes
 * through the real parser, as the server read does; `answer`, when set, is returned as is.
 */
const read = vi.hoisted(() => ({
  raw: null as unknown,
  answer: null as unknown,
  tokens: [] as string[],
}));

vi.mock('@/lib/site/matchInvite.server', async () => {
  const { parseMatchInvite } = await import('@/lib/site/matchInvite');
  return {
    readMatchInvite: (token: string) => {
      read.tokens.push(token);
      return Promise.resolve((read.answer as MatchInvite | null) ?? parseMatchInvite(read.raw));
    },
  };
});

const TOKEN = 'Ab3_-x9ZqT0kLm2NpQr7sU';
const MATCH_ID = '7c1d2a44-0f3e-4b8a-9d61-2f5e8c9a1b30';
const LOCALES = ['en', 'ar'] as const;

/** An open invite, plus everything the page must never show should the server send it. */
const OPEN = {
  status: 'open',
  start_at: '2026-10-01T16:30:00+00:00',
  end_at: '2026-10-01T18:00:00+00:00',
  timezone: 'Asia/Baghdad',
  category: 'open',
  join_policy: 'open',
  seats_left: 2,
  venue: { name_en: 'Touch Padel Karbala', name_ar: 'تتش بادل كربلاء', id: 'b1a0c3d2-0000-4000-8000-000000000001' },
  match_id: MATCH_ID,
  organiser: { first_name: 'Ahmed', family_name: 'Kareem', phone: '+9647701234567', id: 'p-organiser' },
  players: [{ name: 'Ahmed K.' }, { name: 'Zainab H.' }],
  share_iqd: 10000,
  price_iqd: 40000,
};

/** Every word a visitor or a screen reader meets: text (no stylesheet) plus labels and links. */
function readableText(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('style').forEach((node) => node.remove());
  const attrs = Array.from(copy.querySelectorAll('[aria-label],[title],[alt],[href]')).flatMap((el) =>
    ['aria-label', 'title', 'alt', 'href'].map((name) => el.getAttribute(name) ?? ''),
  );
  return [copy.textContent ?? '', ...attrs].join(' ');
}

async function renderInvite(locale: string, token: string = TOKEN) {
  const element = await MatchInvitePage({ params: Promise.resolve({ locale, token }) });
  return render(element);
}

const metadata = (locale: string) =>
  generateMetadata({ params: Promise.resolve({ locale, token: TOKEN }) });

const heading = () => screen.getByRole('heading', { level: 1 }).textContent;

beforeEach(() => {
  resetSiteRequest();
  read.raw = OPEN;
  read.answer = null;
  read.tokens = [];
});

describe.each(LOCALES)('match invite page (%s)', (locale: Locale) => {
  it('shows an open match: when, where, who may join and the seats left', async () => {
    await renderInvite(locale);

    expect(screen.getByText(t(locale, 'matches.web.eyebrow'))).toBeTruthy();
    const when = inviteWhen(OPEN.start_at, OPEN.timezone, locale);
    expect(heading()).toBe(t(locale, 'matches.web.when', when!));
    expect(screen.getByText(locale === 'ar' ? OPEN.venue.name_ar : OPEN.venue.name_en)).toBeTruthy();
    expect(screen.getByText(t(locale, 'matches.web.category.open'))).toBeTruthy();
    expect(screen.getByText(countPhrase('matches.count.seatsLeft', 2, locale))).toBeTruthy();
    // Anyone joins this one, so no approval line.
    expect(screen.queryByText(t(locale, 'matches.web.approve'))).toBeNull();
    expect(read.tokens).toEqual([TOKEN]);
  });

  it('says the organiser approves each player, in the feminine for a women-only match', async () => {
    read.raw = { ...OPEN, join_policy: 'approve', category: 'women' };
    await renderInvite(locale);
    expect(screen.getByText(t(locale, 'matches.web.category.women'))).toBeTruthy();
    expect(screen.getByText(t(locale, 'matches.web.approveF'))).toBeTruthy();

    read.raw = { ...OPEN, join_policy: 'approve', category: 'men' };
    const { container } = await renderInvite(locale);
    expect(container.textContent).toContain(t(locale, 'matches.web.category.men'));
    expect(container.textContent).toContain(t(locale, 'matches.web.approve'));
  });

  it('shows a full match as full, with no seat count and no approval line', async () => {
    read.raw = { ...OPEN, status: 'full', join_policy: 'approve', seats_left: 0 };
    const { container } = await renderInvite(locale);
    expect(screen.getByText(t(locale, 'matches.web.full'))).toBeTruthy();
    expect(heading()).toBe(t(locale, 'matches.web.when', inviteWhen(OPEN.start_at, OPEN.timezone, locale)!));
    expect(container.textContent).not.toContain(countPhrase('matches.count.seatsLeft', 0, locale));
    expect(container.textContent).not.toContain(t(locale, 'matches.web.approve'));
  });

  it('shows a closed match as no longer open, and nothing about it', async () => {
    read.raw = { status: 'closed' };
    const { container } = await renderInvite(locale);
    expect(heading()).toBe(t(locale, 'matches.web.closed'));
    expect(container.querySelector('.tp-minv__facts')).toBeNull();
  });

  it('shows a failed read as an error, never a blank', async () => {
    read.raw = undefined;
    await renderInvite(locale);
    expect(heading()).toBe(t(locale, 'matches.web.error'));
  });

  it('opens the app on its match link in every state, and never jumps there by itself', async () => {
    for (const raw of [OPEN, { ...OPEN, status: 'full' }, { status: 'closed' }, undefined]) {
      read.raw = raw;
      const { container, unmount } = await renderInvite(locale);
      const open = screen.getByRole('link', { name: t(locale, 'matches.web.open') });
      expect(open.getAttribute('href')).toBe(`touchpadel://m/${TOKEN}`);
      const get = screen.getByRole('link', { name: t(locale, 'matches.web.noApp') });
      expect(get.getAttribute('href')).toBe(`/${locale}#app`);
      expect(get.getAttribute('href')).not.toContain('/download');
      expect(container.querySelector('script')).toBeNull();
      unmount();
    }
  });

  it('names nobody and shows no phone, price or id, even when the answer carries them', async () => {
    const { container } = await renderInvite(locale);
    const text = readableText(container);
    for (const secret of ['Ahmed', 'Kareem', 'Zainab', '7701234567', '10000', '10,000', '40000', '40,000', MATCH_ID, 'p-organiser', OPEN.venue.id]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).not.toMatch(/IQD|د\.ع/);
  });

  it('shows only the card it was handed, whatever else rides on the object', async () => {
    read.answer = {
      status: 'open',
      card: {
        startAt: OPEN.start_at,
        timezone: OPEN.timezone,
        category: 'open',
        approve: false,
        seatsLeft: 1,
        venue: { name_en: OPEN.venue.name_en, name_ar: OPEN.venue.name_ar },
        organiser: 'Ahmed Kareem',
        phone: '+9647701234567',
        shareIqd: 10000,
        matchId: MATCH_ID,
      },
    };
    const { container } = await renderInvite(locale);
    const text = readableText(container);
    for (const secret of ['Ahmed', 'Kareem', '7701234567', '10000', '10,000', MATCH_ID]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('keeps the invite across the language switch, and offers home and support', async () => {
    await renderInvite(locale);
    const other = locale === 'en' ? 'ar' : 'en';
    const lang = document.querySelector(`a[hreflang="${other}"]`);
    expect(lang?.getAttribute('href')).toBe(`/${other}/m/${TOKEN}`);
    expect(screen.getByRole('link', { name: t(locale, 'site.brandHome') }).getAttribute('href')).toBe(
      `/${locale}`,
    );
    expect(
      screen.getByRole('link', { name: t(locale, 'site.footer.support') }).getAttribute('href'),
    ).toBe(`/${locale}/support`);
  });

  it('is never indexed, sends no referrer, and shares a static image', async () => {
    const meta = await metadata(locale);
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.referrer).toBe('no-referrer');
    expect(meta.title).toBe(t(locale, 'matches.web.metaTitle'));
    expect(meta.description).toBe(t(locale, 'matches.web.metaDescription'));
    const image = `/brand/site/og-touch-padel-${locale}.png`;
    expect(JSON.stringify(meta.openGraph)).toContain(image);
    expect(JSON.stringify(meta.twitter)).toContain(image);
    // No seat count and no names in the preview: WhatsApp caches it.
    expect(JSON.stringify(meta)).not.toMatch(/Ahmed|seat|مقعد/i);
  });

  it('paints in the visitor’s mode, in the padel theme, with its sheet under the nonce', async () => {
    const { container } = await renderInvite(locale);
    const frame = container.querySelector('.tp-minv');
    expect(frame?.getAttribute('data-theme')).toBe('padel');
    expect(frame?.getAttribute('data-mode')).toBe('night');
    expect(container.querySelector('style')?.getAttribute('nonce')).toBe('test-nonce-0123456789');
  });
});

describe('match invite page, the token', () => {
  it.each([
    ['too short', TOKEN.slice(1)],
    ['too long', `${TOKEN}x`],
    ['dotted', `${TOKEN.slice(0, 21)}.`],
    ['markup', '"><script>alert(1)</script>'],
  ])('never sends a token that is %s: closed, the app home, the other language’s home', async (_, token) => {
    await renderInvite('en', token);
    expect(read.tokens).toEqual([]);
    expect(heading()).toBe(t('en', 'matches.web.closed'));
    expect(screen.getByRole('link', { name: t('en', 'matches.web.open') }).getAttribute('href')).toBe(
      'touchpadel://',
    );
    expect(document.querySelector('a[hreflang="ar"]')?.getAttribute('href')).toBe('/ar');
  });
});

describe('match invite page, the route', () => {
  it('is rendered per request', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('404s on a segment that is not a locale', async () => {
    await expect(renderInvite('de')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(metadata('de')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sets no cookie and never jumps to the app: nothing on the page does either', () => {
    // Static, because a page render cannot observe a Set-Cookie or a navigation. The site's
    // LanguageLink and ThemeToggle both write a cookie on click, and OpenAppOnLoad jumps.
    const read_ = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    const sources = [read_('./page.tsx'), read_('../../../../src/lib/site/matchInvite.ts')];
    for (const src of sources) {
      expect(src).not.toMatch(/document\.cookie|cookies\(\)\)?\.set\(|set-cookie/i);
      expect(src).not.toMatch(/import[^;]*\b(LanguageLink|ThemeToggle|OpenAppOnLoad)\b/);
      expect(src).not.toMatch(/location\.(replace|assign|href\s*=)/);
    }
  });
});

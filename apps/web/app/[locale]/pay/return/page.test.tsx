import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { en, ar, t, type Locale } from '@touch/i18n';
import { renderServerPage } from '@/test/renderPage';
import { resetSiteRequest } from '@/lib/site/testSupport';
import PayReturnPage, { dynamic, generateMetadata } from './page';

/**
 * The payment return page, `/{locale}/pay/return?ref=…`: where Qi's payment page sends
 * the guest's browser. What this proves in both languages: the Open the app button carries
 * the app link with the ref, the automatic hop is wired to the same link, the page is
 * never indexed and always dynamic, a bad ref is dropped rather than forwarded, and not
 * one word on the page states a payment result (it does not know one). The hop itself
 * (`location.replace` on a phone) is OpenAppOnLoad.test.tsx; the rendered direction and
 * the live headers are Playwright's (e2e/tests/pay-return.spec.ts).
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

// The client hop renders nothing and navigates on mount; here it only reports its link.
vi.mock('@/components/site/OpenAppOnLoad', () => ({
  OpenAppOnLoad: ({ href }: { href: string }) => <span data-testid="open-app-on-load" data-href={href} />,
}));

const REF = '7c1d2a44-0f3e-4b8a-9d61-2f5e8c9a1b30';
const LOCALES = ['en', 'ar'] as const;

/**
 * Words that state or hint at a payment result. Arabic is matched with its diacritics
 * stripped, so دُفع and دفع are the same word; دفع alone also covers الدفع (the page has no
 * reason to say "payment" at all).
 */
const RESULT_EN = /\b(paid|success\w*|succeed\w*|approved|declined|failed|complete[d]?|confirmed)\b/i;
const RESULT_AR = /دفع|مدفوع|نجح|نجاح|ناجح|مقبول|مرفوض|فشل|اكتمل|مكتمل|تأكد|مؤكد/;
const stripHarakat = (s: string) => s.replace(/[ً-ْٰ]/g, '');

/** Every word a visitor or a screen reader meets: text (no stylesheet) plus labels. */
function readableText(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('style').forEach((node) => node.remove());
  const labels = Array.from(copy.querySelectorAll('[aria-label],[title],[alt]')).flatMap((el) =>
    ['aria-label', 'title', 'alt'].map((name) => el.getAttribute(name) ?? ''),
  );
  return [copy.textContent ?? '', ...labels].join(' ');
}

function expectNoResultWords(text: string) {
  expect(text).not.toMatch(RESULT_EN);
  expect(stripHarakat(text)).not.toMatch(RESULT_AR);
}

beforeEach(() => {
  resetSiteRequest();
});

describe.each(LOCALES)('pay return page (%s)', (locale: Locale) => {
  it('asks the guest back to the app, with the Open the app button on the app link', async () => {
    await renderServerPage(PayReturnPage, locale, { ref: REF });

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      t(locale, 'site.payReturn.title'),
    );
    expect(screen.getByText(t(locale, 'site.payReturn.body'))).toBeTruthy();

    const open = screen.getByRole('link', { name: t(locale, 'site.payReturn.open') });
    expect(open.getAttribute('href')).toBe(`touchpadel://pay/return?ref=${REF}`);
  });

  it('jumps to the same app link by itself', async () => {
    await renderServerPage(PayReturnPage, locale, { ref: REF });
    expect(screen.getByTestId('open-app-on-load').getAttribute('data-href')).toBe(
      `touchpadel://pay/return?ref=${REF}`,
    );
  });

  it('sends a visitor without the app to the app band on the home page, never the staff installer', async () => {
    await renderServerPage(PayReturnPage, locale, { ref: REF });
    const get = screen.getByRole('link', { name: t(locale, 'site.payReturn.noApp') });
    expect(get.getAttribute('href')).toBe(`/${locale}#app`);
    expect(get.getAttribute('href')).not.toContain('/download');
  });

  it('keeps the ref across the language switch, and offers home and support', async () => {
    await renderServerPage(PayReturnPage, locale, { ref: REF });
    const other = locale === 'en' ? 'ar' : 'en';
    const lang = document.querySelector(`a[hreflang="${other}"]`);
    expect(lang?.getAttribute('href')).toBe(`/${other}/pay/return?ref=${REF}`);
    expect(screen.getByRole('link', { name: t(locale, 'site.brandHome') }).getAttribute('href')).toBe(
      `/${locale}`,
    );
    expect(
      screen.getByRole('link', { name: t(locale, 'site.footer.support') }).getAttribute('href'),
    ).toBe(`/${locale}/support`);
  });

  it('never states a payment result, in what it renders or in its catalog', async () => {
    const { container } = await renderServerPage(PayReturnPage, locale, { ref: REF });
    expectNoResultWords(readableText(container));

    const catalog = locale === 'en' ? en : ar;
    expectNoResultWords(Object.values(catalog.site.payReturn).join(' '));

    const meta = await generateMetadata({ params: Promise.resolve({ locale }) });
    expectNoResultWords(String(meta.title));
  });

  it('is never indexed or followed', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ locale }) });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.title).toBe(t(locale, 'site.payReturn.metaTitle'));
    expect(meta.referrer).toBe('no-referrer');
  });

  it('paints in the visitor\'s mode, in the padel theme', async () => {
    const { container } = await renderServerPage(PayReturnPage, locale, { ref: REF });
    const frame = container.querySelector('.tp-payret');
    expect(frame?.getAttribute('data-theme')).toBe('padel');
    expect(frame?.getAttribute('data-mode')).toBe('night');
  });
});

describe('pay return page, the ref', () => {
  it.each([
    ['missing', undefined],
    ['not a UUID', 'abc'],
    ['markup', '"><script>alert(1)</script>'],
    ['a UUID with more after it', `${REF}x`],
    ['empty', ''],
  ])('drops a ref that is %s: the app link goes without one and nothing jumps', async (_, ref) => {
    await renderServerPage(PayReturnPage, 'en', ref === undefined ? {} : { ref });
    const open = screen.getByRole('link', { name: t('en', 'site.payReturn.open') });
    expect(open.getAttribute('href')).toBe('touchpadel://pay/return');
    expect(screen.queryByTestId('open-app-on-load')).toBeNull();
    expect(document.querySelector('a[hreflang="ar"]')?.getAttribute('href')).toBe('/ar/pay/return');
    // The page itself still renders in full.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      t('en', 'site.payReturn.title'),
    );
  });

  it('lowercases an uppercase UUID and reads the first of a repeated ref', async () => {
    await renderServerPage(PayReturnPage, 'en', { ref: [REF.toUpperCase(), 'second'] });
    const open = screen.getByRole('link', { name: t('en', 'site.payReturn.open') });
    expect(open.getAttribute('href')).toBe(`touchpadel://pay/return?ref=${REF}`);
  });
});

describe('pay return page, the route', () => {
  it('is rendered per request', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('404s on a segment that is not a locale', async () => {
    await expect(
      renderServerPage(PayReturnPage, 'de' as unknown as Locale, { ref: REF }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(generateMetadata({ params: Promise.resolve({ locale: 'de' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it('sets no cookie: nothing on the page writes one', () => {
    // Static, because a page render cannot observe a Set-Cookie. The site's LanguageLink and
    // ThemeToggle both write a cookie on click, so the page must not use either.
    const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    const sources = [
      read('./page.tsx'),
      read('../../../../src/components/site/OpenAppOnLoad.tsx'),
      read('../../../../src/lib/site/payReturn.ts'),
    ];
    for (const src of sources) {
      expect(src).not.toMatch(/document\.cookie|cookies\(\)\)?\.set\(|set-cookie/i);
      expect(src).not.toMatch(/import[^;]*\b(LanguageLink|ThemeToggle)\b/);
    }
  });
});

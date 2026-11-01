import { describe, expect, it } from 'vitest';
import { t } from '@touch/i18n';
import rootManifest from '../../manifest';
import { generateMetadata } from '../layout';
import { buildManifest, MANIFEST_ID, manifestPath } from '@/lib/site/manifest';
import { GET, generateStaticParams } from './route';

/**
 * F-63: the web app manifest in the page's language. Arabic pages link
 * `/ar/manifest.webmanifest`, which names the app, describes it and labels the café
 * shortcut in Arabic, right to left; English pages link the English one. Both are the same
 * installed app (one `id`), and the old `/manifest.webmanifest` still answers.
 */
const ctx = (locale: string) => ({ params: Promise.resolve({ locale }) });

describe.each(['en', 'ar'] as const)('manifest (%s)', (locale) => {
  it('is written in the page’s language, with its direction', async () => {
    const res = await GET(new Request(`http://localhost/${locale}/manifest.webmanifest`), ctx(locale));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/manifest\+json/);
    const m = await res.json();
    expect(m).toMatchObject({
      id: MANIFEST_ID,
      name: t(locale, 'seo.siteTitle'),
      short_name: t(locale, 'seo.siteTitle'),
      description: t(locale, 'site.seo.description'),
      lang: locale,
      dir: locale === 'ar' ? 'rtl' : 'ltr',
      start_url: `/${locale}`,
      scope: '/',
    });
    expect(m.shortcuts).toEqual([
      expect.objectContaining({
        name: t(locale, 'seo.menuTitle'),
        short_name: t(locale, 'site.footer.menu'),
        url: `/${locale}/menu`,
      }),
    ]);
  });

  it('is the manifest the locale layout links', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ locale }) });
    expect(meta.manifest).toBe(manifestPath(locale));
    expect(manifestPath(locale)).toBe(`/${locale}/manifest.webmanifest`);
  });
});

describe('manifest, both languages', () => {
  it('names the app in Arabic at /ar, not in English', () => {
    const ar = buildManifest('ar');
    expect(ar.name).toBe('تتش بادل');
    expect(ar.name).not.toBe(buildManifest('en').name);
    expect(ar.shortcuts?.[0]?.name).not.toBe(buildManifest('en').shortcuts?.[0]?.name);
  });

  it('is one installed app whichever language it was installed from', () => {
    expect(buildManifest('ar').id).toBe(buildManifest('en').id);
  });

  it('is built for both locales and refuses a foreign one', async () => {
    expect(generateStaticParams()).toEqual([{ locale: 'en' }, { locale: 'ar' }]);
    const res = await GET(new Request('http://localhost/xx/manifest.webmanifest'), ctx('xx'));
    expect(res.status).toBe(404);
  });

  it('keeps the old /manifest.webmanifest, with links proxy.ts sends to the guest’s language', () => {
    const m = rootManifest();
    expect(m.lang).toBe('ar');
    expect(m.start_url).toBe('/');
    expect(m.shortcuts?.[0]?.url).toBe('/menu');
    expect(m.id).toBe(MANIFEST_ID);
  });
});

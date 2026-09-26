import { describe, expect, it, vi } from 'vitest';
import type { MenuCategory, VenueOpeningHours } from '@/lib/menu';
import { parseSiteMode, siteModeCookie, siteModeFromCookieString, SITE_MODE_COOKIE } from './mode';
import { getStoreLinks, validStoreUrl } from './stores';
import { openState, venueClock } from './openNow';
import {
  crossesMidnight,
  everyDayHours,
  everyDayWindow,
  formatWindow,
  formatWindows,
} from './hours';
import { hoursPhrase, pluralForm } from './plural';
import { PRODUCTION_ORIGIN, siteOrigin } from './origin';
import { buildLandingJsonLd, jsonLdString } from './jsonLd';
import { cafeCategoryList } from './landing';
import { PHOTO_GRADE_RAMP } from './photoGrade';
import { t } from '@touch/i18n';
import {
  branchAddress,
  branchMapUrl,
  branchName,
  displayPhone,
  internationalDigits,
  MAPS_URL,
  telUrl,
  whatsappUrl,
} from './contact';

/**
 * The site's pure helpers: the mode cookie, the store-link validation, "open now" on the
 * venue's clock, the every-day hours line, the JSON-LD, the café category sentence, the
 * contact plumbing (WhatsApp and tel:), the plural hours, the origin and the photo grade.
 */

/** Touch's real week: 09:00 → 02:00 every day, stored as the overnight pair. */
const OVERNIGHT = [
  ['00:00', '02:00'],
  ['09:00', '24:00'],
] as [string, string][];
const TOUCH_WEEK: VenueOpeningHours = {
  venue_name: 'Touch Padel',
  opening_hours: Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, OVERNIGHT]),
  ),
  closed_dates: [],
  phone: '00995419010203',
  cancellation_window_hours: 4,
};

/** An instant whose Baghdad wall clock reads `hhmm` on 2026-09-23 (a Wednesday). UTC+3. */
function baghdad(hhmm: string, day = 23): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 8, day, h! - 3, m!));
}

/** Text without the bidi isolates. */
const plain = (text: string | null) => text?.replace(/[\u2066-\u2069]/g, '') ?? null;
const LRI = '\u2066';
const PDI = '\u2069';

describe('site mode', () => {
  it('is night unless the cookie says exactly light, on the server or in document.cookie', () => {
    for (const value of [undefined, '', 'dark', 'LIGHT'])
      expect(parseSiteMode(value)).toBe('night');
    expect(parseSiteMode('light')).toBe('light');
    expect(siteModeFromCookieString('a=1; tp-site-mode=light; b=2')).toBe('light');
    // Another cookie whose name merely ends in ours is not ours.
    expect(siteModeFromCookieString('x-tp-site-mode=light')).toBe('night');
  });

  it('writes a one-year, site-wide, lax cookie, secure only on https', () => {
    expect(siteModeCookie('light', true)).toBe(
      `${SITE_MODE_COOKIE}=light; Max-Age=31536000; Path=/; SameSite=Lax; Secure`,
    );
    expect(siteModeCookie('night', false)).not.toContain('Secure');
  });
});

describe('store links', () => {
  it('are unset until a listing exists, and accept only https on the store’s own host', () => {
    expect(getStoreLinks({})).toEqual({ appStore: null, googlePlay: null });
    expect(validStoreUrl(' https://apps.apple.com/iq/app/id6809045183 ', 'apps.apple.com')).toBe(
      'https://apps.apple.com/iq/app/id6809045183',
    );
    for (const bad of [
      'http://apps.apple.com/x',
      'https://apps.apple.com.evil.example/x',
      'https://evil.example/apps.apple.com',
      'javascript:alert(1)',
    ]) {
      expect(validStoreUrl(bad, 'apps.apple.com'), bad).toBeNull();
    }
  });
});

describe('open now, on the venue’s clock', () => {
  it('reads the Baghdad wall clock whatever the machine’s zone', () => {
    expect(venueClock(baghdad('01:30'))).toEqual({
      isoDate: '2026-09-23',
      dayKey: 'wed',
      hhmm: '01:30',
    });
  });

  it.each([
    ['09:00', { open: true, opensAt: null }],
    ['23:59', { open: true, opensAt: null }],
    ['01:59', { open: true, opensAt: null }],
    ['02:00', { open: false, opensAt: '09:00' }],
    ['08:59', { open: false, opensAt: '09:00' }],
  ])('at %s on an overnight day', (hhmm, state) => {
    expect(openState(TOUCH_WEEK.opening_hours, [], baghdad(hhmm))).toEqual(state);
  });

  it('is closed on a closed date and names tomorrow’s real opening, not its carried-over tail', () => {
    expect(openState(TOUCH_WEEK.opening_hours, ['2026-09-23'], baghdad('20:00'))).toEqual({
      open: false,
      opensAt: '09:00',
    });
  });

  it('survives a malformed blob', () => {
    expect(openState({ wed: 'nope' }, null, baghdad('20:00'))).toEqual({
      open: false,
      opensAt: null,
    });
  });
});

describe('every-day hours', () => {
  it('folds the overnight pair into one window that closes after midnight', () => {
    expect(everyDayWindow(TOUCH_WEEK)).toEqual(['09:00', '02:00']);
    expect(plain(everyDayHours(TOUCH_WEEK))).toBe('09:00–02:00');
    expect(crossesMidnight(['09:00', '02:00'])).toBe(true);
    expect(crossesMidnight(['09:00', '24:00'])).toBe(false);
  });

  it('isolates each time and leaves the dash in the sentence’s direction (AR-RTL-2)', () => {
    // So an Arabic line puts 09:00 on the RIGHT, where a right-to-left reader starts, and
    // the café menu, the legal pages and the site all print a window the same way.
    expect(formatWindow(['09:00', '02:00'])).toBe(`${LRI}09:00${PDI}–${LRI}02:00${PDI}`);
    expect(
      formatWindows(
        [
          ['09:00', '13:00'],
          ['16:00', '23:00'],
        ],
        'ar',
      ),
    ).toBe(`${formatWindow(['09:00', '13:00'])}، ${formatWindow(['16:00', '23:00'])}`);
  });

  it('refuses to say "every day" when a day differs or is closed', () => {
    const fri = { ...TOUCH_WEEK.opening_hours, fri: [['14:00', '24:00']] as [string, string][] };
    expect(everyDayHours({ ...TOUCH_WEEK, opening_hours: fri })).toBeNull();
    const sun = { ...TOUCH_WEEK.opening_hours, sun: [] };
    expect(everyDayHours({ ...TOUCH_WEEK, opening_hours: sun })).toBeNull();
  });
});

describe('landing JSON-LD', () => {
  it('carries the confirmed address and one week of hours, and never a telephone', () => {
    const ld = buildLandingJsonLd({ locale: 'ar', origin: 'https://x', venue: TOUCH_WEEK });
    // The venue fixture holds the unverified +995 number: it must not leak in any form.
    const json = JSON.stringify(ld);
    expect(json).not.toMatch(/telephone|00995|995419/i);
    // Nothing beyond the owner's address: no street number, postcode or coordinates.
    expect(ld.address).toEqual({
      '@type': 'PostalAddress',
      streetAddress: 'Durrat Karbala',
      addressLocality: 'Karbala',
      addressCountry: 'IQ',
    });
    expect(json).not.toMatch(/postalCode|geo|latitude/i);
    const spec = ld.openingHoursSpecification as { opens: string; closes: string }[];
    expect(spec).toHaveLength(1);
    expect(spec[0]).toMatchObject({ opens: '09:00', closes: '02:00' });
    expect(
      buildLandingJsonLd({ locale: 'en', origin: 'https://x', venue: null }),
    ).not.toHaveProperty('openingHoursSpecification');
  });

  it('cannot close its own script element', () => {
    expect(jsonLdString({ x: '</script><script>alert(1)</script>' })).not.toContain('</script>');
  });
});

describe('café categories for the hand-off line', () => {
  const cat = (id: string, en: string, ar: string, order: number, items = 1): MenuCategory => ({
    id,
    name_en: en,
    name_ar: ar,
    sort_order: order,
    serve_temp: 'none',
    photo_path: null,
    photo_url: null,
    photo_blur: null,
    items: Array.from({ length: items }, () => ({}) as MenuCategory['items'][number]),
  });
  const menu = [
    cat('c', 'Smoothies', 'سموذي', 3),
    cat('a', 'Coffee', 'قهوة', 1),
    cat('e', 'Empty', 'فارغ', 2, 0),
    cat('b', 'Tea', 'شاي', 2),
  ];

  it('names real, non-empty categories in menu order, joined for the language', () => {
    // English drops the menu's capitals inside a sentence.
    expect(cafeCategoryList(menu, 'en')).toEqual({
      list: 'coffee, tea, and smoothies',
      more: false,
    });
    expect(cafeCategoryList(menu, 'ar', 2)?.list).toBe('قهوة وشاي');
  });

  it('says when it stopped at the limit, and says nothing when there is nothing to say', () => {
    // A cut list must not read as the whole menu: no closing "and", and `more` set so the
    // page says "… and more" (site.cafe.bodyMore).
    expect(cafeCategoryList(menu, 'en', 2)).toEqual({ list: 'coffee, tea', more: true });
    expect(cafeCategoryList([], 'en')).toBeNull();
  });
});

describe('contact: the venue phone', () => {
  it('accepts the international, local and Arabic-Indic spellings of a dialable number', () => {
    for (const spelling of [
      '+964 770 123 4567',
      '00964 770 123 4567',
      '0770 123 4567', // Iraqi local mobile: 07 + nine digits
      '+964 0770 123 4567', // the trunk zero written after the country code (SEC-02)
      '٠٧٧٠١٢٣٤٥٦٧',
    ]) {
      expect(internationalDigits(spelling), spelling).toBe('9647701234567');
    }
  });

  it('refuses anything that is not a plausible, dialable number', () => {
    for (const bad of [
      null,
      '030 123 4567', // a local number whose country is unknown
      '+964 01 234 5678', // anything but a mobile after 9640
      'call the desk',
      '+1234567', // under E.164's eight digits
      '+1234567890123456', // over E.164's fifteen
      '+0964 770 123 4567', // no country code starts with 0
    ]) {
      expect(internationalDigits(bad), String(bad)).toBeNull();
    }
  });

  it('prints it the way it is dialled, grouped for reading, or not at all', () => {
    expect(displayPhone('07701234567')).toBe('+964 770 123 4567');
    expect(displayPhone('+44 20 7946 0958')).toBe('+44 207 946 0958'); // a two-digit code
    expect(displayPhone('030 123 4567')).toBeNull();
  });

  it('opens a wa.me chat with the message pre-filled, or dials +digits, or neither', () => {
    const ar = whatsappUrl('0770 123 4567', 'مرحبا تتش بادل')!;
    expect(ar.startsWith('https://wa.me/9647701234567?text=')).toBe(true);
    expect(new URL(ar).searchParams.get('text')).toBe('مرحبا تتش بادل');
    // `&`, `#` and `?` in a message cannot break the URL.
    expect(new URL(whatsappUrl('+9647701234567', 'a&b#c?d')!).searchParams.get('text')).toBe(
      'a&b#c?d',
    );
    expect(whatsappUrl(null, 'Hi')).toBeNull();
    expect(telUrl('00964 770 123 4567')).toBe('tel:+9647701234567');
    expect(telUrl('reception')).toBeNull();
  });
});

describe('contact: a branch’s name, address and map (multi-venue slice 4)', () => {
  it('prints the stored address in the page’s language, then the other, then the confirmed one', () => {
    expect(branchAddress('ar', { address_ar: 'عنوان', address_en: 'Addr' })).toBe('عنوان');
    expect(branchAddress('ar', { address_ar: '  ', address_en: 'Addr' })).toBe('Addr');
    expect(branchAddress('en', {})).toBe(t('en', 'site.visit.address'));
    expect(branchAddress('en', null)).toBe(t('en', 'site.visit.address'));
    expect(branchAddress('en', {}, { fallback: false })).toBeNull();
  });

  it('links a stored https map, and the Maps search otherwise', () => {
    expect(branchMapUrl({ map_url: 'https://maps.app.goo.gl/x' })).toBe(
      'https://maps.app.goo.gl/x',
    );
    expect(branchMapUrl({ map_url: 'javascript:alert(1)' })).toBe(MAPS_URL);
    expect(branchMapUrl({ map_url: null })).toBe(MAPS_URL);
    expect(branchMapUrl(undefined)).toBe(MAPS_URL);
  });

  it('names a branch in the page’s language, falling back through the other and the venue', () => {
    expect(branchName('ar', { name_ar: 'الفرع', name_en: 'Branch' })).toBe('الفرع');
    expect(branchName('en', { name_en: '', name_ar: 'الفرع' })).toBe('الفرع');
    expect(branchName('en', { venue_name: 'Touch Padel' })).toBe('Touch Padel');
  });

  it('keeps the one-branch JSON-LD identical while no address is stored', () => {
    const ld = buildLandingJsonLd({
      locale: 'en',
      origin: 'https://x',
      venue: TOUCH_WEEK,
      branches: [],
    });
    expect(ld).not.toHaveProperty('department');
    expect(ld).not.toHaveProperty('hasMap');
    expect(ld.address).toMatchObject({ streetAddress: 'Durrat Karbala' });
  });
});

describe('a count of hours, in the page’s plural forms (AR-LANG-1)', () => {
  it('picks the form the number needs', () => {
    expect([1, 2, 4, 12].map((n) => pluralForm(n, 'ar'))).toEqual(['one', 'two', 'few', 'many']);
    expect(plain(hoursPhrase(2, 'ar'))).toBe('ساعتين');
    // 12 is the column's default: «ساعة», never «ساعات».
    expect(plain(hoursPhrase(12, 'ar'))).toBe('12 ساعة');
    expect(plain(hoursPhrase(1, 'en'))).toBe('one hour');
  });
});

describe('the site origin (SEC-04)', () => {
  it('is the env value without a trailing slash, else the production host, never relative', () => {
    expect(siteOrigin('https://preview.vercel.app/')).toBe('https://preview.vercel.app');
    expect(siteOrigin('   ')).toBe(PRODUCTION_ORIGIN);
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect(siteOrigin()).toBe(PRODUCTION_ORIGIN);
    vi.unstubAllEnvs();
  });
});

describe('photo grade', () => {
  const rgb = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const luminance = ([r, g, b]: number[]) => {
    const lin = (c: number) =>
      c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4;
    return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
  };
  const contrast = (a: number[], b: number[]) => {
    const [x, y] = [luminance(a), luminance(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  it('never lets the night exposure undercut the hero type, whatever the photo (WCAG 1.4.3)', () => {
    // The filter maps luma onto the ramp by per-channel interpolation. With every channel
    // rising stop to stop, no graded pixel is brighter than the last stop, so the ceiling
    // is the worst case for white type and for the green headline line alike.
    const stops = PHOTO_GRADE_RAMP.night.map(rgb);
    for (let i = 1; i < stops.length; i++) {
      for (const c of [0, 1, 2]) expect(stops[i]![c]!).toBeGreaterThanOrEqual(stops[i - 1]![c]!);
    }
    const ceiling = stops.at(-1)!;
    expect(contrast(ceiling, [255, 255, 255])).toBeGreaterThanOrEqual(6.17);
    expect(contrast(ceiling, [165, 208, 111])).toBeGreaterThanOrEqual(3.4); // Padel Green
  });
});

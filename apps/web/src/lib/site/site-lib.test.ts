import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MenuCategory, VenueOpeningHours } from '@/lib/menu';
import {
  DEFAULT_SITE_MODE,
  parseSiteMode,
  siteModeCookie,
  siteModeFromCookieString,
  SITE_MODE_COOKIE,
} from './mode';
import { SITE_THEME_COLOR } from './themeColor';
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
import { buildLandingJsonLd, jsonLdString, openingHoursSpecification } from './jsonLd';
import { cafeCategoryList } from './landing';
import { gradePixel, PHOTO_GRADE_RAMP, rampTables } from './photoGrade';
import {
  DEFAULT_MAPS_URL,
  displayPhone,
  instagramUrl,
  internationalDigits,
  MAPS_QUERY,
  mapsUrl,
  telUrl,
  whatsappUrl,
} from './contact';

/**
 * The site's pure helpers: the mode cookie, the store-link validation, "open now" on the
 * venue's clock, the every-day hours line, the JSON-LD, the café category sentence, the
 * contact plumbing (WhatsApp, tel:, the map and Instagram links), and the photo grade.
 */

/** Touch's real week: 09:00 → 02:00 every day, stored as the overnight pair. */
const OVERNIGHT = [
  ['00:00', '02:00'],
  ['09:00', '24:00'],
] as [string, string][];
const TOUCH_WEEK: VenueOpeningHours = {
  venue_name: 'Touch Padel',
  opening_hours: {
    mon: OVERNIGHT,
    tue: OVERNIGHT,
    wed: OVERNIGHT,
    thu: OVERNIGHT,
    fri: OVERNIGHT,
    sat: OVERNIGHT,
    sun: OVERNIGHT,
  },
  closed_dates: [],
  phone: '00995419010203',
  cancellation_window_hours: 4,
};

/** An instant whose Baghdad wall clock reads `hhmm` on 2026-09-23 (a Wednesday). UTC+3. */
function baghdad(hhmm: string, day = 23): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 8, day, h! - 3, m!));
}

describe('site mode', () => {
  it('is night unless the cookie says light', () => {
    expect(DEFAULT_SITE_MODE).toBe('night');
    expect(parseSiteMode(undefined)).toBe('night');
    expect(parseSiteMode('')).toBe('night');
    expect(parseSiteMode('dark')).toBe('night');
    expect(parseSiteMode('LIGHT')).toBe('night');
    expect(parseSiteMode('light')).toBe('light');
  });

  it('writes a one-year, site-wide, lax cookie, secure only on https', () => {
    expect(siteModeCookie('light', true)).toBe(
      `${SITE_MODE_COOKIE}=light; Max-Age=31536000; Path=/; SameSite=Lax; Secure`,
    );
    expect(siteModeCookie('night', false)).not.toContain('Secure');
  });

  it('reads the mode back out of document.cookie', () => {
    expect(siteModeFromCookieString('a=1; tp-site-mode=light; b=2')).toBe('light');
    expect(siteModeFromCookieString('tp-site-mode=night')).toBe('night');
    expect(siteModeFromCookieString('x-tp-site-mode=light')).toBe('night');
    expect(siteModeFromCookieString('')).toBe('night');
  });

  it('paints the browser chrome in the page ground of each mode', () => {
    expect(SITE_THEME_COLOR).toEqual({ night: '#172C4F', light: '#F3F5F9' });
  });
});

describe('store links', () => {
  it('are unset until a listing exists (the app is on neither store yet)', () => {
    expect(getStoreLinks({})).toEqual({ appStore: null, googlePlay: null });
  });

  it('accept only https URLs on the store’s own host', () => {
    expect(
      validStoreUrl('https://apps.apple.com/iq/app/touch-padel/id6809045183', 'apps.apple.com'),
    ).toBe('https://apps.apple.com/iq/app/touch-padel/id6809045183');
    expect(
      validStoreUrl(
        '  https://play.google.com/store/apps/details?id=com.kagu.touchpadel ',
        'play.google.com',
      ),
    ).toBe('https://play.google.com/store/apps/details?id=com.kagu.touchpadel');
    for (const bad of [
      'http://apps.apple.com/x',
      'https://apps.apple.com.evil.example/x',
      'https://evil.example/apps.apple.com',
      'https://user:pw@apps.apple.com/x',
      'javascript:alert(1)',
      'not a url',
      '',
    ]) {
      expect(validStoreUrl(bad, 'apps.apple.com'), bad).toBeNull();
    }
    expect(
      getStoreLinks({
        appStore: 'https://play.google.com/x',
        googlePlay: 'https://apps.apple.com/x',
      }),
    ).toEqual({
      appStore: null,
      googlePlay: null,
    });
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

  it('is open through the evening and the small hours of an overnight day', () => {
    const { opening_hours, closed_dates } = TOUCH_WEEK;
    expect(openState(opening_hours, closed_dates, baghdad('09:00'))).toEqual({
      open: true,
      opensAt: null,
    });
    expect(openState(opening_hours, closed_dates, baghdad('23:59'))).toEqual({
      open: true,
      opensAt: null,
    });
    expect(openState(opening_hours, closed_dates, baghdad('01:59'))).toEqual({
      open: true,
      opensAt: null,
    });
  });

  it('is closed between 02:00 and 09:00 and says when it opens', () => {
    const { opening_hours, closed_dates } = TOUCH_WEEK;
    expect(openState(opening_hours, closed_dates, baghdad('02:00'))).toEqual({
      open: false,
      opensAt: '09:00',
    });
    expect(openState(opening_hours, closed_dates, baghdad('08:59'))).toEqual({
      open: false,
      opensAt: '09:00',
    });
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
    expect(openState(null, undefined, baghdad('20:00'))).toEqual({ open: false, opensAt: null });
  });
});

/** Text without the bidi isolates. */
const plain = (text: string | null) => text?.replace(/[\u2066-\u2069]/g, '') ?? null;
const LRI = '\u2066';
const PDI = '\u2069';

describe('every-day hours', () => {
  it('folds the overnight pair into one window when every day agrees', () => {
    expect(everyDayWindow(TOUCH_WEEK)).toEqual(['09:00', '02:00']);
    expect(plain(everyDayHours(TOUCH_WEEK))).toBe('09:00–02:00');
    expect(plain(formatWindow(['09:00', '23:00']))).toBe('09:00–23:00');
  });

  it('isolates each time and leaves the dash in the sentence’s direction (AR-RTL-2)', () => {
    // So an Arabic line puts 09:00 on the RIGHT, where a right-to-left reader starts, and
    // the café menu, the legal pages and the site all print a window the same way.
    expect(formatWindow(['09:00', '02:00'])).toBe(`${LRI}09:00${PDI}–${LRI}02:00${PDI}`);
    expect(everyDayHours(TOUCH_WEEK)).toBe(`${LRI}09:00${PDI}–${LRI}02:00${PDI}`);
    expect(
      formatWindows(
        [
          ['09:00', '13:00'],
          ['16:00', '23:00'],
        ],
        'ar',
      ),
    ).toBe(`${formatWindow(['09:00', '13:00'])}، ${formatWindow(['16:00', '23:00'])}`);
    expect(formatWindows([['09:00', '13:00']], 'en')).toBe(formatWindow(['09:00', '13:00']));
  });

  it('knows when a window closes after midnight (and when it does not)', () => {
    expect(crossesMidnight(['09:00', '02:00'])).toBe(true);
    expect(crossesMidnight(['09:00', '23:00'])).toBe(false);
    expect(crossesMidnight(['09:00', '24:00'])).toBe(false);
  });

  it('refuses to say "every day" when a day differs, is split or is closed', () => {
    expect(everyDayHours(null)).toBeNull();
    expect(
      everyDayHours({
        ...TOUCH_WEEK,
        opening_hours: {
          ...TOUCH_WEEK.opening_hours,
          fri: [
            ['14:00', '24:00'],
            ['00:00', '02:00'],
          ],
        },
      }),
    ).toBeNull();
    expect(
      everyDayHours({ ...TOUCH_WEEK, opening_hours: { ...TOUCH_WEEK.opening_hours, sun: [] } }),
    ).toBeNull();
    expect(everyDayHours({ ...TOUCH_WEEK, opening_hours: {} })).toBeNull();
  });
});

describe('landing JSON-LD', () => {
  it('collapses a uniform week into one specification, overnight close kept', () => {
    const spec = openingHoursSpecification(TOUCH_WEEK);
    expect(spec).toHaveLength(1);
    expect(spec[0]).toMatchObject({ opens: '09:00', closes: '02:00' });
    expect(spec[0]!.dayOfWeek).toHaveLength(7);
  });

  it('carries the club’s confirmed address and never a telephone', () => {
    const ld = buildLandingJsonLd({
      locale: 'ar',
      origin: 'https://www.touch-padel.com',
      venue: TOUCH_WEEK,
    });
    expect(ld).toMatchObject({
      '@type': 'SportsActivityLocation',
      name: 'تتش بادل',
      alternateName: 'Touch Padel',
      url: 'https://www.touch-padel.com/ar',
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'Durrat Karbala',
        addressLocality: 'Karbala',
        addressCountry: 'IQ',
      },
    });
    // The venue fixture holds the unverified +995 number: it must not leak in any form.
    const json = JSON.stringify(ld);
    expect(json).not.toMatch(/telephone|00995|995419/i);
    // Nothing beyond the owner's address: no street number, postcode or coordinates.
    expect(Object.keys(ld.address as object).sort()).toEqual([
      '@type',
      'addressCountry',
      'addressLocality',
      'streetAddress',
    ]);
    expect(json).not.toMatch(/postalCode|geo|latitude/i);
  });

  it('describes the club in the page’s language', () => {
    expect(
      buildLandingJsonLd({ locale: 'en', origin: 'https://x', venue: TOUCH_WEEK }),
    ).toMatchObject({ name: 'Touch Padel', inLanguage: 'en' });
    expect(
      buildLandingJsonLd({ locale: 'en', origin: 'https://x', venue: TOUCH_WEEK }),
    ).not.toHaveProperty('alternateName');
  });

  it('leaves the hours out when the venue read failed', () => {
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
    expect(cafeCategoryList(menu, 'en')).toEqual({ list: 'coffee, tea, and smoothies', more: false });
    const ar = cafeCategoryList(menu, 'ar')!;
    expect(ar.list).toContain('قهوة');
    expect(ar.list).toContain('و');
    expect(ar.list).not.toContain('فارغ');
    expect(ar.more).toBe(false);
  });

  it('says when it stopped at the limit, and says nothing when there is nothing to say', () => {
    // A cut list must not read as the whole menu: no closing "and", and `more` set so the
    // page says "… and more" (site.cafe.bodyMore).
    expect(cafeCategoryList(menu, 'en', 2)).toEqual({ list: 'coffee, tea', more: true });
    expect(cafeCategoryList(menu, 'ar', 2)).toEqual({ list: 'قهوة وشاي', more: true });
    expect(cafeCategoryList([], 'en')).toBeNull();
  });
});

describe('contact: the venue phone as international digits', () => {
  it('accepts the international spellings: +, 00, spaces, dashes, dots, brackets', () => {
    expect(internationalDigits('+964 770 123 4567')).toBe('9647701234567');
    expect(internationalDigits('00964 770 123 4567')).toBe('9647701234567');
    expect(internationalDigits(' +964-770.123-4567 ')).toBe('9647701234567');
    expect(internationalDigits('+964 (770) 123 4567')).toBe('9647701234567');
    expect(internationalDigits('00995419010203')).toBe('995419010203');
  });

  it('drops a written trunk zero after the country code', () => {
    expect(internationalDigits('+964 (0)770 123 4567')).toBe('9647701234567');
  });

  it('drops the bare trunk zero Iraqi numbers are often written with (SEC-02)', () => {
    expect(internationalDigits('+964 0770 123 4567')).toBe('9647701234567');
    expect(internationalDigits('+9640770 123 4567')).toBe('9647701234567');
    expect(internationalDigits('00964 0770 123 4567')).toBe('9647701234567');
    expect(internationalDigits('0096407701234567')).toBe('9647701234567');
    // Anything else after 9640 cannot be dialled from abroad: no button, not a dead one.
    expect(internationalDigits('+964 01 234 5678')).toBeNull();
    expect(internationalDigits('+964 0770 123 456')).toBeNull();
  });

  it('reads an Iraqi local mobile (07 + nine digits) as +964', () => {
    expect(internationalDigits('0770 123 4567')).toBe('9647701234567');
    expect(internationalDigits('07701234567')).toBe('9647701234567');
  });

  it('reads Arabic-Indic and Extended Arabic-Indic digits', () => {
    expect(internationalDigits('٠٧٧٠١٢٣٤٥٦٧')).toBe('9647701234567');
    expect(internationalDigits('+۹۶۴ ۷۷۰ ۱۲۳ ۴۵۶۷')).toBe('9647701234567');
  });

  it('refuses anything that is not a plausible, dialable number', () => {
    for (const bad of [
      null,
      undefined,
      '',
      '   ',
      '030 123 4567', // a local number whose country is unknown
      '0770 123 456', // 07 but not nine digits after it: still local and unknown
      'call the desk',
      '+964 770 ABC 4567',
      '964+7701234567', // a + anywhere but the front
      '++9647701234567',
      '+0964 770 123 4567', // no country code starts with 0
      '+1234567', // under E.164's eight digits
      '+1234567890123456', // over its fifteen
      '+964/770/123/4567',
    ]) {
      expect(internationalDigits(bad), String(bad)).toBeNull();
    }
  });
});

describe('contact: the phone as a person reads it', () => {
  it('prints the country code, then threes, ending in a group of up to four', () => {
    expect(displayPhone('00995419010203')).toBe('+995 419 010 203');
    expect(displayPhone('+964 770 123 4567')).toBe('+964 770 123 4567');
    expect(displayPhone('07701234567')).toBe('+964 770 123 4567');
    expect(displayPhone('+964 0770 123 4567')).toBe('+964 770 123 4567');
    expect(displayPhone('+44 20 7946 0958')).toBe('+44 207 946 0958');
    expect(displayPhone('+1 212 555 0123')).toBe('+1 212 555 0123');
  });

  it('prints nothing it could not dial', () => {
    expect(displayPhone(null)).toBeNull();
    expect(displayPhone('reception')).toBeNull();
    expect(displayPhone('030 123 4567')).toBeNull();
  });
});

describe('contact: WhatsApp and call links', () => {
  it('opens a wa.me chat with the message pre-filled and encoded', () => {
    expect(whatsappUrl('+964 770 123 4567', 'Hi Touch Padel, I would like to book a court.')).toBe(
      'https://wa.me/9647701234567?text=Hi%20Touch%20Padel%2C%20I%20would%20like%20to%20book%20a%20court.',
    );
    const ar = whatsappUrl('0770 123 4567', 'مرحبا تتش بادل')!;
    expect(ar.startsWith('https://wa.me/9647701234567?text=')).toBe(true);
    expect(decodeURIComponent(new URL(ar).searchParams.get('text')!)).toBe('مرحبا تتش بادل');
    // `&`, `#` and `?` in a message cannot break the URL.
    expect(new URL(whatsappUrl('+9647701234567', 'a&b#c?d')!).searchParams.get('text')).toBe(
      'a&b#c?d',
    );
  });

  it('leaves the text off when there is none', () => {
    expect(whatsappUrl('+9647701234567')).toBe('https://wa.me/9647701234567');
    expect(whatsappUrl('+9647701234567', '   ')).toBe('https://wa.me/9647701234567');
  });

  it('is null without a usable phone, so the page falls back to Plan your visit', () => {
    expect(whatsappUrl(null, 'Hi')).toBeNull();
    expect(whatsappUrl('030 123 4567', 'Hi')).toBeNull();
  });

  it('dials +<digits> from anywhere, or nothing', () => {
    expect(telUrl('00964 770 123 4567')).toBe('tel:+9647701234567');
    expect(telUrl('0770 123 4567')).toBe('tel:+9647701234567');
    expect(telUrl(undefined)).toBeNull();
    expect(telUrl('reception')).toBeNull();
  });
});

describe('contact: the map link', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('searches Google Maps for Durrat Karbala when no pinned link is set', () => {
    expect(MAPS_QUERY).toBe('درّة كربلاء، كربلاء');
    const url = new URL(DEFAULT_MAPS_URL);
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/search/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('query')).toBe(MAPS_QUERY);
    expect(mapsUrl(undefined)).toBe(DEFAULT_MAPS_URL);
    expect(mapsUrl('')).toBe(DEFAULT_MAPS_URL);
  });

  it('uses NEXT_PUBLIC_MAPS_URL when it is an https Google Maps link', () => {
    expect(mapsUrl('https://maps.app.goo.gl/AbCdEf123')).toBe('https://maps.app.goo.gl/AbCdEf123');
    expect(mapsUrl('https://www.google.com/maps/place/Karbala')).toBe(
      'https://www.google.com/maps/place/Karbala',
    );
    expect(mapsUrl('https://maps.google.com/?q=karbala')).toBe('https://maps.google.com/?q=karbala');
    expect(mapsUrl('https://goo.gl/maps/AbC')).toBe('https://goo.gl/maps/AbC');
    vi.stubEnv('NEXT_PUBLIC_MAPS_URL', ' https://maps.app.goo.gl/AbCdEf123 ');
    expect(mapsUrl()).toBe('https://maps.app.goo.gl/AbCdEf123');
  });

  it('ignores anything else and keeps the search', () => {
    for (const bad of [
      'http://maps.google.com/?q=karbala',
      'javascript:alert(1)',
      'https://user:pw@maps.app.goo.gl/x',
      'maps.app.goo.gl/x',
      'not a url',
      // The button says Google Maps: another host must never sit behind it (SEC-03).
      'https://evil.example/x',
      'https://maps.google.com.evil.example/x',
      'https://www.google.com/search?q=karbala',
      'https://goo.gl/AbC',
      'https://maps.app.goo.gl:8443/x',
    ]) {
      expect(mapsUrl(bad), bad).toBe(DEFAULT_MAPS_URL);
    }
  });
});

describe('contact: Instagram', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is absent until a profile link is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_INSTAGRAM_URL', '');
    expect(instagramUrl()).toBeNull();
    expect(instagramUrl(undefined)).toBeNull();
  });

  it('accepts an https instagram.com profile, on the canonical host', () => {
    expect(instagramUrl('https://www.instagram.com/touchpadel/')).toBe(
      'https://www.instagram.com/touchpadel/',
    );
    expect(instagramUrl('https://instagram.com/touchpadel')).toBe(
      'https://www.instagram.com/touchpadel',
    );
    vi.stubEnv('NEXT_PUBLIC_INSTAGRAM_URL', 'https://instagram.com/touchpadel');
    expect(instagramUrl()).toBe('https://www.instagram.com/touchpadel');
  });

  it('refuses other hosts, http, credentials and a link with no profile', () => {
    for (const bad of [
      'http://www.instagram.com/touchpadel',
      'https://www.instagram.com/',
      'https://instagram.com',
      'https://instagram.com.evil.example/touchpadel',
      'https://evil.example/instagram.com/touchpadel',
      'https://m.instagram.com/touchpadel',
      'https://user:pw@instagram.com/touchpadel',
      'https://instagram.com:8443/touchpadel',
      'javascript:alert(1)',
      '@touchpadel',
    ]) {
      expect(instagramUrl(bad), bad).toBeNull();
    }
  });
});

describe('a count of hours, in the page’s plural forms (AR-LANG-1)', () => {
  it('picks the Arabic form the number needs', () => {
    expect(pluralForm(1, 'ar')).toBe('one');
    expect(pluralForm(2, 'ar')).toBe('two');
    expect(pluralForm(4, 'ar')).toBe('few');
    expect(pluralForm(12, 'ar')).toBe('many');
    expect(plain(hoursPhrase(1, 'ar'))).toBe('ساعة واحدة');
    expect(plain(hoursPhrase(2, 'ar'))).toBe('ساعتين');
    expect(plain(hoursPhrase(4, 'ar'))).toBe('4 ساعات');
    // 12 is the column's default and 24 a common window: «ساعة», never «ساعات».
    expect(plain(hoursPhrase(12, 'ar'))).toBe('12 ساعة');
    expect(plain(hoursPhrase(24, 'ar'))).toBe('24 ساعة');
  });

  it('and the English one', () => {
    expect(plain(hoursPhrase(1, 'en'))).toBe('one hour');
    expect(plain(hoursPhrase(4, 'en'))).toBe('4 hours');
    expect(plain(hoursPhrase(12, 'en'))).toBe('12 hours');
  });
});

describe('the site origin (SEC-04)', () => {
  it('is the env value without a trailing slash', () => {
    expect(siteOrigin('https://preview.vercel.app/')).toBe('https://preview.vercel.app');
  });

  it('falls back to the production host when the env is empty or unset, never relative', () => {
    expect(siteOrigin('')).toBe(PRODUCTION_ORIGIN);
    expect(siteOrigin('   ')).toBe(PRODUCTION_ORIGIN);
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect(siteOrigin()).toBe(PRODUCTION_ORIGIN);
    vi.unstubAllEnvs();
    expect(PRODUCTION_ORIGIN).toBe('https://www.touch-padel.com');
  });

  it('gives the JSON-LD absolute URLs even from an empty env', () => {
    const ld = buildLandingJsonLd({ locale: 'en', origin: siteOrigin(''), venue: null });
    expect(ld.url).toBe('https://www.touch-padel.com/en');
    expect(ld.logo).toBe('https://www.touch-padel.com/brand/site/icon-512.png');
  });
});

describe('photo grade', () => {
  const hsl = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as [
      number,
      number,
      number,
    ];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return { h: 0, s: 0, l };
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s: d / (1 - Math.abs(2 * l - 1)), l };
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
  const WHITE = [255, 255, 255];
  const GREEN = [165, 208, 111]; // Padel Green, the headline's second line

  it('ramps only through black, white and exact shades of Touch Blue, darkest first', () => {
    const blue = hsl('#3360AB');
    for (const ramp of Object.values(PHOTO_GRADE_RAMP)) {
      let last = -1;
      for (const stop of ramp) {
        const { h, s, l } = hsl(stop);
        if (s > 0) {
          // Only lightness moves (8-bit rounding shifts hue and saturation a hair).
          expect(Math.abs(h - blue.h)).toBeLessThan(0.5);
          expect(Math.abs(s - blue.s)).toBeLessThan(0.015);
        }
        expect(l).toBeGreaterThan(last);
        last = l;
      }
    }
    expect(PHOTO_GRADE_RAMP.print.at(-1)).toBe('#FFFFFF');
    expect(PHOTO_GRADE_RAMP.night.at(-1)).toBe('#3360AB');
  });

  it('hands the filter one 0–1 table per channel', () => {
    expect(rampTables(PHOTO_GRADE_RAMP.print)).toEqual({
      r: '0.0000 0.0902 0.2000 0.4902 1.0000',
      g: '0.0000 0.1725 0.3765 0.6235 1.0000',
      b: '0.0000 0.3098 0.6706 0.8471 1.0000',
    });
  });

  it('never lets the night exposure undercut the hero type, whatever the photo', () => {
    // Every grey from black to white, and the brightest things a photo holds.
    const inputs: [number, number, number][] = [
      ...Array.from({ length: 256 }, (_, v) => [v, v, v] as [number, number, number]),
      [255, 255, 255],
      [154, 204, 255],
      [250, 220, 200],
      [255, 170, 60],
    ];
    for (const px of inputs) {
      const { rgb } = gradePixel('night', px);
      expect(contrast(rgb, WHITE)).toBeGreaterThanOrEqual(6.17);
      expect(contrast(rgb, GREEN)).toBeGreaterThanOrEqual(3.4);
    }
  });

  it('keeps a padel ball in its own colour, lit, pale or in shade', () => {
    for (const ball of [
      [213, 229, 78],
      [176, 212, 18],
      [223, 226, 158],
      [117, 157, 35],
    ] as [number, number, number][]) {
      for (const grade of ['print', 'night'] as const) {
        const { rgb, keep } = gradePixel(grade, ball);
        expect(keep).toBe(1);
        expect(rgb).toEqual(ball);
      }
    }
  });

  it('turns everything else blue: turf, lines, skin, orange shoes, timber, teal', () => {
    for (const px of [
      [51, 95, 140], // blue turf
      [237, 238, 240], // a white line
      [200, 150, 120], // skin
      [230, 200, 180], // light skin
      [240, 130, 80], // orange shoes
      [140, 120, 90], // timber
      [79, 139, 137], // teal
      [100, 130, 135], // the café's grey-teal
    ] as [number, number, number][]) {
      const { rgb, keep } = gradePixel('print', px);
      expect(keep).toBeLessThan(0.03);
      const { h, s } = hsl(`#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`);
      if (s > 0.1) expect(Math.abs(h - 217.5)).toBeLessThan(3);
    }
  });
});

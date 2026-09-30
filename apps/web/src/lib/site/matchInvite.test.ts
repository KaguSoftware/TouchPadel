import { describe, expect, it } from 'vitest';
import { formatDate, formatTime, isolate } from '@touch/i18n';
import {
  APP_MATCH_URL,
  appMatchHref,
  inviteOgImage,
  inviteWhen,
  matchInvitePath,
  parseMatchInvite,
  parseMatchToken,
} from './matchInvite';

/**
 * The invite page's pure parts: which tokens are ever sent to the server or the app, the
 * links built from them, what the page keeps of the server's answer (DF-9: nothing it
 * does not show), and the start on the branch's clock.
 */
const TOKEN = 'Ab3_-x9ZqT0kLm2NpQr7sU';

const OPEN = {
  status: 'open',
  start_at: '2026-10-01T16:30:00+00:00',
  end_at: '2026-10-01T18:00:00+00:00',
  timezone: 'Asia/Baghdad',
  category: 'women',
  join_policy: 'approve',
  seats_left: 2,
  venue: { name_en: 'Touch Padel Karbala', name_ar: 'تتش بادل كربلاء' },
};

describe('parseMatchToken', () => {
  it('accepts a 22-character share token', () => {
    expect(TOKEN).toHaveLength(22);
    expect(parseMatchToken(TOKEN)).toBe(TOKEN);
    expect(parseMatchToken([TOKEN, 'x'])).toBe(TOKEN);
  });

  it.each([
    ['21 characters', TOKEN.slice(1)],
    ['23 characters', `${TOKEN}a`],
    ['a dot', `${TOKEN.slice(0, 21)}.`],
    ['a slash', `${TOKEN.slice(0, 21)}/`],
    ['a space', ` ${TOKEN.slice(1)}`],
    ['base64 padding', `${TOKEN.slice(0, 21)}=`],
    ['a plus', `${TOKEN.slice(0, 21)}+`],
    ['markup', '"><script>alert(1)</script>'],
    ['empty', ''],
    ['missing', undefined],
  ])('refuses %s', (_, raw) => {
    expect(parseMatchToken(raw)).toBeNull();
  });
});

describe('the links', () => {
  it('opens the app on its match link route, or its home without a token', () => {
    expect(APP_MATCH_URL).toBe('touchpadel://m');
    expect(appMatchHref(TOKEN)).toBe(`touchpadel://m/${TOKEN}`);
    expect(appMatchHref(null)).toBe('touchpadel://');
  });

  it('builds the same invite in another language, or that language’s home', () => {
    expect(matchInvitePath('ar', TOKEN)).toBe(`/ar/m/${TOKEN}`);
    expect(matchInvitePath('en', null)).toBe('/en');
  });

  it('shares a static image per locale (a live seat count would go stale in a preview)', () => {
    expect(inviteOgImage('en')).toBe('/brand/site/og-touch-padel-en.png');
    expect(inviteOgImage('ar')).toBe('/brand/site/og-touch-padel-ar.png');
  });
});

describe('parseMatchInvite', () => {
  it('keeps only what the page shows', () => {
    const withMore = {
      ...OPEN,
      match_id: '7c1d2a44-0f3e-4b8a-9d61-2f5e8c9a1b30',
      organiser: { first_name: 'Ahmed', family_name: 'Kareem', phone: '+9647701234567' },
      share_iqd: 10000,
      venue: { ...OPEN.venue, id: 'b1a0c3d2-0000-4000-8000-000000000001' },
    };
    expect(parseMatchInvite(withMore)).toEqual({
      status: 'open',
      card: {
        startAt: OPEN.start_at,
        timezone: 'Asia/Baghdad',
        category: 'women',
        approve: true,
        seatsLeft: 2,
        venue: { name_en: 'Touch Padel Karbala', name_ar: 'تتش بادل كربلاء' },
      },
    });
  });

  it('reads full, open-join, and closed', () => {
    const full = parseMatchInvite({ ...OPEN, status: 'full', join_policy: 'open', seats_left: 0 });
    expect(full).toMatchObject({ status: 'full', card: { approve: false, seatsLeft: 0 } });
    expect(parseMatchInvite({ status: 'closed' })).toEqual({ status: 'closed' });
    // `closed` carries nothing else; if it ever did, it would still show nothing.
    expect(parseMatchInvite({ ...OPEN, status: 'closed' })).toEqual({ status: 'closed' });
  });

  it.each([
    ['no answer', null],
    ['a list', [OPEN]],
    ['an unknown status', { ...OPEN, status: 'booked' }],
    ['no start', { ...OPEN, start_at: undefined }],
    ['a start that is no date', { ...OPEN, start_at: 'soon' }],
    ['no timezone', { ...OPEN, timezone: null }],
    ['an unknown category', { ...OPEN, category: 'mixed' }],
    ['an unknown join policy', { ...OPEN, join_policy: 'invite' }],
    ['a fractional seat count', { ...OPEN, seats_left: 1.5 }],
    ['a negative seat count', { ...OPEN, seats_left: -1 }],
    ['a seat count as text', { ...OPEN, seats_left: '2' }],
    ['no venue', { ...OPEN, venue: null }],
    ['a venue with one name', { ...OPEN, venue: { name_en: 'Touch Padel' } }],
  ])('treats %s as an error, never a blank', (_, raw) => {
    expect(parseMatchInvite(raw)).toEqual({ status: 'error' });
  });
});

describe('inviteWhen', () => {
  it('reads the start on the branch’s clock, Latin digits in both languages', () => {
    // 16:30 UTC is 19:30 in Baghdad.
    const en = inviteWhen(OPEN.start_at, 'Asia/Baghdad', 'en');
    expect(en?.time).toBe(isolate(formatTime(new Date(OPEN.start_at), 'en', 'Asia/Baghdad')));
    expect(en?.time).toContain('7:30');
    expect(en?.weekday).toBe('Thu');
    expect(en?.date).toBe(isolate(formatDate(new Date(OPEN.start_at), 'en', 'Asia/Baghdad')));
    expect(en?.date).toMatch(/\b1\b.*2026/);

    const ar = inviteWhen(OPEN.start_at, 'Asia/Baghdad', 'ar');
    expect(ar?.time).toContain('7:30');
    expect(ar?.date).toContain('2026');
    expect(`${ar?.date}${ar?.time}`).not.toMatch(/[٠-٩]/);
  });

  it('follows the branch’s timezone, not the server’s', () => {
    expect(inviteWhen(OPEN.start_at, 'UTC', 'en')?.time).toContain('4:30');
  });

  it('falls back to the venue timezone for one this runtime does not know', () => {
    expect(inviteWhen(OPEN.start_at, 'Mars/Olympus', 'en')).toEqual(
      inviteWhen(OPEN.start_at, 'Asia/Baghdad', 'en'),
    );
  });

  it('gives nothing for a start it cannot read', () => {
    expect(inviteWhen('soon', 'Asia/Baghdad', 'en')).toBeNull();
  });
});

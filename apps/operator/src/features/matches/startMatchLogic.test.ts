import { describe, expect, it } from 'vitest';
import { t } from '@touch/i18n';
import { AppRpcError } from '../../lib/appRpc';
import {
  earliestStartAt,
  genderMismatch,
  genderOfCategory,
  guestFieldOf,
  guestFieldText,
  guestNameTooLong,
  guestPhoneInvalid,
  isMatchBanned,
  previewShares,
  quotedShare,
  stampedPriceDiffers,
  startArgs,
  startDraftErrors,
  startSeatLabels,
  type StartDraft,
} from './startMatchLogic';

const NOW = '2026-09-29T15:00:00.000Z';
const ctx = { serverNow: NOW, earliestStartMinutes: 180 };

function draft(over: Partial<StartDraft> = {}): StartDraft {
  return {
    courtId: 'c1',
    startAt: '2026-09-29T19:00:00.000Z',
    durationMin: 90,
    category: 'open',
    joinPolicy: 'open',
    visibility: 'public',
    extraSeats: 0,
    customer: null,
    guestName: 'Sara Ahmed',
    guestPhone: '07701234567',
    ...over,
  };
}

describe('earliestStartAt (OM-43 mirror)', () => {
  it("is the server's now plus the lead, never the station clock", () => {
    expect(earliestStartAt(ctx)).toBe('2026-09-29T18:00:00.000Z');
    // A dialog left open moves with the time since the payload was read.
    expect(earliestStartAt({ ...ctx, elapsedMs: 10 * 60_000 })).toBe('2026-09-29T18:10:00.000Z');
  });

  it('is unknown without the envelope, and then blocks nothing (the server still decides)', () => {
    expect(earliestStartAt({ serverNow: null, earliestStartMinutes: 180 })).toBeNull();
    expect(earliestStartAt({ serverNow: NOW, earliestStartMinutes: null })).toBeNull();
    expect(startDraftErrors(draft({ startAt: NOW }), { serverNow: null, earliestStartMinutes: null })).toEqual([]);
  });
});

describe('startDraftErrors', () => {
  it('passes a typed walk-in far enough ahead', () => {
    expect(startDraftErrors(draft(), ctx)).toEqual([]);
  });

  it('needs an organiser: a linked customer or a typed name (GUEST_REQUIRED)', () => {
    expect(startDraftErrors(draft({ guestName: '   ' }), ctx)).toEqual(['organiserRequired']);
    expect(startDraftErrors(draft({ guestName: '', customer: { id: 'g1', flags: [] } }), ctx)).toEqual([]);
  });

  it('refuses a start before the earliest time, and takes one exactly at it', () => {
    expect(startDraftErrors(draft({ startAt: '2026-09-29T17:30:00.000Z' }), ctx)).toEqual(['tooLate']);
    expect(startDraftErrors(draft({ startAt: '2026-09-29T18:00:00.000Z' }), ctx)).toEqual([]);
  });

  it('asks to join only for a linked customer (someone with the app answers requests)', () => {
    expect(startDraftErrors(draft({ joinPolicy: 'approve' }), ctx)).toEqual(['approveNeedsCustomer']);
    expect(startDraftErrors(draft({ joinPolicy: 'approve', customer: { id: 'g1', flags: [] } }), ctx)).toEqual([]);
  });

  it('holds the category against a linked customer’s declared gender, and lets an undeclared one through', () => {
    const woman = { id: 'g1', flags: [], gender: 'female' };
    expect(startDraftErrors(draft({ category: 'men', customer: woman }), ctx)).toEqual(['genderMismatch']);
    expect(startDraftErrors(draft({ category: 'women', customer: woman }), ctx)).toEqual([]);
    expect(startDraftErrors(draft({ category: 'men', customer: { id: 'g2', flags: [], gender: null } }), ctx)).toEqual([]);
    // A server before the gender re-issue sends none: nothing to mirror.
    expect(startDraftErrors(draft({ category: 'men', customer: { id: 'g3', flags: [] } }), ctx)).toEqual([]);
  });

  it('blocks a customer banned from open matches', () => {
    const banned = { id: 'g1', flags: [{ type: 'match_ban' }] };
    expect(isMatchBanned(banned)).toBe(true);
    expect(isMatchBanned({ flags: [{ type: 'vip' }] })).toBe(false);
    expect(isMatchBanned(null)).toBe(false);
    expect(startDraftErrors(draft({ customer: banned }), ctx)).toEqual(['banned']);
  });

  it("mirrors the server's typed-organiser rules: a name up to 80 characters, a phone of 7 to 15 digits or none", () => {
    expect(startDraftErrors(draft({ guestName: 'a'.repeat(80) }), ctx)).toEqual([]);
    expect(startDraftErrors(draft({ guestName: 'a'.repeat(81) }), ctx)).toEqual(['nameTooLong']);
    expect(startDraftErrors(draft({ guestPhone: '' }), ctx)).toEqual([]);
    expect(startDraftErrors(draft({ guestPhone: '0770 12' }), ctx)).toEqual(['phoneInvalid']);
    expect(startDraftErrors(draft({ guestPhone: '+964 770 123 4567' }), ctx)).toEqual([]);
    expect(startDraftErrors(draft({ guestPhone: '1234567890123456' }), ctx)).toEqual(['phoneInvalid']);
    // A linked customer sends neither: the profile's name and phone are used.
    expect(startDraftErrors(draft({ guestName: 'a'.repeat(81), guestPhone: '12', customer: { id: 'g1', flags: [] } }), ctx)).toEqual([]);
  });

  it('lists every block at once, in the order the dialog shows them', () => {
    expect(startDraftErrors(draft({ guestName: '', joinPolicy: 'approve', startAt: NOW }), ctx)).toEqual([
      'organiserRequired',
      'approveNeedsCustomer',
      'tooLate',
    ]);
  });
});

describe('guestNameTooLong / guestPhoneInvalid / guestFieldOf', () => {
  it('counts the trimmed name and the digits of the phone', () => {
    expect(guestNameTooLong(`  ${'a'.repeat(80)}  `)).toBe(false);
    expect(guestNameTooLong('a'.repeat(81))).toBe(true);
    expect(guestPhoneInvalid('   ')).toBe(false);
    expect(guestPhoneInvalid('(0770) 123-45')).toBe(false);
    expect(guestPhoneInvalid('123456')).toBe(true);
  });

  it('puts INVALID_ARGUMENT p_guest_name / p_guest_phone on its field, and nothing else', () => {
    expect(guestFieldOf(new AppRpcError('INVALID_ARGUMENT', 'INVALID_ARGUMENT', undefined, 'p_guest_phone'))).toBe('phone');
    expect(guestFieldOf(new AppRpcError('INVALID_ARGUMENT', 'INVALID_ARGUMENT', undefined, 'p_guest_name'))).toBe('name');
    expect(guestFieldOf(new AppRpcError('INVALID_ARGUMENT', 'INVALID_ARGUMENT', undefined, 'p_category'))).toBeNull();
    expect(guestFieldOf(new AppRpcError('MATCH_BANNED', 'MATCH_BANNED'))).toBeNull();
    expect(guestFieldOf(new Error('x'))).toBeNull();
  });

  it('words the limits with Latin digits in both languages (R38)', () => {
    const en = (k: Parameters<typeof t>[1], p?: Parameters<typeof t>[2]) => t('en', k, p);
    const ar = (k: Parameters<typeof t>[1], p?: Parameters<typeof t>[2]) => t('ar', k, p);
    expect(guestFieldText('phone', en, 'en')).toBe('A phone number has 7 to 15 digits.');
    expect(guestFieldText('name', en, 'en')).toBe('A name can be at most 80 characters.');
    expect(guestFieldText('phone', ar, 'ar')).toBe('يتكوّن رقم الهاتف من 7 إلى 15 رقمًا.');
    expect(guestFieldText('name', ar, 'ar')).not.toMatch(/[٠-٩]/);
  });
});

describe('genderOfCategory / genderMismatch', () => {
  it('maps the category to the gender the seats need', () => {
    expect(genderOfCategory('women')).toBe('female');
    expect(genderOfCategory('men')).toBe('male');
    expect(genderOfCategory('open')).toBeNull();
    expect(genderMismatch('open', { gender: 'male' })).toBe(false);
  });
});

describe('startArgs', () => {
  it('sends a typed organiser by name and phone, with the category’s gender and the tapped court', () => {
    expect(startArgs(draft({ category: 'women', extraSeats: 2 }), 'match.start:k1')).toEqual({
      p_start_at: '2026-09-29T19:00:00.000Z',
      p_duration_min: 90,
      p_category: 'women',
      p_visibility: 'public',
      p_join_policy: 'open',
      p_customer_id: null,
      p_guest_name: 'Sara Ahmed',
      p_guest_phone: '07701234567',
      p_gender: 'female',
      p_extra_seats: 2,
      p_court_id: 'c1',
      p_venue_id: null,
      p_idempotency_key: 'match.start:k1',
    });
  });

  it('sends a linked customer alone: the profile names them', () => {
    const args = startArgs(draft({ customer: { id: 'g1', flags: [] }, joinPolicy: 'approve', visibility: 'link' }), 'k');
    expect(args).toMatchObject({ p_customer_id: 'g1', p_guest_name: null, p_guest_phone: null, p_gender: null, p_join_policy: 'approve', p_visibility: 'link' });
  });

  it('sends no empty phone', () => {
    expect(startArgs(draft({ guestPhone: '  ' }), 'k').p_guest_phone).toBeNull();
  });
});

describe('price preview (DF-3)', () => {
  it('splits exactly, as the server stamps, and quotes the largest share', () => {
    expect(previewShares(40_000)).toEqual([10_000, 10_000, 10_000, 10_000]);
    expect(previewShares(30_002)).toEqual([7_501, 7_501, 7_500, 7_500]);
    expect(quotedShare(previewShares(30_002))).toBe(7_501);
    expect(previewShares(null)).toBeNull();
    expect(quotedShare(null)).toBeNull();
  });

  it('says the stamped price only when it differs from a known preview', () => {
    expect(stampedPriceDiffers(40_000, 40_000)).toBe(false);
    expect(stampedPriceDiffers(40_000, 45_000)).toBe(true);
    expect(stampedPriceDiffers(null, 45_000)).toBe(false);
  });
});

describe('startSeatLabels', () => {
  it('names the organiser, then +1 and +2 after the same name', () => {
    expect(startSeatLabels('Sara', 0)).toEqual([{ name: 'Sara', plus: null }]);
    expect(startSeatLabels('Sara', 2)).toEqual([
      { name: 'Sara', plus: null },
      { name: 'Sara', plus: 1 },
      { name: 'Sara', plus: 2 },
    ]);
  });
});

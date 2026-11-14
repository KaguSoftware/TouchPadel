import { describe, expect, it } from 'vitest';
import { formatTimeRangeShort, formatWeekdayShort } from '@touch/i18n';
import {
  COVER_NAMES_MAX,
  NO_DEALS,
  clockInstant,
  dealBlurb,
  dealCover,
  dealName,
  dealPointsNeeded,
  dealSchedule,
  dealValue,
  isMissingRpc,
  parseMyDeals,
  pickedDeal,
  usableDeals,
  usesLeft,
  weekdayInstant,
} from '../deals';

/**
 * Deals on the phone (0410): `my_deals` / `pick_deal` parsed, and what a deal card says.
 */

const RAW_DEAL = {
  id: 'd-1',
  name_en: 'Happy hour',
  name_ar: 'ساعة السعادة',
  blurb_en: 'Every hot drink.',
  blurb_ar: 'كل المشروبات الساخنة.',
  type: 'percent',
  value: 20,
  ends_at: '2026-11-30T20:59:00.000Z',
  weekdays: [4, 0, 1],
  hour_from: '16:00',
  hour_to: '19:00',
  live_now: false,
  min_spend_iqd: 5000,
  per_customer: 3,
  used: 1,
  tier: null,
  state: 'open',
  picked: false,
  venue_id: null,
  on: { items: [], categories: [], courts: false },
};

const raw = (over: Record<string, unknown> = {}) => ({ ...RAW_DEAL, ...over });

describe('parseMyDeals', () => {
  it('reads the contract shape', () => {
    const d = parseMyDeals({
      picked_id: 'd-1',
      picked_until: '2026-11-13T10:00:00.000Z',
      deals: [
        RAW_DEAL,
        raw({
          id: 'd-2',
          type: 'amount',
          value: 5000,
          state: 'locked',
          tier: { id: 't2', name_en: 'Gold', name_ar: 'ذهبي', color: 'gold', min_points_12m: 1500 },
          on: {
            items: [{ name_en: 'Latte', name_ar: 'لاتيه' }],
            categories: [{ name_en: 'Coffee', name_ar: 'قهوة' }],
            courts: true,
          },
        }),
      ],
    });
    expect(d.picked_id).toBe('d-1');
    expect(d.picked_until).toBe('2026-11-13T10:00:00.000Z');
    expect(d.deals[0]).toEqual({
      ...RAW_DEAL,
      weekdays: [0, 1, 4],
      picked: true,
    });
    expect(d.deals[1]).toMatchObject({
      id: 'd-2',
      type: 'amount',
      value: 5000,
      state: 'locked',
      picked: false,
      tier: { id: 't2', color: 'gold', min_points_12m: 1500 },
      on: { items: [{ name_en: 'Latte' }], categories: [{ name_en: 'Coffee' }], courts: true },
    });
  });

  it('anything unreadable is no deals, never a crash', () => {
    for (const bad of [null, undefined, 'x', 7, [], { deals: 'x' }, { deals: null }]) {
      expect(parseMyDeals(bad)).toEqual(NO_DEALS);
    }
  });

  it('leaves out a deal it cannot show honestly and keeps the rest', () => {
    const d = parseMyDeals({
      picked_id: null,
      picked_until: null,
      deals: [
        null,
        raw({ id: '' }),
        raw({ id: 'no-name', name_en: ' ', name_ar: '' }),
        raw({ id: 'no-type', type: 'bogo' }),
        raw({ id: 'no-value', value: 0 }),
        raw({ id: 'too-much', value: 140 }),
        raw({ id: 'no-state', state: 'paused' }),
        raw({ id: 'kept' }),
        raw({ id: 'kept', name_en: 'Twice' }),
      ],
    });
    expect(d.deals.map((x) => [x.id, x.name_en])).toEqual([['kept', 'Happy hour']]);
  });

  it('reads the limits defensively', () => {
    const [d] = parseMyDeals({
      deals: [
        raw({
          type: 'amount',
          value: '2500.4',
          ends_at: 'soon',
          weekdays: [1, 1, 9, -1, 'x', 6],
          hour_from: '16:00',
          hour_to: null,
          live_now: undefined,
          min_spend_iqd: 0,
          per_customer: null,
          used: -2,
          blurb_en: '  ',
          blurb_ar: null,
          tier: { name_en: 'No id' },
          on: null,
        }),
      ],
    }).deals;
    expect(d).toMatchObject({
      // Whole IQD: formatIQD refuses anything else.
      value: 2500,
      ends_at: null,
      weekdays: [1, 6],
      // Half a pair of hours is no hours.
      hour_from: null,
      hour_to: null,
      // Only an explicit false says "not right now".
      live_now: true,
      min_spend_iqd: null,
      per_customer: null,
      used: 0,
      blurb_en: null,
      blurb_ar: null,
      tier: null,
      on: { items: [], categories: [], courts: false },
    });
  });

  it('the pick is one deal, named by picked_id, and only while that deal is open', () => {
    // The flag on a row is not the source: picked_id is.
    const flagged = parseMyDeals({ picked_id: null, deals: [raw({ picked: true })] });
    expect(flagged.picked_id).toBeNull();
    expect(flagged.deals[0]?.picked).toBe(false);

    const gone = parseMyDeals({ picked_id: 'elsewhere', picked_until: '2026-11-13T10:00:00Z', deals: [RAW_DEAL] });
    expect(gone).toMatchObject({ picked_id: null, picked_until: null });

    const used = parseMyDeals({ picked_id: 'd-1', deals: [raw({ state: 'used' })] });
    expect(used.picked_id).toBeNull();
    expect(used.deals[0]?.picked).toBe(false);

    const badUntil = parseMyDeals({ picked_id: 'd-1', picked_until: 'later', deals: [RAW_DEAL] });
    expect(badUntil).toMatchObject({ picked_id: 'd-1', picked_until: null });
  });
});

describe('isMissingRpc', () => {
  it('is PostgREST saying it has no such function, and nothing else', () => {
    expect(isMissingRpc({ code: 'PGRST202', message: 'Could not find the function app.my_deals' })).toBe(true);
    expect(isMissingRpc({ code: 'P0001', message: 'DEAL_USED' })).toBe(false);
    expect(isMissingRpc({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingRpc(new Error('Network request failed'))).toBe(false);
    expect(isMissingRpc(null)).toBe(false);
  });
});

describe('pickedDeal', () => {
  const deals = parseMyDeals({
    picked_id: 'd-1',
    picked_until: '2026-11-13T10:00:00.000Z',
    deals: [RAW_DEAL, raw({ id: 'd-2' })],
  });

  it('is the picked deal while the pick is live', () => {
    expect(pickedDeal(deals, Date.parse('2026-11-13T09:59:59.000Z'))?.id).toBe('d-1');
  });

  it('is nothing once the 24 hours are up, with no pick, or with no read', () => {
    expect(pickedDeal(deals, Date.parse('2026-11-13T10:00:00.000Z'))).toBeNull();
    expect(pickedDeal(parseMyDeals({ picked_id: null, deals: [RAW_DEAL] }), 0)).toBeNull();
    expect(pickedDeal(undefined, 0)).toBeNull();
    expect(pickedDeal(null, 0)).toBeNull();
    expect(pickedDeal(NO_DEALS, 0)).toBeNull();
  });

  it('holds without an end when the answer carried none', () => {
    const open = parseMyDeals({ picked_id: 'd-1', picked_until: null, deals: [RAW_DEAL] });
    expect(pickedDeal(open, Date.parse('2030-01-01T00:00:00Z'))?.id).toBe('d-1');
  });
});

describe('what a deal card says', () => {
  const [deal] = parseMyDeals({ deals: [RAW_DEAL] }).deals;

  it('names it in the guest language, the other when empty', () => {
    expect(dealName(deal!, 'ar')).toBe('ساعة السعادة');
    expect(dealName({ name_en: 'Only English', name_ar: '' }, 'ar')).toBe('Only English');
    expect(dealBlurb(deal!, 'en')).toBe('Every hot drink.');
    expect(dealBlurb({ blurb_en: 'Only English', blurb_ar: null }, 'ar')).toBe('Only English');
    expect(dealBlurb({ blurb_en: null, blurb_ar: null }, 'en')).toBeNull();
  });

  it('gives the value as a percent or an IQD amount', () => {
    expect(dealValue({ type: 'percent', value: 20 })).toEqual({ kind: 'percent', percent: 20 });
    expect(dealValue({ type: 'amount', value: 5000 })).toEqual({ kind: 'amount', iqd: 5000 });
  });

  it('covers the whole café bill when nothing is named', () => {
    expect(dealCover(deal!, 'en')).toEqual({ names: [], more: false, courts: false });
  });

  it('lists categories then items, in the guest language, and says when there are more', () => {
    const on = {
      categories: [{ name_en: 'Coffee', name_ar: 'قهوة' }],
      items: [
        { name_en: 'Latte', name_ar: 'لاتيه' },
        { name_en: 'Coffee', name_ar: 'قهوة' },
        { name_en: 'Cake', name_ar: '' },
        { name_en: 'Tea', name_ar: 'شاي' },
      ],
      courts: true,
    };
    expect(dealCover({ on }, 'ar')).toEqual({
      names: ['قهوة', 'لاتيه', 'Cake'],
      more: true,
      courts: true,
    });
    expect(dealCover({ on: { ...on, items: on.items.slice(0, 2) } }, 'en')).toEqual({
      names: ['Coffee', 'Latte'],
      more: false,
      courts: true,
    });
    expect(COVER_NAMES_MAX).toBe(3);
  });

  it('says when it runs: days in week order, hours as a pair, seven days as every day', () => {
    expect(dealSchedule(deal!)).toEqual({
      weekdays: [0, 1, 4],
      hours: { from: '16:00', to: '19:00' },
      limited: true,
    });
    expect(dealSchedule({ weekdays: [], hour_from: null, hour_to: null })).toEqual({
      weekdays: [],
      hours: null,
      limited: false,
    });
    expect(dealSchedule({ weekdays: [0, 1, 2, 3, 4, 5, 6], hour_from: null, hour_to: null }).limited).toBe(false);
    expect(dealSchedule({ weekdays: [], hour_from: '22:00', hour_to: '02:00' })).toMatchObject({
      hours: { from: '22:00', to: '02:00' },
      limited: true,
    });
  });

  it('the instants read back as the weekday and the clock they stand for', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => weekdayInstant(d).getUTCDay())).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(formatWeekdayShort(weekdayInstant(5), 'en', 'UTC')).toBe('Fri');
    expect(formatWeekdayShort(weekdayInstant(0), 'ar', 'UTC')).toBe('الأحد');
    expect(clockInstant('16:30').getUTCHours()).toBe(16);
    expect(clockInstant('16:30').getUTCMinutes()).toBe(30);
    const strip = (s: string) => s.replace(/[⁦-⁩]/g, '');
    expect(strip(formatTimeRangeShort(clockInstant('16:00'), clockInstant('19:00'), 'en', 'UTC'))).toBe('4 → 7 PM');
    // Across midnight: both ends keep their half of the day.
    expect(strip(formatTimeRangeShort(clockInstant('22:00'), clockInstant('02:00'), 'en', 'UTC'))).toBe(
      '10 PM → 2 AM',
    );
  });

  it('counts the uses left, never below zero, and only when the deal counts them', () => {
    expect(usesLeft({ per_customer: 3, used: 1 })).toBe(2);
    expect(usesLeft({ per_customer: 1, used: 4 })).toBe(0);
    expect(usesLeft({ per_customer: null, used: 9 })).toBeNull();
  });

  it('says what a locked deal still needs', () => {
    const tier = { id: 't2', name_en: 'Gold', name_ar: 'ذهبي', color: 'gold' as const, min_points_12m: 1500 };
    expect(dealPointsNeeded({ state: 'locked', tier }, 900)).toBe(600);
    expect(dealPointsNeeded({ state: 'locked', tier }, 2000)).toBe(0);
    expect(dealPointsNeeded({ state: 'open', tier }, 900)).toBeNull();
    expect(dealPointsNeeded({ state: 'locked', tier: null }, 900)).toBeNull();
  });

  it('lists the usable deals for the Club tab: open only, the picked one first', () => {
    const deals = parseMyDeals({
      picked_id: 'd-b',
      picked_until: '2099-01-01T00:00:00.000Z',
      deals: [
        { ...RAW_DEAL, id: 'd-a', state: 'open' },
        { ...RAW_DEAL, id: 'd-l', state: 'locked' },
        { ...RAW_DEAL, id: 'd-b', state: 'open' },
        { ...RAW_DEAL, id: 'd-u', state: 'used' },
      ],
    });
    const usable = usableDeals(deals);
    expect(usable?.deals.map((d) => d.id)).toEqual(['d-b', 'd-a']);
    expect(usable?.picked_id).toBe('d-b');
    expect(usable?.picked_until).toBe('2099-01-01T00:00:00.000Z');
    // Nothing to use, or nothing read: nothing to list.
    expect(
      usableDeals(parseMyDeals({ deals: [{ ...RAW_DEAL, id: 'd-l', state: 'locked' }] })),
    ).toBeNull();
    expect(usableDeals(NO_DEALS)).toBeNull();
    expect(usableDeals(undefined)).toBeNull();
  });
});

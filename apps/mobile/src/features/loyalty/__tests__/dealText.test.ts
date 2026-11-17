import { describe, expect, it } from 'vitest';
import { formatIQD, isolate, isolateLtr, makeT } from '@touch/i18n';
import { parseMyDeals } from '../deals';
import { dealFacts, dealHeadline, dealValueText } from '../dealText';

/**
 * What a deal says (2026-11-15): its value in words, the line under its name, and the sheet's facts.
 */

const RAW = {
  id: 'd-1',
  name_en: 'Happy hour',
  name_ar: 'ساعة السعادة',
  blurb_en: null,
  blurb_ar: null,
  type: 'percent',
  value: 20,
  ends_at: null,
  weekdays: [],
  hour_from: null,
  hour_to: null,
  live_now: true,
  min_spend_iqd: null,
  per_customer: null,
  used: 0,
  tier: null,
  state: 'open',
  venue_id: null,
  on: { items: [], categories: [], courts: false },
};
const latte = { name_en: 'Latte', name_ar: 'لاتيه', photo_path: null, category_en: 'Hot Drinks' };
const cake = { name_en: 'Cake', name_ar: 'كيك', photo_path: null, category_en: 'Desserts' };

const deal = (over: Record<string, unknown> = {}) => {
  const d = parseMyDeals({ deals: [{ ...RAW, ...over }] }).deals[0];
  if (!d) throw new Error('fixture did not parse');
  return d;
};

describe.each(['en', 'ar'] as const)('deal words in %s', (locale) => {
  const t = makeT(locale);
  const ctx = { t, locale, tz: 'Asia/Baghdad', pickedUntil: null, points12m: 0 };

  it('says the value: percent, amount, buy one get one free or at a percent', () => {
    expect(dealValueText(deal(), t, locale)).toBe(t('loyalty.guest.deals.percentOff', { percent: isolateLtr('20%') }));
    expect(dealValueText(deal({ type: 'amount', value: 2000 }), t, locale)).toBe(
      t('loyalty.guest.deals.amountOff', { amount: isolate(formatIQD(2000, locale)) }),
    );
    const look = { get: [cake], buy: [latte] };
    expect(dealValueText(deal({ type: 'free_item', value: 100, look }), t, locale)).toBe(t('loyalty.guest.deals.bogoShort'));
    expect(dealValueText(deal({ type: 'free_item', value: 50, look }), t, locale)).toBe(
      t('loyalty.guest.deals.bogoShortPercent', { percent: isolateLtr('50%') }),
    );
  });

  it('the line under the name: the owner\'s line first, else what it is', () => {
    expect(dealHeadline(deal({ blurb_en: 'Every hot drink.', blurb_ar: 'كل المشروبات الساخنة.' }), t, locale)).toBe(
      locale === 'ar' ? 'كل المشروبات الساخنة.' : 'Every hot drink.',
    );
    expect(dealHeadline(deal(), t, locale)).toBe(t('loyalty.guest.deals.wholeBill'));
    const name = (x: { name_en: string; name_ar: string }) => isolate(locale === 'ar' ? x.name_ar : x.name_en);
    expect(dealHeadline(deal({ type: 'free_item', value: 100, look: { get: [cake], buy: [latte] } }), t, locale)).toBe(
      t('loyalty.guest.deals.bogo', { buy: name(latte), get: name(cake) }),
    );
    // Earned by a court booking.
    expect(dealHeadline(deal({ type: 'free_item', value: 50, look: { get: [cake], courts: true } }), t, locale)).toBe(
      t('loyalty.guest.deals.courtGetPercent', { get: name(cake), percent: isolateLtr('50%') }),
    );
  });

  it('lists every fact, saying "every day", "all day", "no end" and "as often as you like" when it has no limit', () => {
    const facts = dealFacts(deal(), ctx);
    const by = Object.fromEntries(facts.map((f) => [f.key, f.value]));
    expect(by).toMatchObject({
      days: t('loyalty.guest.deals.everyDay'),
      hours: t('loyalty.guest.deals.allDay'),
      until: t('loyalty.guest.deals.noEnd'),
      uses: t('loyalty.guest.deals.usesUnlimited'),
      card: t('loyalty.guest.deals.anyCard'),
    });
    expect(by.min).toBeUndefined();
    expect(by.buy).toBeUndefined();
  });

  it('a limited deal says its uses left of its total, its minimum, and a buy-one-get-one what earns and what is given', () => {
    const facts = dealFacts(
      deal({
        type: 'free_item',
        value: 100,
        look: { get: [cake], buy: [latte], per_bill: 2 },
        per_customer: 3,
        used: 1,
        min_spend_iqd: 5000,
        weekdays: [5, 6],
        hour_from: '07:00',
        hour_to: '12:00',
      }),
      ctx,
    );
    const by = Object.fromEntries(facts.map((f) => [f.key, f.value]));
    expect(facts.map((f) => f.key)).toEqual(['buy', 'get', 'per-bill', 'days', 'hours', 'until', 'min', 'uses', 'card']);
    expect(by.uses).toBe(t('loyalty.guest.deals.usesOf', { count: isolateLtr('2'), total: isolateLtr('3') }));
    expect(by.min).toBe(isolate(formatIQD(5000, locale)));
    expect(by['per-bill']).toBe(isolateLtr('2'));
    expect(by.get).toContain(t('loyalty.guest.deals.free'));
    expect(by.days).not.toBe(t('loyalty.guest.deals.everyDay'));
    expect(by.hours).not.toBe(t('loyalty.guest.deals.allDay'));
  });

  it('a locked deal names its card and the points to go; a picked one says until when', () => {
    const tier = { id: 't2', name_en: 'Silver', name_ar: 'فضي', color: 'silver', min_points_12m: 600 };
    const locked = Object.fromEntries(dealFacts(deal({ state: 'locked', tier }), ctx).map((f) => [f.key, f.value]));
    expect(locked.card).toBe(t('loyalty.guest.deals.needs', { tier: isolate(locale === 'ar' ? 'فضي' : 'Silver') }));
    expect(locked.needed).toBe(isolateLtr('600'));
    const picked = parseMyDeals({ picked_id: 'd-1', picked_until: '2026-11-16T10:00:00.000Z', deals: [RAW] }).deals[0]!;
    const held = dealFacts(picked, { ...ctx, pickedUntil: '2026-11-16T10:00:00.000Z' });
    expect(held.some((f) => f.key === 'held')).toBe(true);
  });
});

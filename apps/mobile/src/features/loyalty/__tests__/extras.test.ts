import { describe, expect, it } from 'vitest';
import {
  NO_EXTRAS,
  birthdayView,
  clubToday,
  drinkCardView,
  openCardGifts,
  parseCardExtras,
  slotsPerRow,
} from '../extras';

/**
 * The drink card and the birthday gifts on the phone (0445, `app.my_card_extras`): the answer
 * parsed, the stamp slots laid out in their three states, and the one birthday line picked.
 */

const stamps = (over: Partial<typeof NO_EXTRAS.stamps> = {}) => ({
  ...NO_EXTRAS.stamps,
  enabled: true,
  ...over,
});

const GIFT = {
  perk_id: 'g-drink',
  name_en: 'A birthday drink',
  name_ar: 'مشروب عيد الميلاد',
  target: 'items' as const,
  window_from: '2026-11-12',
  window_to: '2026-11-18',
  eligible: true,
  used: false,
};
const ON_CARD = [
  { perk_id: 'g-drink', name_en: 'A birthday drink', name_ar: 'مشروب عيد الميلاد', target: 'items' as const, days: 7 },
];
const birthday = (over: Partial<typeof NO_EXTRAS.birthday> = {}) => ({
  has_date: true,
  gifts: [],
  counts_from: '2025-01-01',
  gifts_on_card: ON_CARD,
  ...over,
});
const TODAY = '2026-11-14';

describe('parseCardExtras', () => {
  it('reads the drink card and the gifts as they came', () => {
    const x = parseCardExtras({
      stamps: { enabled: true, count: 5, size: 6, ready: false, held: true },
      birthday: {
        has_date: true,
        gifts: [GIFT],
        counts_from: '2026-12-01',
        gifts_on_card: [{ perk_id: 'g-drink', name_en: ' A birthday drink ', name_ar: '', days: 3 }],
      },
      gifts: [
        { perk_id: 'm-1', name_en: 'Drink of the month', name_ar: 'مشروب الشهر', when: 'monthly', target: 'items', window_to: '2026-11-30', used: false },
        { perk_id: 'x', name_en: 'Odd', when: 'weekly' },
      ],
    });
    expect(x.stamps).toEqual({ enabled: true, count: 5, size: 6, ready: false, held: true, claimed_until: null });
    expect(x.birthday.gifts).toEqual([{ ...GIFT, claimed_until: null }]);
    expect(x.birthday.counts_from).toBe('2026-12-01');
    // A server before the court gifts sends no target: an item.
    expect(x.birthday.gifts_on_card).toEqual([
      { perk_id: 'g-drink', name_en: 'A birthday drink', name_ar: '', target: 'items', days: 3 },
    ]);
    // An unknown `when` is left out.
    expect(x.gifts).toEqual([
      { perk_id: 'm-1', name_en: 'Drink of the month', name_ar: 'مشروب الشهر', when: 'monthly', target: 'items', window_to: '2026-11-30', used: false, claimed_until: null },
    ]);
  });

  it('anything unreadable is off, never a crash', () => {
    expect(parseCardExtras(null)).toEqual(NO_EXTRAS);
    expect(parseCardExtras('x')).toEqual(NO_EXTRAS);
    const x = parseCardExtras({
      stamps: { enabled: 'yes', count: -4, size: 99 },
      birthday: { gifts: [{ name_en: 'no id' }, 'x'], counts_from: 'soon', gifts_on_card: [{ perk_id: 'p', days: 90 }] },
    });
    expect(x.stamps).toEqual({ enabled: false, count: 0, size: 8, ready: false, held: false, claimed_until: null });
    expect(x.birthday.gifts).toEqual([]);
    expect(x.birthday.counts_from).toBeNull();
    expect(x.birthday.gifts_on_card[0]?.days).toBe(7);
  });
});

describe('drinkCardView', () => {
  it('is not shown while the drink card is off', () => {
    expect(drinkCardView(NO_EXTRAS.stamps)).toBeNull();
    expect(drinkCardView(null)).toBeNull();
  });

  it('fills a slot per stamp, the free drink last', () => {
    const v = drinkCardView(stamps({ count: 3, size: 8 }));
    expect(v).toMatchObject({ state: 'filling', size: 8, filled: 3, remaining: 5 });
    expect(v?.rows).toEqual([[true, true, true, false, false, false, false, false]]);
  });

  it('a full card is ready: the next bill frees the drink', () => {
    expect(drinkCardView(stamps({ count: 8, size: 8, ready: true }))).toMatchObject({
      state: 'ready',
      filled: 8,
      remaining: 0,
    });
    // Stamps past a full card wait for the next one; the slots never overflow.
    expect(drinkCardView(stamps({ count: 11, size: 6, ready: true }))?.filled).toBe(6);
  });

  it('held wins: the drink is already on an open bill', () => {
    expect(drinkCardView(stamps({ count: 6, size: 6, ready: true, held: true }))?.state).toBe('held');
  });

  it('a Blue card fills at 6, laid out in one row; a long card in two even rows', () => {
    expect(drinkCardView(stamps({ count: 2, size: 6 }))?.rows).toHaveLength(1);
    expect(slotsPerRow(8)).toBe(8);
    expect(slotsPerRow(12)).toBe(6);
    expect(slotsPerRow(20)).toBe(10);
    const long = drinkCardView(stamps({ count: 7, size: 12 }));
    expect(long?.rows.map((r) => r.length)).toEqual([6, 6]);
    expect(long?.rows[1]).toEqual([true, false, false, false, false, false]);
  });
});

describe('birthdayView', () => {
  it('an open, counted, unused gift is the banner, with the day it ends said once', () => {
    const v = birthdayView(birthday({ gifts: [GIFT, { ...GIFT, perk_id: 'g-cake', name_en: 'A dessert' }] }), TODAY);
    expect(v).toEqual({
      kind: 'open',
      sameEnd: '2026-11-18',
      gifts: [
        { perk_id: 'g-drink', name_en: 'A birthday drink', name_ar: 'مشروب عيد الميلاد', target: 'items', until: '2026-11-18', claimedUntil: null },
        { perk_id: 'g-cake', name_en: 'A dessert', name_ar: 'مشروب عيد الميلاد', target: 'items', until: '2026-11-18', claimedUntil: null },
      ],
    });
  });

  it('gifts ending on different days each say their own end', () => {
    const v = birthdayView(birthday({ gifts: [GIFT, { ...GIFT, perk_id: 'g-2', window_to: '2026-11-14' }] }), TODAY);
    expect(v).toMatchObject({ kind: 'open', sameEnd: null });
  });

  it('a used gift is not offered again; with every gift used there is nothing to say', () => {
    expect(birthdayView(birthday({ gifts: [{ ...GIFT, used: true }] }), TODAY)).toEqual({ kind: 'none' });
  });

  it('gifts on the card and no birth date: the quiet prompt', () => {
    expect(birthdayView(birthday({ has_date: false, counts_from: null }), TODAY)).toEqual({ kind: 'noDate' });
  });

  it('a date set recently says when it starts counting', () => {
    expect(birthdayView(birthday({ counts_from: '2026-12-01' }), TODAY)).toEqual({
      kind: 'waiting',
      countsFrom: '2026-12-01',
    });
    // Moved onto today: the window is open but the gift is not counted yet.
    expect(
      birthdayView(birthday({ counts_from: '2026-12-10', gifts: [{ ...GIFT, eligible: false }] }), TODAY),
    ).toEqual({ kind: 'waiting', countsFrom: '2026-12-10' });
  });

  it('counted from a day already past but too late for this window: the next birthday', () => {
    expect(
      birthdayView(birthday({ counts_from: '2026-11-13', gifts: [{ ...GIFT, eligible: false }] }), TODAY),
    ).toEqual({ kind: 'nextYear' });
  });

  it('a card without birthday gifts says nothing at all', () => {
    expect(birthdayView(birthday({ gifts_on_card: [], has_date: false }), TODAY)).toEqual({ kind: 'none' });
    expect(birthdayView(birthday({ gifts_on_card: [] , counts_from: '2026-12-01'}), TODAY)).toEqual({ kind: 'none' });
    expect(birthdayView(null, TODAY)).toEqual({ kind: 'none' });
  });
});

describe('clubToday', () => {
  it('is the Baghdad calendar day, which runs three hours ahead of UTC', () => {
    expect(clubToday(new Date('2026-11-14T20:59:00Z'))).toBe('2026-11-14');
    expect(clubToday(new Date('2026-11-14T21:00:00Z'))).toBe('2026-11-15');
  });
});

describe('openCardGifts (0445)', () => {
  const gift = (over: Record<string, unknown>) =>
    parseCardExtras({
      gifts: [
        { perk_id: 'm-1', name_en: 'Drink of the month', name_ar: 'مشروب الشهر', when: 'monthly', target: 'items', window_to: '2026-11-30', used: false, ...over },
      ],
    }).gifts;

  it('offers an open gift with the day it ends, court hours marked', () => {
    expect(openCardGifts(gift({}))).toEqual([
      { perk_id: 'm-1', name_en: 'Drink of the month', name_ar: 'مشروب الشهر', target: 'items', when: 'monthly', until: '2026-11-30', claimedUntil: null },
    ]);
    expect(openCardGifts(gift({ target: 'court_hour' }))[0]?.target).toBe('court_hour');
  });

  it('a used gift is hidden; a server without gifts shows none', () => {
    expect(openCardGifts(gift({ used: true }))).toEqual([]);
    expect(openCardGifts(undefined)).toEqual([]);
    expect(parseCardExtras({}).gifts).toEqual([]);
  });

  it('a card-up welcome comes before the month\'s gift', () => {
    const both = parseCardExtras({
      gifts: [
        { perk_id: 'm', name_en: 'Month', name_ar: '', when: 'monthly', target: 'items', window_to: '2026-11-30', used: false },
        { perk_id: 'u', name_en: 'Welcome drink', name_ar: '', when: 'card_up', target: 'items', window_to: '2026-12-10', used: false },
      ],
    }).gifts;
    expect(openCardGifts(both).map((g) => g.perk_id)).toEqual(['u', 'm']);
  });

  it('a birthday court hour keeps its target into the banner', () => {
    const v = birthdayView(birthday({ gifts: [{ ...GIFT, target: 'court_hour' }] }), TODAY);
    expect(v).toMatchObject({ kind: 'open', gifts: [{ target: 'court_hour' }] });
  });
});

describe('Redeem in the app (2026-11-15)', () => {
  const until = '2026-11-20T21:00:00.000Z';

  it('reads when a press holds, and drops what is not an instant', () => {
    const x = parseCardExtras({
      stamps: { enabled: true, count: 6, size: 6, ready: true, held: false, claimed_until: until },
      birthday: { gifts: [{ ...GIFT, claimed_until: until }] },
      gifts: [{ perk_id: 'm-1', name_en: 'Drink', when: 'monthly', window_to: '2026-11-30', claimed_until: 'soon' }],
    });
    expect(x.stamps.claimed_until).toBe(until);
    expect(x.birthday.gifts[0]?.claimed_until).toBe(until);
    expect(x.gifts?.[0]?.claimed_until).toBeNull();
  });

  it('a full card waits for Redeem; once pressed it is claimed until then; a bill holding it wins', () => {
    expect(drinkCardView(stamps({ count: 6, size: 6, ready: true }))).toMatchObject({ state: 'ready', claimedUntil: null });
    expect(drinkCardView(stamps({ count: 6, size: 6, ready: true, claimed_until: until }))).toMatchObject({
      state: 'claimed',
      claimedUntil: until,
    });
    expect(drinkCardView(stamps({ count: 6, size: 6, ready: true, held: true, claimed_until: until }))).toMatchObject({
      state: 'held',
      claimedUntil: null,
    });
    // A press left over on a card that is not full any more says nothing.
    expect(drinkCardView(stamps({ count: 2, size: 6, claimed_until: until }))?.state).toBe('filling');
  });

  it('carries the press onto the gifts the screens show', () => {
    const view = birthdayView(birthday({ gifts: [{ ...GIFT, claimed_until: until }] }), '2026-11-14');
    expect(view.kind === 'open' && view.gifts[0]?.claimedUntil).toBe(until);
    expect(
      openCardGifts([
        { perk_id: 'm-1', name_en: 'Drink', name_ar: '', when: 'monthly', target: 'items', window_to: '2026-11-30', used: false, claimed_until: until },
      ])[0]?.claimedUntil,
    ).toBe(until);
  });
});

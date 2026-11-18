import { describe, expect, it } from 'vitest';
import {
  adjustErrors,
  courtRewardFits,
  monthlyEarned,
  pointsOffOn,
  rewardsForTab,
  defaultRedeemPoints,
  dealCodeErrorKey,
  identifyCode,
  isBaseTier,
  isLoyaltyScan,
  isMemberScan,
  parseAppCode,
  ledgerKind,
  loyaltyAdjustments,
  loyaltyDiscountIqd,
  memberView,
  parseMultiplier,
  parseSigned,
  parseWhole,
  redeemBlock,
  redeemWorth,
  rewardErrors,
  rewardPayload,
  rewardsHere,
  settingsDraft,
  settingsErrors,
  settingsPatch,
  suggestTierColor,
  tierDraft,
  tierErrors,
  tierPayload,
  type RewardDraft,
} from './loyaltyLogic';
import {
  PERK_NAME_MAX,
  benefitsShown,
  defaultPerkNames,
  isTierPerkAdjustment,
  liveGroupIds,
  perkDraft,
  perkErrors,
  perkGives,
  perkPayload,
  perksRefreshSignature,
  perksSupported,
  readTabBenefits,
  sortedPerks,
  withAutoNames,
  type AddonGroup,
} from './loyaltyLogic';
import {
  billPerks,
  giftsToday,
  readCourtGift,
  withGiftWhen,
  defaultNamesFor,
  excludableItems,
  extrasShown,
  frameIdOf,
  frameWord,
  lineReasons,
  memberCardShown,
  menuKnown,
  perkHandling,
  perkLineTotals,
  perkMissing,
  readCardExtras,
  readPerkLines,
  readStampCard,
  rewardClaim,
  stampCardDraft,
  stampCardErrors,
  stampCardPayload,
  stampSizesByCard,
  stampState,
  type MenuNames,
  type PerkDraft,
} from './loyaltyLogic';
import { BarcodeWedge } from '../till/barcodeWedge';
import type {
  CardExtras,
  CourtRewardState,
  IdentifiedMember,
  LoyaltyAdminPerk,
  LoyaltyAdminTier,
  LoyaltySettings,
  TabBenefits,
} from '@touch/core/loyalty';

const TOKEN = 'TP-8F3K2QXM-482913';

describe('the member field', () => {
  it('sends a scanned or typed token as the token, uppercased and trimmed', () => {
    expect(identifyCode(` ${TOKEN.toLowerCase()} `)).toEqual({ code: TOKEN, method: 'qr' });
  });

  it('sends a spoken phone as its digits', () => {
    expect(identifyCode('0770 123 4567')).toEqual({ code: '07701234567', method: 'phone' });
  });

  it('refuses a broken token, a short number and words', () => {
    expect(identifyCode('TP-8F3K2QXM-48291')).toBeNull();
    expect(identifyCode('12345')).toBeNull();
    expect(identifyCode('latte')).toBeNull();
  });

  it('tells a member card burst from a product barcode', () => {
    expect(isMemberScan(TOKEN)).toBe(true);
    expect(isMemberScan('tp-8f3k2qxm-482913')).toBe(true);
    expect(isMemberScan('6291041500213')).toBe(false);
    expect(isMemberScan('TP-SHIRT-01')).toBe(false);
  });
});

describe('a member card through the till’s wedge', () => {
  it('passes a TP- burst through in idle (nothing held) and recognises its Enter as a member scan', () => {
    const w = new BarcodeWedge();
    let t = 1000;
    for (const key of TOKEN) expect(w.feed(key, (t += 8), 'idle').kind).toBe('pass');
    const end = w.feed('Enter', (t += 8), 'idle');
    expect(end).toEqual({ kind: 'scan', code: TOKEN });
    expect(isMemberScan(end.kind === 'scan' ? end.code : '')).toBe(true);
  });

  // 0445: a deal's code from the app rides the same route as a reward voucher, never the member lookup.
  it('routes a TPD- deal code burst to the member block, and never reads it as a member card or a reward', () => {
    const DEAL = 'TPD-8F3K-2QXM-9ABC';
    const w = new BarcodeWedge();
    let t = 1000;
    for (const key of DEAL) expect(w.feed(key, (t += 8), 'idle').kind).toBe('pass');
    const end = w.feed('Enter', (t += 8), 'idle');
    expect(end).toEqual({ kind: 'scan', code: DEAL });
    const code = end.kind === 'scan' ? end.code : '';
    expect(isLoyaltyScan(code)).toBe(true);
    expect(isMemberScan(code)).toBe(false);
    expect(identifyCode(code)).toBeNull();
    expect(parseAppCode(code)).toEqual({ kind: 'deal', code: 'TPD-8F3K2QXM9ABC' });
  });

  it('leaves a person typing a T word alone', () => {
    const w = new BarcodeWedge();
    let t = 1000;
    for (const key of 'TEA') w.feed(key, (t += 180), 'filter');
    expect(w.feed('Enter', (t += 180), 'filter')).toEqual({ kind: 'pass' });
  });
});

describe('memberView', () => {
  const identified: IdentifiedMember = {
    customer_id: 'p1',
    display_name: 'Ali H.',
    phone_masked: '0770 *** 4567',
    tier_name_en: 'Member',
    tier_name_ar: 'عضو',
    balance: 120,
    enabled: true,
  };

  it('takes the name from the identify answer and the balance from the account read', () => {
    const v = memberView('p1', identified, {
      balance: 80,
      lifetime: 300,
      points_12m: 200,
      tier: { id: 't2', name_en: 'Gold', name_ar: 'ذهبي', multiplier: 1.5, color: 'gold' },
      history: [],
    });
    expect(v).toEqual({
      customerId: 'p1',
      displayName: 'Ali H.',
      phoneMasked: '0770 *** 4567',
      tierEn: 'Gold',
      tierAr: 'ذهبي',
      balance: 80,
      enabled: true,
    });
  });

  it('has no name and an unknown switch for a member known only by id', () => {
    const v = memberView('p1', null, {
      balance: 5,
      lifetime: 5,
      points_12m: 5,
      tier: null,
      history: [],
    });
    expect(v.displayName).toBeNull();
    expect(v.enabled).toBeNull();
    expect(v.tierEn).toBeNull();
    expect(v.balance).toBe(5);
  });
});

describe('loyalty rows on a tab', () => {
  const rows = [
    { id: 'a', kind: 'discount_amount', amount_iqd: 1000, reason_code: 'comp' },
    {
      id: 'b',
      kind: 'discount_amount',
      amount_iqd: 2500,
      reason_code: 'loyalty_points',
      value: 50,
    },
    { id: 'c', kind: 'discount_amount', amount_iqd: 3000, reason_code: 'loyalty_reward', value: 0 },
    { id: 'd', kind: 'discount_amount', amount_iqd: 700, reason_code: 'promotion' },
  ];

  it('keeps only the redemptions', () => {
    expect(loyaltyAdjustments(rows).map((r) => r.id)).toEqual(['b', 'c']);
    expect(loyaltyDiscountIqd(rows)).toBe(5500);
  });
});

describe('Use points', () => {
  const known = { pointValueIqd: 50, minRedeemPoints: 100 };
  const unknown = { pointValueIqd: null, minRedeemPoints: null };

  it('opens on the most points that fit what is left to pay', () => {
    expect(defaultRedeemPoints(1000, 12_340, known)).toBe(246);
    expect(defaultRedeemPoints(100, 12_340, known)).toBe(100);
  });

  it('opens on the whole balance when the value is unreadable, for the server to cap', () => {
    expect(defaultRedeemPoints(300, 1000, unknown)).toBe(300);
    expect(defaultRedeemPoints(0, 1000, known)).toBe(0);
  });

  it('says why the points cannot be used', () => {
    expect(redeemBlock(10, 0, 1000, known)).toBe('noBalance');
    expect(redeemBlock(100, 500, 0, known)).toBe('nothingDue');
    expect(redeemBlock(null, 500, 1000, known)).toBe('invalid');
    expect(redeemBlock(600, 500, 50_000, known)).toBe('overBalance');
    expect(redeemBlock(50, 500, 50_000, known)).toBe('belowMin');
    expect(redeemBlock(150, 500, 50_000, known)).toBeNull();
    expect(redeemBlock(50, 500, 50_000, unknown)).toBeNull();
  });

  it('prices the points, capped at what is left', () => {
    expect(redeemWorth(100, 50_000, known)).toBe(5000);
    expect(redeemWorth(100, 3000, known)).toBe(3000);
    expect(redeemWorth(100, 3000, unknown)).toBeNull();
  });
});

describe('numbers', () => {
  it('reads whole and signed numbers', () => {
    expect(parseWhole(' 120 ')).toBe(120);
    expect(parseWhole('1.5')).toBeNull();
    expect(parseWhole('-3')).toBeNull();
    expect(parseSigned('-50')).toBe(-50);
    expect(parseSigned('−50')).toBe(-50);
    expect(parseSigned('+5')).toBeNull();
    expect(parseMultiplier('1.25')).toBe(1.25);
    expect(parseMultiplier('٫5')).toBeNull();
    expect(parseMultiplier('6')).toBeNull();
    expect(parseMultiplier('0.5')).toBeNull();
  });

  it('asks for a non-zero delta and a reason before the PIN', () => {
    expect(adjustErrors({ delta: '0', reason: '' })).toEqual({
      delta: 'deltaRequired',
      reason: 'reasonRequired',
    });
    expect(adjustErrors({ delta: '-20', reason: 'Goodwill' })).toEqual({});
  });

  it('names an unknown ledger kind as an adjustment', () => {
    expect(ledgerKind('earn')).toBe('earn');
    expect(ledgerKind('something_new')).toBe('adjust');
  });
});

describe('Setup › Loyalty drafts', () => {
  const settings: LoyaltySettings = {
    enabled: false,
    iqd_per_point: 1000,
    point_value_iqd: 50,
    min_redeem_points: 100,
    earn_cafe: true,
    earn_shop: true,
    earn_court: false,
    earn_lesson: true,
    earn_tournament: true,
    inactivity_expiry_months: null,
    totp_step_seconds: 30,
    points_off_enabled: false,
  };

  it('round-trips the settings', () => {
    const d = settingsDraft(settings);
    expect(settingsErrors(d)).toEqual({});
    expect(settingsPatch(d)).toEqual(settings);
    const on = { ...settings, points_off_enabled: true };
    expect(settingsPatch(settingsDraft(on))).toEqual(on);
  });

  it('reads "Use points" as off when an older answer leaves it out (0403)', () => {
    const { points_off_enabled: _gone, ...older } = settings;
    expect(settingsDraft(older as LoyaltySettings).points_off_enabled).toBe(false);
  });

  it('keeps the expiry between 1 and 120 months, as the table does', () => {
    const at = (m: string) =>
      settingsErrors({ ...settingsDraft(settings), inactivity_expiry_months: m });
    expect(at('120')).toEqual({});
    expect(at('1')).toEqual({});
    expect(at('121')).toEqual({ inactivity_expiry_months: 'months' });
    expect(at('')).toEqual({});
  });

  it('refuses a zero point value, a QR step out of range and a zero expiry', () => {
    const d = {
      ...settingsDraft(settings),
      point_value_iqd: '0',
      totp_step_seconds: '10',
      inactivity_expiry_months: '0',
    };
    expect(settingsErrors(d)).toEqual({
      point_value_iqd: 'positive',
      totp_step_seconds: 'step',
      inactivity_expiry_months: 'months',
    });
  });

  const tiers: LoyaltyAdminTier[] = [
    {
      id: 't0',
      name_en: 'Member',
      name_ar: 'عضو',
      min_points_12m: 0,
      earn_multiplier: 1,
      promotion_id: null,
      sort: 0,
      color: 'classic',
    },
    {
      id: 't1',
      name_en: 'Gold',
      name_ar: 'ذهبي',
      min_points_12m: 500,
      earn_multiplier: 1.5,
      promotion_id: null,
      sort: 1,
      color: 'gold',
    },
  ];

  it('puts a new tier after the last and keeps the base tier', () => {
    const d = tierDraft(null, tiers);
    expect(d.sort).toBe(2);
    expect(tierErrors(d)).toEqual({ names: true, min_points_12m: true });
    expect(isBaseTier(tiers[0]!)).toBe(true);
    expect(isBaseTier(tiers[1]!)).toBe(false);
    expect(tierPayload({ ...tierDraft(tiers[1]!, tiers), earn_multiplier: '2' })).toEqual({
      id: 't1',
      name_en: 'Gold',
      name_ar: 'ذهبي',
      min_points_12m: 500,
      earn_multiplier: 2,
      promotion_id: null,
      sort: 1,
      color: 'gold',
    });
  });

  it('starts a new tier on the first of the club cards no tier has (0416)', () => {
    // The fixture's tiers are classic and gold, neither one of the four cards: white comes first.
    expect(tierDraft(null, tiers).color).toBe('white');
    expect(suggestTierColor([])).toBe('white');
    expect(suggestTierColor([{ color: 'white' }])).toBe('green');
    expect(suggestTierColor([{ color: 'white' }, { color: 'green' }])).toBe('blue');
    expect(suggestTierColor([{ color: 'white' }, { color: 'green' }, { color: 'blue' }])).toBe('black');
    expect(
      suggestTierColor((['white', 'green', 'blue', 'black'] as const).map((color) => ({ color }))),
    ).toBe('black');
  });

  it('asks a reward for what it gives and nulls the other kind', () => {
    const base: RewardDraft = {
      id: null,
      name_en: 'Free tea',
      name_ar: 'شاي مجاني',
      cost_points: '200',
      kind: 'item',
      iqd_off: '5000',
      menu_variant_id: null,
      active: true,
      venue_id: null,
    };
    expect(rewardErrors(base)).toEqual({ variant: true });
    const ok = { ...base, menu_variant_id: 'v1' };
    expect(rewardErrors(ok)).toEqual({});
    expect(rewardPayload(ok)).toMatchObject({
      kind: 'item',
      iqd_off: null,
      menu_variant_id: 'v1',
      cost_points: 200,
    });
    expect(rewardErrors({ ...base, kind: 'iqd_off', iqd_off: '' })).toEqual({ iqdOff: true });
  });

  it('asks a free court hour for nothing but a name and a cost, and sends no amount or item (0403)', () => {
    const court: RewardDraft = {
      id: null,
      name_en: 'Free court hour',
      name_ar: 'ساعة ملعب مجانية',
      cost_points: '800',
      kind: 'court_hour',
      iqd_off: '5000',
      menu_variant_id: 'v1',
      active: true,
      venue_id: null,
    };
    expect(rewardErrors(court)).toEqual({});
    expect(rewardPayload(court)).toMatchObject({
      kind: 'court_hour',
      iqd_off: null,
      menu_variant_id: null,
      cost_points: 800,
    });
  });

  it('offers the active rewards for every branch and this one', () => {
    const rows = [
      { id: 'a', active: true, venue_id: null },
      { id: 'b', active: false, venue_id: null },
      { id: 'c', active: true, venue_id: 'v1' },
      { id: 'd', active: true, venue_id: 'v2' },
    ];
    expect(rewardsHere(rows, 'v1').map((r) => r.id)).toEqual(['a', 'c']);
  });
});

describe('monthlyEarned', () => {
  const row = (created_at: string, delta: number, kind = 'earn') => ({ kind, delta, created_at });
  const now = Date.parse('2026-10-15T09:00:00Z');

  it('sums earned points per venue month for the last six months, oldest first', () => {
    const out = monthlyEarned(
      [row('2026-10-13T17:42:00Z', 260), row('2026-10-02T10:00:00Z', 90), row('2026-09-03T10:00:00Z', 410), row('2026-05-20T10:00:00Z', 320)],
      now,
      'Asia/Baghdad',
    );
    expect(out.map((m) => m.key)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(out.map((m) => m.total)).toEqual([320, 0, 0, 0, 410, 350]);
  });

  it('counts only earning, and only inside the window', () => {
    const out = monthlyEarned(
      [row('2026-10-05T10:00:00Z', -500, 'redeem'), row('2026-10-05T10:00:00Z', 200, 'adjust'), row('2026-03-01T10:00:00Z', 999)],
      now,
      'Asia/Baghdad',
    );
    expect(out.every((m) => m.total === 0)).toBe(true);
  });

  it('files a late-night earning in the venue month, not the UTC one', () => {
    // 22:30 UTC on 30 Sep is 01:30 on 1 Oct in Baghdad.
    const out = monthlyEarned([row('2026-09-30T22:30:00Z', 50)], now, 'Asia/Baghdad');
    expect(out.at(-1)).toEqual({ key: '2026-10', total: 50 });
  });
});

describe('rewards only (0403)', () => {
  const state = (over: Partial<CourtRewardState> = {}): CourtRewardState => ({
    tab_id: 't1',
    reservation_id: 'res1',
    plain_booking: true,
    value_iqd: 20_000,
    refused: null,
    reward: null,
    ...over,
  });
  const rows = [
    { id: 'tea', kind: 'item' as const },
    { id: 'off', kind: 'iqd_off' as const },
    { id: 'court', kind: 'court_hour' as const },
  ];

  it('offers "Use points" only when the owner turned it on', () => {
    expect(pointsOffOn({ pointsOffEnabled: true })).toBe(true);
    expect(pointsOffOn({ pointsOffEnabled: false })).toBe(false);
    expect(pointsOffOn({})).toBe(false);
    expect(pointsOffOn(null)).toBe(false);
  });

  it('lists a free court hour only where one fits the tab', () => {
    expect(rewardsForTab(rows, state()).map((r) => r.id)).toEqual(['tea', 'off', 'court']);
    expect(rewardsForTab(rows, null).map((r) => r.id)).toEqual(['tea', 'off']);
    for (const refused of [
      'REWARD_NEEDS_BOOKING',
      'COURT_DISCOUNT_NOT_ALLOWED',
      'REWARD_ALREADY_ON_BOOKING',
      'COURT_BILL_CLOSED',
      'NOTHING_OWED',
      'REWARD_EXCEEDS_BILL',
    ] as const) {
      expect(rewardsForTab(rows, state({ refused })).map((r) => r.id)).toEqual(['tea', 'off']);
    }
    expect(courtRewardFits(state({ plain_booking: false }))).toBe(false);
    expect(courtRewardFits(state({ value_iqd: 0 }))).toBe(false);
  });
});

// 0410: what the member's card gives on a bill (app.loyalty_tab_benefits, loyalty_perks_refresh).
describe("what the member's card gives on a bill (0410)", () => {
  const answer = {
    tab_id: 't1',
    customer_id: 'p1',
    enabled: true,
    tier: { id: 'g', name_en: 'Gold', name_ar: 'ذهبي', multiplier: 1.5, color: 'gold', min_points_12m: 1500 },
    perks: [
      { id: 'k1', kind: 'free_addons', name_en: 'Free add-ons', name_ar: 'إضافات مجانية', tier_id: 'g', tier_name_en: 'Gold', tier_name_ar: 'ذهبي', tier_color: 'gold' },
    ],
    addons: { on_bill_iqd: 500, due_iqd: 1500, needs_refresh: true },
    deal: { promotion_id: 'pr1', name_en: 'Happy hour', name_ar: 'ساعة السعادة', type: 'percent', value: 20, applied: false },
  };
  const read = (over: Record<string, unknown> = {}) => readTabBenefits({ ...answer, ...over }) as TabBenefits;

  it('reads the answer as it comes', () => {
    // An answer without 0445's lines reads with none.
    expect(readTabBenefits(answer)).toEqual({ ...answer, lines: [], court_gift: null });
  });

  it('reads a thin or odd answer without breaking: lists are lists, figures are numbers', () => {
    expect(readTabBenefits(null)).toBeNull();
    expect(readTabBenefits({})).toBeNull();
    expect(readTabBenefits({ tab_id: 't1' })).toEqual({
      tab_id: 't1',
      customer_id: null,
      enabled: false,
      tier: null,
      perks: [],
      addons: { on_bill_iqd: 0, due_iqd: 0, needs_refresh: false },
      lines: [],
      court_gift: null,
      deal: null,
    });
    expect(read({ addons: { on_bill_iqd: '500', due_iqd: null, needs_refresh: 'yes' } }).addons).toEqual({ on_bill_iqd: 500, due_iqd: 0, needs_refresh: false });
    expect(read({ deal: { name_en: 'No id' } }).deal).toBeNull();
  });

  it('a free add-on row is the server’s own: not a redemption, so it is never listed for Undo', () => {
    const rows = [
      { id: 'a1', kind: 'discount_amount', amount_iqd: 1500, reason_code: 'loyalty_tier_perk' },
      { id: 'a2', kind: 'discount_amount', amount_iqd: 1000, reason_code: 'loyalty_points' },
    ];
    expect(isTierPerkAdjustment(rows[0]!)).toBe(true);
    expect(isTierPerkAdjustment(rows[1]!)).toBe(false);
    expect(loyaltyAdjustments(rows).map((r) => r.id)).toEqual(['a2']);
    expect(loyaltyDiscountIqd(rows)).toBe(1000);
  });

  it('the refresh signature is the same for the same state and figures, and moves with either', () => {
    const base = perksRefreshSignature(read(), 'v1');
    expect(perksRefreshSignature(read(), 'v1')).toBe(base);
    expect(perksRefreshSignature(read(), 'v2')).not.toBe(base);
    expect(perksRefreshSignature(read({ customer_id: null }), 'v1')).not.toBe(base);
    expect(perksRefreshSignature(read({ addons: { on_bill_iqd: 1500, due_iqd: 1500, needs_refresh: false } }), 'v1')).not.toBe(base);
    expect(perksRefreshSignature(read({ tier: { ...answer.tier, id: 'p' } }), 'v1')).not.toBe(base);
    expect(perksRefreshSignature(read({ perks: [] }), 'v1')).not.toBe(base);
    // The deal is the promotion's business, not the add-ons'.
    expect(perksRefreshSignature(read({ deal: null }), 'v1')).toBe(base);
  });

  it('shows the card only with loyalty on, a customer, and a privilege or a picked deal', () => {
    expect(benefitsShown(read())).toBe(true);
    expect(benefitsShown(read({ perks: [] }))).toBe(true);
    expect(benefitsShown(read({ perks: [], deal: null }))).toBe(false);
    expect(benefitsShown(read({ enabled: false }))).toBe(false);
    expect(benefitsShown(read({ customer_id: null }))).toBe(false);
    expect(benefitsShown(null)).toBe(false);
  });
});

// 0410: Setup › Loyalty, what each card gives.
describe('a tier privilege in Setup › Loyalty (0410)', () => {
  const groups: AddonGroup[] = [
    { id: 'g-milk', name_en: 'Milk', name_ar: 'الحليب' },
    { id: 'g-syrup', name_en: 'Syrups', name_ar: 'السيروب' },
  ];
  const known = new Set(groups.map((g) => g.id));
  const perk: LoyaltyAdminPerk = {
    id: 'k1',
    tier_id: 't2',
    kind: 'free_addons',
    name_en: 'Free milk',
    name_ar: 'حليب مجاني',
    modifier_group_ids: ['g-milk'],
    active: true,
    sort: 3,
  };

  it('a new privilege starts as free add-ons on every add-on, named in both languages, on', () => {
    expect(perkDraft(null, 't2')).toEqual({
      id: null,
      tier_id: 't2',
      kind: 'free_addons',
      name_en: 'Free add-ons on every drink',
      name_ar: 'كل إضافات المشروبات مجانًا',
      autoName: true,
      scope: 'all',
      modifier_group_ids: [],
      giftWhen: 'birthday',
      giftTarget: 'items',
      giftCategoryIds: [],
      giftItemIds: [],
      giftDays: '7',
      sizeCategoryIds: [],
      sizeItemIds: [],
      triggerCategoryIds: [],
      triggerItemIds: [],
      freeCategoryIds: [],
      freeItemIds: [],
      frameId: 'card-green',
      stampSize: '',
      active: true,
      sort: null,
    });
  });

  it('an existing one keeps its names and reads its groups as "only some groups"', () => {
    expect(perkDraft(perk, 't2')).toMatchObject({ id: 'k1', scope: 'groups', modifier_group_ids: ['g-milk'], autoName: false, name_en: 'Free milk', sort: 3 });
    expect(perkDraft({ ...perk, modifier_group_ids: [] }, 't2').scope).toBe('all');
    expect(perkDraft({ ...perk, kind: 'custom', modifier_group_ids: [] }, 't2').kind).toBe('custom');
  });

  it('the default names follow the chosen groups until a name is typed', () => {
    expect(defaultPerkNames('groups', groups)).toEqual({ name_en: 'Free add-ons: Milk, Syrups', name_ar: 'إضافات مجانية: الحليب، السيروب' });
    expect(defaultPerkNames('groups', [])).toEqual({ name_en: 'Free add-ons', name_ar: 'إضافات مجانية' });
    // Too long for the 80 characters a name may have: the plain line instead.
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `g${i}`, name_en: `Add-on group ${i}`, name_ar: `مجموعة إضافات ${i}` }));
    expect(defaultPerkNames('groups', many).name_en).toBe('Free add-ons');
    const d = perkDraft(null, 't2');
    const picked = withAutoNames({ ...d, scope: 'groups', modifier_group_ids: ['g-syrup'] }, groups);
    expect(picked.name_en).toBe('Free add-ons: Syrups');
    // Something else: the owner names it; nothing is guessed.
    expect(withAutoNames({ ...picked, kind: 'custom' }, groups)).toMatchObject({ name_en: '', name_ar: '' });
    // A typed name is the owner's: it stays.
    expect(withAutoNames({ ...picked, autoName: false, name_en: 'Milk on us', scope: 'all' }, groups).name_en).toBe('Milk on us');
  });

  it('needs both names within 80 characters', () => {
    const d = perkDraft(perk, 't2');
    expect(perkErrors(d, known)).toEqual({});
    expect(perkErrors({ ...d, name_ar: '  ' }, known)).toEqual({ names: true });
    expect(perkErrors({ ...d, name_en: 'x'.repeat(PERK_NAME_MAX + 1) }, known)).toEqual({ names: true });
  });

  it('never saves "only some groups" with none left, which the server would read as every add-on', () => {
    const d = perkDraft(perk, 't2');
    expect(perkErrors({ ...d, modifier_group_ids: [] }, known)).toEqual({ groups: true });
    // The one group it named is gone from the menu.
    expect(perkErrors({ ...d, modifier_group_ids: ['g-gone'] }, known)).toEqual({ groups: true });
    // The menu was not read: nothing can be told apart, so the ids stand.
    expect(perkErrors({ ...d, modifier_group_ids: ['g-gone'] }, null)).toEqual({});
    expect(perkErrors({ ...d, scope: 'all', modifier_group_ids: [] }, known)).toEqual({});
    expect(perkErrors({ ...d, kind: 'custom', modifier_group_ids: [] }, known)).toEqual({});
  });

  it('builds the payload: trimmed names, groups only for "only some groups", a lost group left out', () => {
    const d = perkDraft(perk, 't2');
    expect(perkPayload({ ...d, name_en: ' Free milk ', modifier_group_ids: ['g-milk', 'g-gone'] }, known)).toEqual({
      id: 'k1',
      tier_id: 't2',
      kind: 'free_addons',
      name_en: 'Free milk',
      name_ar: 'حليب مجاني',
      modifier_group_ids: ['g-milk'],
      active: true,
      sort: 3,
    });
    expect(perkPayload({ ...d, scope: 'all' }, known).modifier_group_ids).toEqual([]);
    expect(perkPayload({ ...d, kind: 'custom' }, known).modifier_group_ids).toEqual([]);
    // A new one: no id, and no sort (the server puts it last).
    const fresh = perkPayload({ ...perkDraft(null, 't2'), active: false }, known);
    expect(fresh).not.toHaveProperty('id');
    expect(fresh).not.toHaveProperty('sort');
    expect(fresh).toMatchObject({ tier_id: 't2', kind: 'free_addons', modifier_group_ids: [], active: false });
    expect(liveGroupIds(['g-milk', 'g-gone'], null)).toEqual(['g-milk', 'g-gone']);
  });

  it('says what a privilege gives, and a group the menu has lost does not break it', () => {
    expect(perkGives({ kind: 'custom', modifier_group_ids: [] }, groups)).toEqual({ kind: 'custom' });
    expect(perkGives({ kind: 'free_addons', modifier_group_ids: [] }, groups)).toEqual({ kind: 'all' });
    expect(perkGives({ kind: 'free_addons', modifier_group_ids: ['g-syrup', 'g-gone'] }, groups)).toEqual({
      kind: 'groups',
      groups: [groups[1]],
      missing: 1,
      count: 2,
    });
    // The menu unread: only the count is known.
    expect(perkGives({ kind: 'free_addons', modifier_group_ids: ['g-syrup', 'g-gone'] }, null)).toEqual({ kind: 'groups', groups: [], missing: 0, count: 2 });
    // An answer with no list at all.
    expect(perkGives({ kind: 'free_addons' } as unknown as LoyaltyAdminPerk, groups)).toEqual({ kind: 'all' });
  });

  it('lists a tier’s privileges in order, and knows a server that sends none', () => {
    expect(sortedPerks([{ ...perk, id: 'b', sort: 2 }, { ...perk, id: 'a', sort: 0 }]).map((p) => p.id)).toEqual(['a', 'b']);
    expect(sortedPerks(undefined)).toEqual([]);
    expect(perksSupported([{ perks: [] }, { perks: [perk] }])).toBe(true);
    expect(perksSupported([{}, {}])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 0445: card gifts, free-with, the drink card and rings
// ---------------------------------------------------------------------------

describe('the 0445 privileges in Setup › Loyalty', () => {
  const menu: MenuNames = {
    categories: [
      { id: 'c-hot', name_en: 'Hot drinks', name_ar: 'مشروبات ساخنة' },
      { id: 'c-sweet', name_en: 'Desserts', name_ar: 'حلويات' },
    ],
    items: [
      { id: 'i-tea', name_en: 'Tea', name_ar: 'شاي' },
      { id: 'i-cake', name_en: 'Cheesecake', name_ar: 'تشيز كيك' },
    ],
  };
  const known = menuKnown(menu);
  const base = (kind: PerkDraft['kind'], over: Partial<PerkDraft> = {}): PerkDraft => ({ ...perkDraft(null, 't2'), kind, ...over });
  const admin = (kind: LoyaltyAdminPerk['kind'], config: Record<string, unknown>): LoyaltyAdminPerk => ({
    id: 'k9',
    tier_id: 't2',
    kind,
    name_en: 'N',
    name_ar: 'ن',
    modifier_group_ids: [],
    config: config as LoyaltyAdminPerk['config'],
    active: true,
    sort: 1,
  });

  it('reads each kind’s config into the draft, and anything odd safely', () => {
    expect(perkDraft(admin('gift', { when: 'birthday', categoryIds: ['c-hot'], itemIds: ['i-cake'], days: 10 }), 't2')).toMatchObject({
      kind: 'gift',
      giftCategoryIds: ['c-hot'],
      giftItemIds: ['i-cake'],
      giftDays: '10',
    });
    expect(perkDraft(admin('gift', {}), 't2').giftDays).toBe('7');
    expect(perkDraft(admin('free_with', { triggerCategoryIds: ['c-sweet'], freeItemIds: ['i-tea', 5] }), 't2')).toMatchObject({
      triggerCategoryIds: ['c-sweet'],
      triggerItemIds: [],
      freeCategoryIds: [],
      freeItemIds: ['i-tea'],
    });
    expect(perkDraft(admin('frame', { frameId: 'card-black' }), 't2').frameId).toBe('card-black');
    expect(perkDraft(admin('frame', { frameId: 'gold' }), 't2').frameId).toBe('card-green');
    expect(perkDraft(admin('stamp_size', { size: 6 }), 't2').stampSize).toBe('6');
    expect(frameIdOf(undefined)).toBe('card-green');
    expect(frameWord('card-blue')).toBe('blue');
  });

  it('suggests names per kind in both languages, falling back to a plain line', () => {
    expect(defaultNamesFor(base('gift', { giftCategoryIds: ['c-hot'] }), [], menu)).toEqual({
      name_en: 'Birthday gift: Hot drinks',
      name_ar: 'هدية عيد الميلاد: مشروبات ساخنة',
    });
    // The menu unread: the plain line.
    expect(defaultNamesFor(base('gift', { giftCategoryIds: ['c-hot'] }), [], null).name_en).toBe('Birthday gift');
    expect(defaultNamesFor(base('free_with', { triggerCategoryIds: ['c-sweet'], freeItemIds: ['i-tea'] }), [], menu)).toEqual({
      name_en: 'Free Tea with Desserts',
      name_ar: 'شاي مجانًا مع حلويات',
    });
    expect(defaultNamesFor(base('free_with', { triggerCategoryIds: ['c-sweet'] }), [], menu).name_en).toBe('Free with an order');
    expect(defaultNamesFor(base('frame', { frameId: 'card-black' }), [], menu)).toEqual({
      name_en: 'Black card photo frame',
      name_ar: 'إطار صورة البطاقة السوداء',
    });
    expect(defaultNamesFor(base('stamp_size', { stampSize: '6' }), [], menu).name_en).toBe('Drink card full at 6 stamps');
    expect(defaultNamesFor(base('stamp_size'), [], menu).name_en).toBe('A faster drink card');
    expect(defaultNamesFor(base('custom'), [], menu)).toEqual({ name_en: '', name_ar: '' });
    // Too long for 80 characters: the plain line.
    const long: MenuNames = { categories: Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, name_en: `Section number ${i}`, name_ar: `القسم ${i}` })), items: [] };
    expect(defaultNamesFor(base('gift', { giftCategoryIds: long.categories.map((c) => c.id) }), [], long).name_en).toBe('Birthday gift');
    // withAutoNames follows a kind change, and leaves a typed name alone.
    const d = withAutoNames(base('gift', { giftItemIds: ['i-cake'] }), [], menu);
    expect(d.name_en).toBe('Birthday gift: Cheesecake');
    expect(withAutoNames({ ...d, autoName: false, name_en: 'Cake day', kind: 'frame' }, [], menu).name_en).toBe('Cake day');
  });

  it('refuses what the server refuses, per kind', () => {
    const named = { name_en: 'X', name_ar: 'س' };
    expect(perkErrors(base('gift', named), null, known)).toEqual({ giftItems: true });
    expect(perkErrors(base('gift', { ...named, giftItemIds: ['i-cake'], giftDays: '0' }), null, known)).toEqual({ days: true });
    expect(perkErrors(base('gift', { ...named, giftItemIds: ['i-cake'], giftDays: '32' }), null, known)).toEqual({ days: true });
    expect(perkErrors(base('gift', { ...named, giftItemIds: ['i-cake'], giftDays: '31' }), null, known)).toEqual({});
    // Every chosen item gone from the menu counts as none; unread, the ids stand.
    expect(perkErrors(base('gift', { ...named, giftItemIds: ['i-gone'] }), null, known)).toEqual({ giftItems: true });
    expect(perkErrors(base('gift', { ...named, giftItemIds: ['i-gone'] }), null, null)).toEqual({});
    expect(perkErrors(base('free_with', named), null, known)).toEqual({ trigger: true, free: true });
    expect(perkErrors(base('free_with', { ...named, triggerCategoryIds: ['c-sweet'], freeItemIds: ['i-tea'] }), null, known)).toEqual({});
    expect(perkErrors(base('stamp_size', { ...named, stampSize: '1' }), null, known)).toEqual({ size: true });
    expect(perkErrors(base('stamp_size', { ...named, stampSize: '21' }), null, known)).toEqual({ size: true });
    expect(perkErrors(base('stamp_size', { ...named, stampSize: '6' }), null, known)).toEqual({});
    expect(perkErrors(base('frame', named), null, known)).toEqual({});
  });

  it('sends a config for the 0445 kinds only, without ids the menu lost', () => {
    const named = { name_en: 'X', name_ar: 'س' };
    expect(perkPayload(base('gift', { ...named, giftCategoryIds: ['c-hot', 'c-gone'], giftDays: '5' }), null, known)).toMatchObject({
      kind: 'gift',
      modifier_group_ids: [],
      config: { when: 'birthday', categoryIds: ['c-hot'], itemIds: [], days: 5 },
    });
    expect(perkPayload(base('free_with', { ...named, triggerItemIds: ['i-cake'], freeCategoryIds: ['c-hot'] }), null, known).config).toEqual({
      triggerCategoryIds: [],
      triggerItemIds: ['i-cake'],
      freeCategoryIds: ['c-hot'],
      freeItemIds: [],
    });
    expect(perkPayload(base('frame', { ...named, frameId: 'card-blue' }), null, known).config).toEqual({ frameId: 'card-blue' });
    expect(perkPayload(base('stamp_size', { ...named, stampSize: '6' }), null, known).config).toEqual({ size: 6 });
    expect(perkPayload(base('free_addons', named), null, known)).not.toHaveProperty('config');
    expect(perkPayload(base('custom', named), null, known)).not.toHaveProperty('config');
  });

  it('says what each kind gives, counting what the menu lost', () => {
    expect(perkGives(admin('gift', { categoryIds: ['c-hot'], itemIds: ['i-gone'], days: 7 }), null, menu)).toEqual({
      kind: 'gift',
      when: 'birthday',
      target: 'items',
      what: { named: [menu.categories[0]], missing: 1, count: 2 },
      days: 7,
    });
    // The menu unread: only counts.
    expect(perkGives(admin('gift', { categoryIds: ['c-hot'], days: 3 }), null, null)).toEqual({
      kind: 'gift',
      when: 'birthday',
      target: 'items',
      what: { named: [], missing: 0, count: 1 },
      days: 3,
    });
    // Monthly has no days; a court hour names no menu (nothing it can lose).
    expect(perkGives(admin('gift', { when: 'monthly', target: 'court_hour', days: 9 }), null, menu)).toEqual({
      kind: 'gift',
      when: 'monthly',
      target: 'court_hour',
      what: { named: [], missing: 0, count: 0 },
      days: null,
    });
    expect(perkGives(admin('gift', { when: 'card_up', target: 'items', itemIds: ['i-tea'] }), null, menu)).toMatchObject({ when: 'card_up', days: 30 });
    const su = perkGives(admin('size_upgrade', { categoryIds: ['c-hot'], itemIds: ['i-gone'] }), null, menu);
    expect(su).toEqual({ kind: 'size_upgrade', what: { named: [menu.categories[0]], missing: 1, count: 2 } });
    expect(perkMissing(su)).toBe(1);
    const fw = perkGives(admin('free_with', { triggerCategoryIds: ['c-sweet'], freeItemIds: ['i-tea'] }), null, menu);
    expect(fw).toMatchObject({ kind: 'free_with', trigger: { named: [menu.categories[1]] }, free: { named: [menu.items[0]] } });
    expect(perkMissing(fw)).toBe(0);
    expect(perkGives(admin('frame', { frameId: 'card-blue' }), null, menu)).toEqual({ kind: 'frame', frameId: 'card-blue' });
    expect(perkGives(admin('stamp_size', { size: 6 }), null, menu)).toEqual({ kind: 'stamp_size', size: 6 });
    expect(perkMissing(perkGives(admin('gift', { itemIds: ['i-gone'] }), null, menu))).toBe(1);
  });

  it('names the cards whose privilege fills the drink card sooner (the lowest wins up the ladder)', () => {
    const tiers = [
      { id: 'w', sort: 0, name_en: 'White', name_ar: 'أبيض', perks: [] },
      { id: 'g', sort: 1, name_en: 'Green', name_ar: 'أخضر', perks: [] },
      { id: 'b', sort: 2, name_en: 'Blue', name_ar: 'أزرق', perks: [admin('stamp_size', { size: 6 })] },
      { id: 'k', sort: 3, name_en: 'Black', name_ar: 'أسود', perks: [{ ...admin('stamp_size', { size: 4 }), active: false }] },
    ];
    expect(stampSizesByCard(tiers, 8).map((x) => [x.tier.id, x.size])).toEqual([
      ['b', 6],
      ['k', 6],
    ]);
    // A standard already at or below the privilege: nothing to name.
    expect(stampSizesByCard(tiers, 5)).toEqual([]);
  });
});

describe('the drink card settings (0445)', () => {
  const menu = menuKnown({ categories: [{ id: 'c-hot', name_en: 'Hot', name_ar: 'ساخن' }], items: [{ id: 'i-water', name_en: 'Water', name_ar: 'ماء' }] });

  it('reads the settings safely, and nothing that is not an answer', () => {
    expect(readStampCard(null)).toBeNull();
    expect(readStampCard({ id: 'new' })).toBeNull();
    expect(readStampCard({ enabled: true, size: 6, category_ids: ['c-hot'], excluded_item_ids: null })).toEqual({
      enabled: true,
      size: 6,
      category_ids: ['c-hot'],
      excluded_item_ids: [],
      updated_at: null,
    });
    expect(readStampCard({ enabled: false, size: 99 })!.size).toBe(8);
  });

  it('checks the size and a card that is on with nothing to stamp', () => {
    const d = stampCardDraft({ enabled: true, size: 8, category_ids: ['c-hot'], excluded_item_ids: [] });
    expect(stampCardErrors(d, menu)).toEqual({});
    expect(stampCardErrors({ ...d, size: '1' }, menu)).toEqual({ size: true });
    expect(stampCardErrors({ ...d, size: '21' }, menu)).toEqual({ size: true });
    expect(stampCardErrors({ ...d, category_ids: [] }, menu)).toEqual({ categories: true });
    expect(stampCardErrors({ ...d, category_ids: ['c-gone'] }, menu)).toEqual({ categories: true });
    // Off: no section needed.
    expect(stampCardErrors({ ...d, enabled: false, category_ids: [] }, menu)).toEqual({});
  });

  it('sends the card without ids the menu lost', () => {
    const d = stampCardDraft({ enabled: true, size: 8, category_ids: ['c-hot', 'c-gone'], excluded_item_ids: ['i-water', 'i-gone'] });
    expect(stampCardPayload({ ...d, size: '6' }, menu)).toEqual({ enabled: true, size: 6, category_ids: ['c-hot'], excluded_item_ids: ['i-water'] });
  });

  it('offers to exclude the stamping sections’ items, and any item already excluded', () => {
    const items = [
      { id: 'a', category_id: 'c-hot' },
      { id: 'b', category_id: 'c-sweet' },
      { id: 'c', category_id: 'c-sweet' },
    ];
    expect(excludableItems(items, { category_ids: ['c-hot'], excluded_item_ids: ['c'] }).map((i) => i.id)).toEqual(['a', 'c']);
  });
});

describe('why a bill line is free, and the member’s drink card (0445)', () => {
  const lines = [
    { order_item_id: 'oi1', kind: 'gift', perk_id: 'g1', units: 1, amount_iqd: 4000 },
    { order_item_id: 'oi1', kind: 'free_addons', perk_id: 'a1', units: 0, amount_iqd: 500 },
    { order_item_id: 'oi2', kind: 'stamp', perk_id: null, units: 1, amount_iqd: 3000 },
    { order_item_id: 'oi3', kind: 'free_with', perk_id: 'w1', units: 2, amount_iqd: 2000 },
  ];
  const perks = [
    { id: 'g1', name_en: 'Birthday drink', name_ar: 'مشروب الميلاد' },
    { id: 'w1', name_en: 'Free Tea with Desserts', name_ar: 'شاي مجانًا مع حلويات' },
  ];
  const extras = (over: { stamps?: Partial<CardExtras['stamps']>; gifts?: CardExtras['birthday']['gifts'] } = {}): CardExtras => ({
    stamps: { enabled: true, count: 5, size: 8, ready: false, held: false, ...over.stamps },
    birthday: { has_date: true, gifts: over.gifts ?? [], counts_from: null, gifts_on_card: [] },
  });

  it('reads the lines safely: unknown kinds, no amount and odd figures are dropped or fixed', () => {
    expect(readPerkLines(undefined)).toEqual([]);
    expect(
      readPerkLines([
        ...lines,
        { order_item_id: 'oi9', kind: 'mystery', amount_iqd: 100 },
        { order_item_id: 'oi9', kind: 'gift', amount_iqd: 0 },
        { kind: 'gift', amount_iqd: 100 },
        { order_item_id: 'oi8', kind: 'stamp', perk_id: 4, units: '2', amount_iqd: '1500' },
      ]),
    ).toEqual([...lines, { order_item_id: 'oi8', kind: 'stamp', perk_id: null, units: 2, amount_iqd: 1500 }]);
    expect(readTabBenefits({ tab_id: 't', lines })!.lines).toEqual(lines);
  });

  it('gives each line its reasons in the engine’s order, merged by reason, with the privilege’s names', () => {
    const read = readPerkLines(lines);
    expect(lineReasons('oi1', read, perks)).toEqual([
      { kind: 'gift', perk: { name_en: 'Birthday drink', name_ar: 'مشروب الميلاد' }, when: 'birthday', units: 1, amount_iqd: 4000 },
      { kind: 'free_addons', perk: null, when: null, units: 0, amount_iqd: 500 },
    ]);
    expect(lineReasons('oi3', [...read, { ...read[3]!, units: 1, amount_iqd: 1000 }], perks)).toEqual([
      { kind: 'free_with', perk: { name_en: 'Free Tea with Desserts', name_ar: 'شاي مجانًا مع حلويات' }, when: null, units: 3, amount_iqd: 3000 },
    ]);
    expect(lineReasons('oi-none', read, perks)).toEqual([]);
    expect(lineReasons('oi1', undefined, perks)).toEqual([]);
  });

  it('sums the bill’s free lines by reason for the member block', () => {
    expect(perkLineTotals(readPerkLines(lines))).toEqual([
      { kind: 'stamp', when: null, units: 1, amount_iqd: 3000 },
      { kind: 'gift', when: null, units: 1, amount_iqd: 4000 },
      { kind: 'free_with', when: null, units: 2, amount_iqd: 2000 },
      { kind: 'free_addons', when: null, units: 0, amount_iqd: 500 },
    ]);
    // Gifts told apart by when, read off the privilege; a size upgrade sits before the add-ons.
    const two = readPerkLines([
      { order_item_id: 'a', kind: 'size_upgrade', perk_id: 'su', units: 1, amount_iqd: 750 },
      { order_item_id: 'b', kind: 'gift', perk_id: 'gm', units: 1, amount_iqd: 3000 },
      { order_item_id: 'c', kind: 'gift', perk_id: 'gb', units: 1, amount_iqd: 4000 },
      { order_item_id: 'd', kind: 'free_addons', perk_id: null, units: 0, amount_iqd: 250 },
    ]);
    const gp = [
      { id: 'gm', kind: 'gift', config: { when: 'monthly', target: 'items' } },
      { id: 'gb', kind: 'gift', config: { when: 'birthday', target: 'items' } },
    ];
    expect(perkLineTotals(two, gp).map((x) => [x.kind, x.when])).toEqual([
      ['gift', 'birthday'],
      ['gift', 'monthly'],
      ['size_upgrade', null],
      ['free_addons', null],
    ]);
    expect(perkLineTotals(undefined)).toEqual([]);
  });

  it('a ring and a drink card size are not listed on a bill; custom is given by hand', () => {
    expect(billPerks([{ kind: 'gift' }, { kind: 'frame' }, { kind: 'stamp_size' }, { kind: 'custom' }]).map((p) => p.kind)).toEqual(['gift', 'custom']);
    expect(perkHandling('custom')).toBe('hand');
    expect(perkHandling('free_with')).toBe('till');
  });

  it('shows the card for any member while loyalty is on', () => {
    const b = readTabBenefits({ tab_id: 't', customer_id: 'p', enabled: true, perks: [] })!;
    expect(memberCardShown(b)).toBe(true);
    expect(memberCardShown({ ...b, enabled: false })).toBe(false);
    expect(memberCardShown({ ...b, customer_id: null })).toBe(false);
    expect(memberCardShown(null)).toBe(false);
  });

  it('reads the drink card state at a glance', () => {
    expect(stampState(null, [])).toBe('off');
    expect(stampState(extras({ stamps: { enabled: false } }), [])).toBe('off');
    expect(stampState(extras(), [])).toBe('filling');
    expect(stampState(extras({ stamps: { count: 8, ready: true } }), [])).toBe('ready');
    expect(stampState(extras({ stamps: { count: 8, ready: true, held: true } }), [])).toBe('heldElsewhere');
    // This bill carries the free drink: that wins over held (it is this bill that holds it).
    expect(stampState(extras({ stamps: { count: 8, ready: true, held: true } }), readPerkLines(lines))).toBe('onThisBill');
  });

  it('reads the card gifts open now in the four states the desk tells the guest', () => {
    const g = (perk_id: string, eligible: boolean, used: boolean) => ({ perk_id, name_en: perk_id, name_ar: perk_id, target: 'items' as const, window_from: null, window_to: null, eligible, used });
    const out = giftsToday(extras({ gifts: [g('g1', true, true), g('g2', true, false), g('g3', true, true), g('g4', false, false)] }), readPerkLines(lines));
    expect(out.map((x) => [x.perk_id, x.when, x.state])).toEqual([
      ['g1', 'birthday', 'onThisBill'],
      ['g2', 'birthday', 'open'],
      ['g3', 'birthday', 'used'],
      ['g4', 'birthday', 'tooRecent'],
    ]);
    expect(giftsToday(null, [])).toEqual([]);
  });

  it('lists the monthly and card-up gifts after the birthday ones; a court hour on this bill’s booking counts as on this bill', () => {
    const e: CardExtras = {
      ...extras(),
      gifts: [
        { perk_id: 'up1', name_en: 'Welcome', name_ar: 'ترحيب', when: 'card_up', target: 'items', window_to: '2026-12-14', used: false },
        { perk_id: 'm1', name_en: 'Monthly hour', name_ar: 'ساعة الشهر', when: 'monthly', target: 'court_hour', window_to: '2026-11-30', used: false },
        { perk_id: 'm2', name_en: 'Monthly coffee', name_ar: 'قهوة الشهر', when: 'monthly', target: 'items', window_to: '2026-11-30', used: true },
      ],
    };
    const out = giftsToday(e, [], { perk_id: 'm1', name_en: 'Monthly hour', name_ar: 'ساعة الشهر', amount_iqd: 20000 });
    expect(out.map((x) => [x.perk_id, x.when, x.target, x.state])).toEqual([
      ['m1', 'monthly', 'court_hour', 'onThisBill'],
      ['m2', 'monthly', 'items', 'used'],
      ['up1', 'card_up', 'items', 'open'],
    ]);
    expect(extrasShown({ ...extras({ stamps: { enabled: false } }), gifts: e.gifts })).toBe(true);
  });

  it('reads the extras safely, and knows when they have nothing to show', () => {
    expect(readCardExtras(undefined)).toBeNull();
    expect(readCardExtras({ stamps: {} })).toBeNull();
    const r = readCardExtras({
      stamps: { enabled: true, count: '3', size: 6, ready: false, held: false },
      birthday: { has_date: true, gifts: [{ perk_id: 'g1', name_en: 'Drink', name_ar: 'مشروب', eligible: true, used: false }, { name_en: 'no id' }], gifts_on_card: [{ perk_id: 'g1', name_en: 'Drink', name_ar: 'مشروب' }] },
    })!;
    expect(r.stamps).toEqual({ enabled: true, count: 3, size: 6, ready: false, held: false, claimed_until: null });
    expect(r.birthday.gifts).toEqual([{ perk_id: 'g1', name_en: 'Drink', name_ar: 'مشروب', target: 'items', window_from: null, window_to: null, eligible: true, used: false, claimed_until: null }]);
    expect(r.gifts).toEqual([]);
    const withOthers = readCardExtras({
      stamps: { enabled: false },
      birthday: { has_date: false, gifts: [] },
      gifts: [
        { perk_id: 'm1', name_en: 'Monthly', name_ar: 'شهري', when: 'monthly', target: 'court_hour', window_to: '2026-11-30', used: false },
        { perk_id: 'x', when: 'birthday' },
      ],
    })!;
    expect(withOthers.gifts).toEqual([{ perk_id: 'm1', name_en: 'Monthly', name_ar: 'شهري', when: 'monthly', target: 'court_hour', window_to: '2026-11-30', used: false, claimed_until: null }]);
    expect(readCourtGift({ perk_id: 'm1', name_en: 'Monthly', name_ar: 'شهري', amount_iqd: '20000' })).toEqual({ perk_id: 'm1', name_en: 'Monthly', name_ar: 'شهري', amount_iqd: 20000 });
    expect(readCourtGift({ amount_iqd: 0 })).toBeNull();
    expect(readTabBenefits({ tab_id: 't', court_gift: { perk_id: 'm1', amount_iqd: 5000 } })!.court_gift).toEqual({ perk_id: 'm1', name_en: null, name_ar: null, amount_iqd: 5000 });
    expect(r.birthday.gifts_on_card[0]!.days).toBe(7);
    expect(extrasShown(r)).toBe(true);
    expect(extrasShown(extras({ stamps: { enabled: false } }))).toBe(false);
    expect(extrasShown(null)).toBe(false);
  });
});

describe('Redeem in the app, and a buy-one-get-one deal (0445, section 8)', () => {
  it('reads when a claim on the free drink and on each gift ends, and anything else as no claim', () => {
    const until = '2026-11-22T09:30:00Z';
    const r = readCardExtras({
      stamps: { enabled: true, count: 6, size: 6, ready: true, held: false, claimed_until: until },
      birthday: { has_date: true, gifts: [{ perk_id: 'g1', eligible: true, used: false, claimed_until: 'not a date' }] },
      gifts: [{ perk_id: 'm1', when: 'monthly', target: 'items', window_to: '2026-11-30', used: false, claimed_until: until }],
    })!;
    expect(r.stamps.claimed_until).toBe(until);
    expect(r.birthday.gifts[0]!.claimed_until).toBeNull();
    expect(r.gifts![0]!.claimed_until).toBe(until);
    expect(giftsToday(r, []).map((g) => [g.perk_id, g.state, g.claimed_until])).toEqual([
      ['g1', 'open', null],
      ['m1', 'open', until],
    ]);
    expect(rewardClaim(until)).toEqual({ kind: 'claimed', until });
    expect(rewardClaim(null)).toEqual({ kind: 'waiting' });
    expect(rewardClaim(undefined)).toEqual({ kind: 'waiting' });
  });

  it('keeps a picked buy-one-get-one deal as free_item, never as a percent', () => {
    const deal = (type: string) => readTabBenefits({ tab_id: 't', deal: { promotion_id: 'p', name_en: 'BOGO', name_ar: 'ع', type, value: 100, applied: false } })!.deal!;
    expect(deal('free_item').type).toBe('free_item');
    expect(deal('amount').type).toBe('amount');
    expect(deal('percent').type).toBe('percent');
    expect(deal('something').type).toBe('percent');
  });
});

describe('gifts by when and target, and the free size upgrade (0445, second pass)', () => {
  const menu: MenuNames = {
    categories: [{ id: 'c-hot', name_en: 'Hot drinks', name_ar: 'مشروبات ساخنة' }],
    items: [{ id: 'i-cake', name_en: 'Cheesecake', name_ar: 'تشيز كيك' }],
  };
  const known = menuKnown(menu);
  const named = { name_en: 'X', name_ar: 'س' };
  const gift = (over: Partial<PerkDraft> = {}): PerkDraft => ({ ...perkDraft(null, 't2'), kind: 'gift', ...over });

  it('moves the days to the new when’s default, and keeps them when the when is unchanged', () => {
    const d = gift({ giftDays: '12' });
    expect(withGiftWhen(d, 'card_up')).toEqual({ giftWhen: 'card_up', giftDays: '30' });
    expect(withGiftWhen(d, 'monthly')).toEqual({ giftWhen: 'monthly' });
    expect(withGiftWhen({ ...d, giftWhen: 'card_up' }, 'birthday')).toEqual({ giftWhen: 'birthday', giftDays: '7' });
    expect(withGiftWhen(d, 'birthday')).toEqual({});
  });

  it('reads when and target into the draft, with each when’s default days', () => {
    const admin = (config: Record<string, unknown>): LoyaltyAdminPerk => ({
      id: 'k',
      tier_id: 't2',
      kind: 'gift',
      name_en: 'N',
      name_ar: 'ن',
      modifier_group_ids: [],
      config: config as LoyaltyAdminPerk['config'],
      active: true,
      sort: 0,
    });
    expect(perkDraft(admin({ when: 'card_up', target: 'court_hour' }), 't2')).toMatchObject({ giftWhen: 'card_up', giftTarget: 'court_hour', giftDays: '30' });
    expect(perkDraft(admin({ when: 'monthly', target: 'items', itemIds: ['i-cake'] }), 't2')).toMatchObject({ giftWhen: 'monthly', giftItemIds: ['i-cake'] });
    // Absent or odd: birthday and items, as the server defaults them.
    expect(perkDraft(admin({ when: 'weekly', target: 'spa' }), 't2')).toMatchObject({ giftWhen: 'birthday', giftTarget: 'items', giftDays: '7' });
  });

  it('checks days per when, and asks for menu items only for a menu-item gift', () => {
    expect(perkErrors(gift({ ...named, giftWhen: 'card_up', giftDays: '90', giftItemIds: ['i-cake'] }), null, known)).toEqual({});
    expect(perkErrors(gift({ ...named, giftWhen: 'card_up', giftDays: '91', giftItemIds: ['i-cake'] }), null, known)).toEqual({ days: true });
    expect(perkErrors(gift({ ...named, giftWhen: 'birthday', giftDays: '45', giftItemIds: ['i-cake'] }), null, known)).toEqual({ days: true });
    // Monthly: the calendar month, so days do not count.
    expect(perkErrors(gift({ ...named, giftWhen: 'monthly', giftDays: '', giftItemIds: ['i-cake'] }), null, known)).toEqual({});
    // A court hour needs no menu.
    expect(perkErrors(gift({ ...named, giftTarget: 'court_hour' }), null, known)).toEqual({});
    expect(perkErrors(gift({ ...named, giftTarget: 'items' }), null, known)).toEqual({ giftItems: true });
  });

  it('builds the gift config: no menu for a court hour, no days for monthly', () => {
    expect(perkPayload(gift({ ...named, giftWhen: 'monthly', giftTarget: 'court_hour', giftItemIds: ['i-cake'] }), null, known).config).toEqual({
      when: 'monthly',
      target: 'court_hour',
      categoryIds: [],
      itemIds: [],
    });
    expect(perkPayload(gift({ ...named, giftWhen: 'card_up', giftDays: '45', giftCategoryIds: ['c-hot'] }), null, known).config).toEqual({
      when: 'card_up',
      target: 'items',
      categoryIds: ['c-hot'],
      itemIds: [],
      days: 45,
    });
  });

  it('names a gift by when and target in both languages', () => {
    expect(defaultNamesFor(gift({ giftWhen: 'monthly', giftItemIds: ['i-cake'] }), [], menu)).toEqual({ name_en: 'Monthly gift: Cheesecake', name_ar: 'هدية الشهر: تشيز كيك' });
    expect(defaultNamesFor(gift({ giftWhen: 'card_up', giftCategoryIds: ['c-hot'] }), [], menu).name_en).toBe('Welcome gift: Hot drinks');
    expect(defaultNamesFor(gift({ giftWhen: 'card_up' }), [], menu).name_en).toBe('Welcome gift');
    expect(defaultNamesFor(gift({ giftTarget: 'court_hour' }), [], menu)).toEqual({ name_en: 'Birthday gift: a free court hour', name_ar: 'هدية عيد الميلاد: ساعة ملعب مجانية' });
    expect(defaultNamesFor(gift({ giftWhen: 'monthly', giftTarget: 'court_hour' }), [], menu).name_en).toBe('A free court hour every month');
  });

  it('a free size upgrade needs a section or item, names it, and sends its config', () => {
    const d: PerkDraft = { ...perkDraft(null, 't2'), kind: 'size_upgrade', ...named };
    expect(perkErrors(d, null, known)).toEqual({ sizeItems: true });
    expect(perkErrors({ ...d, sizeCategoryIds: ['c-gone'] }, null, known)).toEqual({ sizeItems: true });
    expect(perkErrors({ ...d, sizeCategoryIds: ['c-hot'] }, null, known)).toEqual({});
    expect(perkPayload({ ...d, sizeCategoryIds: ['c-hot', 'c-gone'], sizeItemIds: ['i-cake'] }, null, known).config).toEqual({ categoryIds: ['c-hot'], itemIds: ['i-cake'] });
    expect(defaultNamesFor({ ...d, sizeCategoryIds: ['c-hot'] }, [], menu)).toEqual({ name_en: 'Free size upgrade: Hot drinks', name_ar: 'ترقية الحجم مجانًا: مشروبات ساخنة' });
    expect(defaultNamesFor(d, [], menu).name_en).toBe('Free size upgrade');
    expect(
      perkDraft({ id: 'k', tier_id: 't2', kind: 'size_upgrade', name_en: 'N', name_ar: 'ن', modifier_group_ids: [], config: { categoryIds: ['c-hot'], itemIds: [] }, active: true, sort: 0 }, 't2'),
    ).toMatchObject({ kind: 'size_upgrade', sizeCategoryIds: ['c-hot'], sizeItemIds: [] });
  });

  it('a size upgrade line is read and explained, and a gift reason carries its when', () => {
    const l = readPerkLines([{ order_item_id: 'a', kind: 'size_upgrade', perk_id: 'su', units: 1, amount_iqd: 750 }]);
    expect(l).toHaveLength(1);
    const r = lineReasons('a', l, [{ id: 'su', kind: 'size_upgrade', name_en: 'Upgrade', name_ar: 'ترقية' }]);
    expect(r).toEqual([{ kind: 'size_upgrade', perk: { name_en: 'Upgrade', name_ar: 'ترقية' }, when: null, units: 1, amount_iqd: 750 }]);
    const g = lineReasons('b', readPerkLines([{ order_item_id: 'b', kind: 'gift', perk_id: 'gm', units: 1, amount_iqd: 3000 }]), [
      { id: 'gm', kind: 'gift', name_en: 'Monthly', name_ar: 'شهري', config: { when: 'monthly', target: 'items' } },
    ]);
    expect(g[0]!.when).toBe('monthly');
  });
});

describe('codes from the guest’s app (0415, 0445)', () => {
  it('tells a reward code from a deal code, in any case and with or without dashes', () => {
    expect(parseAppCode('TPV-8F3K2QXM9ABC')).toEqual({ kind: 'reward', code: 'TPV-8F3K2QXM9ABC' });
    expect(parseAppCode(' tpd-8f3k-2qxm-9abc ')).toEqual({ kind: 'deal', code: 'TPD-8F3K2QXM9ABC' });
    expect(parseAppCode('TPD8F3K2QXM9ABC')).toEqual({ kind: 'deal', code: 'TPD-8F3K2QXM9ABC' });
  });

  it('answers null for a member card, a broken code and a product barcode', () => {
    expect(parseAppCode('TP-8F3K2QXM-482913')).toBeNull();
    expect(parseAppCode('TPD-8F3K2QXI9ABC')).toBeNull(); // I is not Crockford
    expect(parseAppCode('TPD-8F3K2QXM9AB')).toBeNull();
    expect(parseAppCode('6291041500213')).toBeNull();
    expect(isLoyaltyScan('6291041500213')).toBe(false);
  });

  it('gives a deal code its own words for the refusals the catalogue words for rewards', () => {
    const err = (code: string) => ({ code });
    expect(dealCodeErrorKey(err('VOUCHER_NOT_FOUND'))).toBe('ws.loyalty.dealCode.errors.VOUCHER_NOT_FOUND');
    expect(dealCodeErrorKey(err('VOUCHER_USED'))).toBe('ws.loyalty.dealCode.errors.VOUCHER_USED');
    expect(dealCodeErrorKey(err('VOUCHER_EXPIRED'))).toBe('ws.loyalty.dealCode.errors.VOUCHER_EXPIRED');
    expect(dealCodeErrorKey(err('VOUCHER_WRONG_BRANCH'))).toBe('ws.loyalty.dealCode.errors.VOUCHER_WRONG_BRANCH');
    for (const code of ['DEAL_NOT_ON_BILL', 'VOUCHER_OTHER_MEMBER', 'TAB_NOT_OPEN', 'MEMBER_NOT_FOUND', 'FORBIDDEN']) {
      expect(dealCodeErrorKey(err(code))).toBeNull();
    }
    expect(dealCodeErrorKey(null)).toBeNull();
    expect(dealCodeErrorKey(new Error('boom'))).toBeNull();
  });
});

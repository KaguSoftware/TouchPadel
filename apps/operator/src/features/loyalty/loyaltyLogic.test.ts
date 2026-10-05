import { describe, expect, it } from 'vitest';
import {
  adjustErrors,
  defaultRedeemPoints,
  identifyCode,
  isBaseTier,
  isMemberScan,
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
  tierDraft,
  tierErrors,
  tierPayload,
  type RewardDraft,
} from './loyaltyLogic';
import { BarcodeWedge } from '../till/barcodeWedge';
import type { IdentifiedMember, LoyaltyAdminTier, LoyaltySettings } from '@touch/core/loyalty';

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
      tier: { id: 't2', name_en: 'Gold', name_ar: 'ذهبي', multiplier: 1.5 },
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
  };

  it('round-trips the settings', () => {
    const d = settingsDraft(settings);
    expect(settingsErrors(d)).toEqual({});
    expect(settingsPatch(d)).toEqual(settings);
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
      inactivity_expiry_months: 'positive',
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
    },
    {
      id: 't1',
      name_en: 'Gold',
      name_ar: 'ذهبي',
      min_points_12m: 500,
      earn_multiplier: 1.5,
      promotion_id: null,
      sort: 1,
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
    });
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

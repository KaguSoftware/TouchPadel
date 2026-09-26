import { describe, expect, it } from 'vitest';
import { STAFF_ROLES, startableKinds, validateStep, type StepRow, type SubmissionRow } from '@touch/core';
import { recordFromDraft } from '../assemble';
import {
  IDEA_ROLES,
  START_ROLES,
  bilingual,
  blocksToSend,
  completeRenames,
  courtsRecord,
  interviewsRecord,
  isProtocolQueryKey,
  launchPhotoChoices,
  numbersRenames,
  parseRunFilter,
  parseVariant,
  plannedWindows,
  positionRole,
  priceNumbersStart,
  priceProposeResubmit,
  priceProposeStart,
  readBlockAnswer,
  readTournamentContext,
  resubmissionSource,
  runChange,
  runTitle,
  sendBackTargets,
  startDecidedByStarter,
  submitIntent,
  targetKindOf,
  titlesFromRecord,
} from '../logic';
import { stepForm } from '@touch/core';
import type { PriceNumbers, PriceTargets } from '../types';

/**
 * The rules behind the phone's protocol pages (build-contracts-2026-09-23 §6.1,
 * §2.7-§2.13). The server stays the wall; these keep a page from offering what
 * it would refuse, and from sending a record its check hook would refuse.
 */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

function sub(over: Partial<SubmissionRow>): SubmissionRow {
  return {
    id: over.id ?? 'sub',
    round: 1,
    submitted_by: 'u1',
    submitted_by_name: 'Rusul',
    submitted_at: '2026-09-25T10:00:00Z',
    record: null,
    photos: [],
    withdrawn_at: null,
    superseded_at: null,
    decision: null,
    decided_by: null,
    decided_by_name: null,
    decided_at: null,
    decision_note: null,
    send_back_to: null,
    ...over,
  };
}

function step(over: Partial<StepRow>): StepRow {
  return {
    id: over.id ?? 'step',
    position: 1,
    step_key: null,
    name_en: 'Step',
    name_ar: 'خطوة',
    status: 'open',
    round: 1,
    actor_roles: ['manager'],
    assigned_to: null,
    assigned_to_name: null,
    needs_owner_ok: false,
    optional: false,
    after_keys: [],
    opened_at: null,
    passed_at: null,
    skip_note: null,
    skipped_by_name: null,
    skipped_at: null,
    items: [],
    submissions: [],
    ...over,
  };
}

describe('who may open the pages', () => {
  it('lets exactly the roles that may start something open the start page (§2.7)', () => {
    expect([...START_ROLES].sort()).toEqual(STAFF_ROLES.filter((r) => startableKinds(r).length > 0).sort());
    expect([...START_ROLES].sort()).toEqual(['court_desk', 'head_barista', 'head_chef', 'manager', 'marketing', 'owner']);
  });

  it('opens the ideas page to the authors and their reviewers only (#65)', () => {
    expect([...IDEA_ROLES].sort()).toEqual(['barista', 'chef', 'head_barista', 'head_chef', 'manager', 'owner']);
  });

  it('has the starter decide the first step only as management (the owner alone for hiring)', () => {
    expect(startDecidedByStarter('product_release', 'manager')).toBe(true);
    expect(startDecidedByStarter('product_release', 'head_chef')).toBe(false);
    expect(startDecidedByStarter('tournament', 'court_desk')).toBe(false);
    expect(startDecidedByStarter('hiring', 'manager')).toBe(false);
    expect(startDecidedByStarter('hiring', 'owner')).toBe(true);
    expect(startDecidedByStarter('price_promo', 'marketing')).toBe(false);
  });
});

describe('titles and names', () => {
  it('shows a one-language title in both languages (Q10)', () => {
    expect(runTitle({ title_en: 'Pistachio latte', title_ar: null }, 'ar')).toBe('Pistachio latte');
    expect(runTitle({ title_en: ' ', title_ar: 'لاتيه' }, 'en')).toBe('لاتيه');
    expect(bilingual('en', null, '')).toBeNull();
  });

  it('titles a new item or a tournament by its names when none was typed', () => {
    expect(titlesFromRecord('product_release', { name_en: 'Latte', name_ar: '' })).toEqual({ en: 'Latte', ar: null });
    expect(titlesFromRecord('hiring', { name_en: 'x' })).toEqual({ en: null, ar: null });
  });

  it('reads the route params it is given, and nothing else', () => {
    expect(parseRunFilter('finished')).toBe('finished');
    expect(parseRunFilter('everything')).toBe('waiting');
    expect(parseVariant('type3')).toBe('type3');
    expect(parseVariant('type9')).toBeNull();
  });
});

describe('a step page', () => {
  it('fills a reopened step from the newest record the reader may see', () => {
    const s = step({
      submissions: [
        sub({ id: 'old', submitted_at: '2026-09-20T10:00:00Z', record: { notes: 'first' } }),
        sub({ id: 'new', submitted_at: '2026-09-22T10:00:00Z', record: { notes: 'second' }, decision: 'send_back' }),
        sub({ id: 'hidden', submitted_at: '2026-09-23T10:00:00Z', record: null }),
      ],
    });
    expect(resubmissionSource(s)?.id).toBe('new');
    expect(resubmissionSource(step({}))).toBeNull();
  });

  it('keys a send again after a withdraw as a new intent, and a retry as the same one (§6.4)', () => {
    const open = step({ id: A, round: 2, submissions: [sub({ id: 'r1', round: 1, decision: 'send_back' })] });
    // A retry of the same send, nothing landed yet: the same intent.
    expect(submitIntent(open)).toBe(submitIntent({ ...open }));
    // The send landed (its answer lost), then was withdrawn: the step is open
    // again in the same round, and the next send must not replay the first.
    const withdrawn = step({
      ...open,
      submissions: [...open.submissions, sub({ id: 'r2', round: 2, withdrawn_at: '2026-09-25T11:00:00Z' })],
    });
    expect(withdrawn.round).toBe(open.round);
    expect(submitIntent(withdrawn)).not.toBe(submitIntent(open));
    expect(submitIntent(step({ id: B, round: 2, submissions: open.submissions }))).not.toBe(submitIntent(open));
  });

  it('names the send-back targets in run order', () => {
    const steps = [
      step({ id: A, position: 3, name_en: 'Price', name_ar: 'السعر' }),
      step({ id: B, position: 1, name_en: 'Propose', name_ar: 'اقتراح' }),
    ];
    expect(sendBackTargets([A, B, C], steps, 'ar')).toEqual([
      { id: B, name: 'اقتراح', position: 1 },
      { id: A, name: 'السعر', position: 3 },
    ]);
  });

  it('offers the launch the standing test and marketing photos, newest first, each once', () => {
    const steps = [
      step({
        step_key: 'test',
        submissions: [
          sub({ submitted_at: '2026-09-20T10:00:00Z', photos: ['t1', 't2'], decision: 'send_back' }),
          sub({ submitted_at: '2026-09-21T10:00:00Z', photos: ['t3', 't2'], decision: 'approve' }),
        ],
      }),
      step({ step_key: 'marketing', submissions: [sub({ submitted_at: '2026-09-22T10:00:00Z', photos: ['m1'] })] }),
      step({ step_key: 'propose', submissions: [sub({ submitted_at: '2026-09-23T10:00:00Z', photos: ['p1'] })] }),
      step({
        step_key: 'marketing',
        submissions: [sub({ submitted_at: '2026-09-24T10:00:00Z', photos: ['gone'], withdrawn_at: '2026-09-24T11:00:00Z' })],
      }),
    ];
    expect(launchPhotoChoices(steps)).toEqual(['m1', 't3', 't2']);
  });

  it('reads the position a hiring run is for, and a price run’s change kind', () => {
    const steps = [
      step({ step_key: 'open_position', submissions: [sub({ record: { role: 'barista' } })] }),
      step({ step_key: 'propose', submissions: [sub({ record: { change: 'rate' } })] }),
    ];
    expect(positionRole(steps)).toBe('barista');
    expect(runChange(steps)).toBe('rate');
    expect(positionRole([step({ step_key: 'open_position', submissions: [sub({ record: { role: 'wizard' } })] })])).toBeNull();
  });
});

const TARGETS: PriceTargets = {
  items: [
    {
      menu_item_id: A,
      name_en: 'Latte',
      name_ar: 'لاتيه',
      category_kind: 'cafe',
      is_active: true,
      sizes: [
        { variant_id: B, name_en: 'Regular', name_ar: 'عادي', price_iqd: 5000 },
        { variant_id: C, name_en: 'Large', name_ar: 'كبير', price_iqd: 6000 },
      ],
    },
    {
      menu_item_id: B,
      name_en: 'Grip',
      name_ar: 'مقبض',
      category_kind: 'shop',
      is_active: true,
      sizes: [{ variant_id: C, name_en: 'One', name_ar: 'واحد', price_iqd: 9000 }],
    },
  ],
  featured_item_id: A,
  featured_discount_pct: 10,
  addons: [
    {
      modifier_id: C,
      group_id: A,
      group_name_en: 'Milk',
      group_name_ar: 'الحليب',
      name_en: 'Oat',
      name_ar: 'شوفان',
      price_delta_iqd: 1000,
      is_active: true,
      launched: true,
    },
  ],
  promotions: [
    {
      promotion_id: C,
      name_en: 'Happy hour',
      name_ar: 'ساعة سعيدة',
      type: 'percent',
      value: 15,
      starts_at: null,
      ends_at: null,
      weekdays: [1, 2],
      hour_from: '15:00:00',
      hour_to: '17:00:00',
      scope: {},
      limits: null,
      auto: true,
      public_code: null,
      code_single_use: false,
      enabled: false,
      updated_at: '2026-09-01T00:00:00Z',
    },
  ],
  rules: [
    {
      rule_id: C,
      name: 'Peak',
      court_id: null,
      court_name_en: null,
      court_name_ar: null,
      days_of_week: [4, 5],
      start_time: '17:00:00',
      end_time: '23:00:00',
      priority: 10,
      valid_from: null,
      valid_to: null,
      is_active: true,
      prices: { '60': 40000, '90': 55000 },
    },
  ],
};

describe('a price or promotion change', () => {
  it('knows which list each change kind is aimed at', () => {
    expect(targetKindOf('price')).toBe('item');
    expect(targetKindOf('featured_discount')).toBe('featured');
    expect(targetKindOf('promotion_enable')).toBe('promotion');
    expect(targetKindOf('rate')).toBe('rule');
    expect(targetKindOf('addon_price')).toBe('addons');
    expect(targetKindOf('promotion')).toBe('none');
  });

  it('prices a cafe item size by size, blank until typed, and sends only what changed', () => {
    const s = priceProposeStart('price', TARGETS, A);
    expect(s.fixed.prices?.rows.map((r) => r.current)).toEqual([5000, 6000]);
    expect(s.hidden).not.toContain('new_sizes');
    const fields = stepForm('price_promo', 'propose', { change: 'price' })!.fields;
    const draft = { ...s.draft, reason: 'Milk costs', expected_effect: 'Keep margin', prices: [{ variant_id: B, price_iqd: '5500' }, { variant_id: C, price_iqd: '' }] };
    // The page passes every fixed list's key; the untouched rename rows are dropped with the prices'.
    const record = recordFromDraft(fields, draft, { fixedKeys: { prices: 'variant_id', renames: 'variant_id' } });
    expect(record).toMatchObject({ change: 'price', menu_item_id: A, prices: [{ variant_id: B, price_iqd: 5500 }] });
    expect(validateStep('price_promo', 'propose', record)).toEqual([]);
  });

  it('never offers a new size on a shop product (§2.8)', () => {
    expect(priceProposeStart('price', TARGETS, B).hidden).toContain('new_sizes');
    expect(priceProposeStart('shop_launch', TARGETS, B).hidden).toContain('new_sizes');
  });

  it('lists every add-on as a row, with its group and today’s price', () => {
    const s = priceProposeStart('addon_price', TARGETS, null);
    expect(s.fixed.addons?.rows).toEqual([
      { id: C, name_en: 'Oat', name_ar: 'شوفان', group_en: 'Milk', group_ar: 'الحليب', current: 1000 },
    ]);
  });

  it('starts a promotion edit from the promotion as it stands', () => {
    const s = priceProposeStart('promotion_edit', TARGETS, C);
    expect(s.draft.promotion_id).toBe(C);
    expect(s.draft.promotion).toMatchObject({ name_en: 'Happy hour', value: '15', weekdays: ['1', '2'], hour_from: '15:00' });
  });

  it('starts a new court rate switched on, and an edit from the rule', () => {
    expect(priceProposeStart('rate', TARGETS, null).draft.rule).toMatchObject({ is_active: true, name: '' });
    expect(priceProposeStart('rate', TARGETS, C).draft.rule).toMatchObject({
      name: 'Peak',
      days_of_week: ['4', '5'],
      start_time: '17:00',
      prices: [
        { minutes: '60', price: '40000' },
        { minutes: '90', price: '55000' },
      ],
    });
  });

  it('keeps the featured item when none is picked, with today’s discount', () => {
    const s = priceProposeStart('featured_discount', TARGETS, null);
    expect(s.draft.menu_item_id).toBe(A);
    expect(s.draft.discount_pct).toBe('10');
  });

  it('refills a sent-back proposal against its own target', () => {
    const r = priceProposeResubmit(
      { change: 'price', menu_item_id: A, prices: [{ variant_id: C, price_iqd: 6500 }], reason: 'r', expected_effect: 'e' },
      TARGETS,
    );
    expect(r.change).toBe('price');
    expect(r.draft.prices).toEqual([
      { variant_id: B, price_iqd: '' },
      { variant_id: C, price_iqd: '6500' },
    ]);
  });

  it('fills the manager’s numbers with the standing figures', () => {
    const numbers: PriceNumbers = {
      change: 'price',
      sizes: [
        { variant_id: B, name_en: 'Regular', name_ar: 'عادي', current_price_iqd: 5000, new_price_iqd: 5500, cost_iqd: 2000, cost_known: true, margin_before_iqd: 3000, margin_after_iqd: 3500, units_30d: 10, revenue_30d_iqd: 50000 },
        { variant_id: null, name_en: 'Mini', name_ar: 'صغير', current_price_iqd: null, new_price_iqd: 3500, cost_iqd: null, cost_known: false, margin_before_iqd: null, margin_after_iqd: null, units_30d: 0, revenue_30d_iqd: 0 },
      ],
      addons: [],
      promotion: null,
      rate: null,
      featured: null,
    };
    const s = priceNumbersStart('price', numbers);
    expect(s.draft.recommendation).toBe('go');
    expect(s.draft.prices).toEqual([{ variant_id: B, price_iqd: '5500' }]);
    expect(s.draft.new_sizes).toEqual([{ name_en: 'Mini', name_ar: 'صغير', price_iqd: '3500' }]);
    const fields = stepForm('price_promo', 'numbers', { change: 'price' })!.fields;
    const record = recordFromDraft(fields, s.draft, { fixedKeys: { prices: 'variant_id' } });
    expect(validateStep('price_promo', 'numbers', record, { change: 'price' })).toEqual([]);
  });
});

describe('the court desk’s windows (§2.11)', () => {
  const ctx = readTournamentContext({
    name_en: 'Open',
    name_ar: 'المفتوحة',
    class: 'A',
    format: 'americano',
    capacity: { unit: 'pairs', count: 16 },
    ranges: [
      { court_ids: [A, B], court_names: [{ en: 'Court 1', ar: 'ملعب 1' }, { en: 'Court 2', ar: 'ملعب 2' }], from: '2026-10-02T15:00:00Z', to: '2026-10-02T19:00:00Z' },
      { court_ids: [A], court_names: [{ en: 'Court 1', ar: 'ملعب 1' }], from: '2026-10-02T15:00:00+00:00', to: '2026-10-02T19:00:00+00:00' },
    ],
    blocked: [{ reservation_id: C, court_id: A, start_at: '2026-10-02T18:00:00+03:00', end_at: '2026-10-02T22:00:00+03:00' }],
    entry_fee_iqd: 50000,
  });

  it('lists each court and window once, matched to the run’s block of it', () => {
    const w = plannedWindows(ctx);
    expect(w.map((x) => [x.courtId, x.reservationId])).toEqual([
      [A, C],
      [B, null],
    ]);
    expect(blocksToSend(w)).toEqual([{ court_id: B, start_at: '2026-10-02T15:00:00Z', end_at: '2026-10-02T19:00:00Z' }]);
  });

  it('sends the plan’s blocks and a trimmed note', () => {
    expect(courtsRecord(ctx, '  moved one booking ')).toEqual({ reservation_ids: [C], moved_note: 'moved one booking' });
    expect(courtsRecord(ctx, ' ')).toEqual({ reservation_ids: [C] });
  });

  it('reads a block answer with its conflicts', () => {
    const answer = readBlockAnswer({
      blocked: [],
      conflicts: [{ court_id: B, start_at: 'x', end_at: 'y', reservation_id: A, kind: 'booking', status: 'confirmed' }],
    });
    expect(answer.conflicts).toEqual([{ reservationId: A, courtId: B, startAt: 'x', endAt: 'y', kind: 'booking' }]);
  });
});

describe('hiring', () => {
  it('sends every candidate and the one picked', () => {
    expect(interviewsRecord([{ id: A, picked: false }, { id: B, picked: true }])).toEqual({ candidate_ids: [A, B], picked_id: B });
    expect(interviewsRecord([{ id: A, picked: false }]).picked_id).toBeNull();
  });
});

describe('refreshing after a write', () => {
  it('refreshes the protocol reads and leaves the rest of the staff area alone', () => {
    expect(isProtocolQueryKey(['staff', 'step', 'x'])).toBe(true);
    expect(isProtocolQueryKey(['staff', 'work', 'v'])).toBe(true);
    expect(isProtocolQueryKey(['staff', 'ideasToReview', 'v'])).toBe(true);
    expect(isProtocolQueryKey(['staff', 'status', 'u'])).toBe(false);
    expect(isProtocolQueryKey(['staff', 'shopping', 'v', 'open'])).toBe(false);
    expect(isProtocolQueryKey(['bookings', 'run'])).toBe(false);
  });
});

/**
 * Wave 5 (wave5-addendum-2026-09-25 §2.2, #9): sizes and options on sale are
 * renamed through the price change. The phone asks for the names that change
 * only: an empty box keeps today's name, and a row that renames nothing is not
 * sent.
 */
describe('renames on a price or add-on price change', () => {
  const priceFields = stepForm('price_promo', 'propose', { change: 'price' })!.fields;
  const addonFields = stepForm('price_promo', 'propose', { change: 'addon_price' })!.fields;
  const withAlmond: PriceTargets = {
    ...TARGETS,
    addons: [
      ...(TARGETS.addons ?? []),
      {
        modifier_id: A,
        group_id: A,
        group_name_en: 'Milk',
        group_name_ar: 'الحليب',
        name_en: 'Almond',
        name_ar: 'لوز',
        price_delta_iqd: 750,
        is_active: false,
        launched: false,
      },
    ],
  };

  it('gives a cafe item one blank rename row per size, headed by its name, its size picked by the row', () => {
    const s = priceProposeStart('price', TARGETS, A);
    expect(s.fixed.renames).toEqual({
      key: 'variant_id',
      rows: [
        { id: B, name_en: 'Regular', name_ar: 'عادي', current: null },
        { id: C, name_en: 'Large', name_ar: 'كبير', current: null },
      ],
    });
    expect(s.draft.renames).toEqual([
      { variant_id: B, name_en: '', name_ar: '' },
      { variant_id: C, name_en: '', name_ar: '' },
    ]);
    expect(s.hidden).toContain('renames.variant_id');
    expect(s.hidden).toContain('renames.modifier_id');
    // A shop size is renamed the same way (its stock row follows on the server).
    expect(priceProposeStart('price', TARGETS, B).fixed.renames?.rows.map((r) => r.id)).toEqual([C]);
    // A launch has no rename.
    expect(priceProposeStart('shop_launch', TARGETS, B).fixed.renames).toBeUndefined();
  });

  it('offers only the options on sale for a rename', () => {
    const s = priceProposeStart('addon_price', withAlmond, null);
    expect(s.fixed.addons?.rows.map((r) => r.id)).toEqual([C, A]);
    expect(s.fixed.renames?.rows).toEqual([{ id: C, name_en: 'Oat', name_ar: 'شوفان', group_en: 'Milk', group_ar: 'الحليب', current: null }]);
  });

  it('swaps Small and Large as a rename-only change, and passes the core check', () => {
    const s = priceProposeStart('price', TARGETS, A);
    const draft = completeRenames(
      {
        ...s.draft,
        reason: 'The cups were labelled the wrong way round',
        expected_effect: 'Guests get the size they order',
        renames: [
          { variant_id: B, name_en: 'Large', name_ar: 'كبير' },
          { variant_id: C, name_en: 'Regular', name_ar: 'عادي' },
        ],
      },
      s.fixed.renames,
    );
    const record = recordFromDraft(priceFields, draft, { fixedKeys: { prices: 'variant_id', renames: 'variant_id' } });
    // No new price: no prices key, which the server reads as none (0177's price_promo_sizes).
    expect(record.prices).toBeUndefined();
    expect(record.renames).toEqual([
      { variant_id: B, name_en: 'Large', name_ar: 'كبير' },
      { variant_id: C, name_en: 'Regular', name_ar: 'عادي' },
    ]);
    expect(validateStep('price_promo', 'propose', record)).toEqual([]);
  });

  it('keeps today’s name in an empty box, and drops a row that renames nothing', () => {
    const s = priceProposeStart('price', TARGETS, A);
    const done = completeRenames(
      {
        ...s.draft,
        renames: [
          { variant_id: B, name_en: ' Small ', name_ar: '' },
          { variant_id: C, name_en: 'Large ', name_ar: 'كبير' },
        ],
      },
      s.fixed.renames,
    );
    expect(done.renames).toEqual([
      { variant_id: B, name_en: 'Small', name_ar: 'عادي' },
      { variant_id: C, name_en: '', name_ar: '' },
    ]);
    const record = recordFromDraft(priceFields, { ...done, reason: 'r', expected_effect: 'e' }, { fixedKeys: { prices: 'variant_id', renames: 'variant_id' } });
    expect(record.renames).toEqual([{ variant_id: B, name_en: 'Small', name_ar: 'عادي' }]);
    // A case change is a rename.
    expect(
      completeRenames({ renames: [{ variant_id: C, name_en: 'large', name_ar: '' }] }, s.fixed.renames).renames,
    ).toEqual([{ variant_id: C, name_en: 'large', name_ar: 'كبير' }]);
    // Nothing typed: nothing sent, and no renames key at all.
    const untouched = recordFromDraft(priceFields, completeRenames(s.draft, s.fixed.renames), {
      fixedKeys: { prices: 'variant_id', renames: 'variant_id' },
    });
    expect('renames' in untouched).toBe(false);
  });

  it('sends an add-on rename with no new price', () => {
    const s = priceProposeStart('addon_price', withAlmond, null);
    const draft = completeRenames({ ...s.draft, reason: 'r', expected_effect: 'e', renames: [{ modifier_id: C, name_en: 'Oat milk', name_ar: '' }] }, s.fixed.renames);
    const record = recordFromDraft(addonFields, draft, { fixedKeys: { addons: 'modifier_id', renames: 'modifier_id' } });
    // No new charge: no addons key, which 0195's check reads as a rename-only change.
    expect(record.addons).toBeUndefined();
    expect(record.renames).toEqual([{ modifier_id: C, name_en: 'Oat milk', name_ar: 'شوفان' }]);
    expect(validateStep('price_promo', 'propose', record)).toEqual([]);
  });

  it('refills a sent-back proposal’s renames as they were sent', () => {
    const r = priceProposeResubmit(
      {
        change: 'price',
        menu_item_id: A,
        prices: [],
        renames: [{ variant_id: C, name_en: 'Grande', name_ar: 'كبير جدًا', before_en: 'Large', before_ar: 'كبير' }],
        reason: 'r',
        expected_effect: 'e',
      },
      TARGETS,
    );
    expect(r.draft.renames).toEqual([
      { variant_id: B, name_en: '', name_ar: '' },
      { variant_id: C, name_en: 'Grande', name_ar: 'كبير جدًا' },
    ]);
    expect(r.hidden).toContain('renames.variant_id');
  });

  it('reads the numbers’ renames defensively', () => {
    expect(
      numbersRenames({
        renames: [
          { target: 'size', id: B, from_en: 'Small', from_ar: 'صغير', to_en: 'Large', to_ar: 'كبير', price_iqd: 4000 },
          { target: 'addon', id: C, from_en: 'Oat', from_ar: 'شوفان', to_en: 'Oat milk', to_ar: 'حليب الشوفان' },
          { target: 'size' },
        ],
      }),
    ).toEqual([
      { target: 'size', id: B, from_en: 'Small', from_ar: 'صغير', to_en: 'Large', to_ar: 'كبير', price_iqd: 4000 },
      { target: 'addon', id: C, from_en: 'Oat', from_ar: 'شوفان', to_en: 'Oat milk', to_ar: 'حليب الشوفان', price_iqd: null },
    ]);
    expect(numbersRenames({ change: 'price', sizes: [] })).toEqual([]);
    expect(numbersRenames(undefined)).toEqual([]);
  });
});

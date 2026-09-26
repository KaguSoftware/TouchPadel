/**
 * The protocol forms both apps render (build-contracts-2026-09-23 §7.2): the
 * built-in step table, the field lists and the client checks. The server's
 * check hooks are the authority; these pin that the client asks for the same
 * things, with the same hint names, before the round trip.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STAFF_ROLES } from '../staff/roles';
import { isGeneratedPromoCode } from '../money/promotion';
import {
  GENERIC_STEP_FORM,
  PRICE_CHANGE_KINDS,
  PROTOCOL_KINDS,
  RECORD_CAPS,
  STEP_KEYS,
  TEXT_CAPS,
  builtInStep,
  builtInSteps,
  decisionFields,
  priceChangeKinds,
  randomPromoCode,
  startForm,
  startableKinds,
  stepForm,
  validateDecision,
  validatePromotion,
  validateRateRule,
  validateSkip,
  validateStart,
  validateStep,
  validateTitles,
  type FieldIssue,
} from './index';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const NOW = Date.parse('2026-09-24T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const fields = (issues: FieldIssue[]) => issues.map((i) => `${i.field}:${i.code}${i.index === undefined ? '' : `@${i.index}`}`);

describe('the caps are §2.1’s', () => {
  it('holds the numbers the contract names', () => {
    expect(TEXT_CAPS).toEqual({ title: 120, name: 80, checklistItem: 200, decisionNote: 1000, freeText: 2000 });
  });

  it('matches the sentence in the contract itself, so an edit to either fails here', () => {
    const doc = readFileSync(
      fileURLToPath(new URL('../../../../docs/design/protocols/build-contracts-2026-09-23.md', import.meta.url)),
      'utf8',
    ).replace(/\s+/g, ' ');
    const m = /Caps: titles (\d+), names (\d+), checklist items (\d+), decision notes (\d+), notes and records' free text (\d+)/.exec(
      doc,
    );
    expect(m, 'the §2.1 caps sentence moved or was reworded').not.toBeNull();
    expect(m!.slice(1).map(Number)).toEqual([
      TEXT_CAPS.title,
      TEXT_CAPS.name,
      TEXT_CAPS.checklistItem,
      TEXT_CAPS.decisionNote,
      TEXT_CAPS.freeText,
    ]);
  });
});

describe('built-in steps (§2.8)', () => {
  it('lists every kind’s keys in their default order', () => {
    for (const kind of PROTOCOL_KINDS) {
      const variant = kind === 'tournament' ? 'type1' : null;
      expect(builtInSteps(kind, variant).map((s) => s.stepKey)).toEqual([...STEP_KEYS[kind]]);
    }
  });

  it('fixes the owner’s OK on the two price steps and marks the owner-only steps fixed (plan #58)', () => {
    const fixed = PROTOCOL_KINDS.flatMap((kind) =>
      builtInSteps(kind, kind === 'tournament' ? 'type1' : null)
        .filter((s) => s.okFixed)
        .map((s) => `${kind}.${s.stepKey}:${s.needsOwnerOk}`),
    );
    expect(fixed.sort()).toEqual(
      ['hiring.add_staff:false', 'price_promo.numbers:true', 'product_release.analysis:true', 'product_release.launch:false'].sort(),
    );
  });

  it('gives a tournament plan to the manager or the court desk, assigned to its starter, in every variant (#67)', () => {
    for (const variant of ['type1', 'type2', 'type3'] as const) {
      const planStep = builtInStep('tournament', 'plan', variant)!;
      expect([...planStep.actorRoles], variant).toEqual(['manager', 'court_desk']);
      expect(planStep.assignToStarter, variant).toBe(true);
      expect(planStep.needsOwnerOk, variant).toBe(false);
    }
  });

  it('assigns a release test to its starter and asks for 1 to 6 test photos', () => {
    const test = builtInStep('product_release', 'test')!;
    expect(test.assignToStarter).toBe(true);
    expect([test.photoFolder, test.photosMin, test.photosMax]).toEqual(['tests', 1, 6]);
  });

  it('keeps the price and the plan out of sight of anyone but management', () => {
    expect(builtInStep('product_release', 'analysis')!.recordVisibility).toBe('mgmt');
    expect(builtInStep('price_promo', 'numbers')!.recordVisibility).toBe('mgmt');
    expect(builtInStep('tournament', 'plan', 'type1')!.recordVisibility).toBe('mgmt');
    expect(builtInSteps('hiring').every((s) => s.recordVisibility === 'mgmt')).toBe(true);
  });

  it('drops feasibility from a type 2 tournament, re-points its dependants and turns every OK off (Q3)', () => {
    const steps = builtInSteps('tournament', 'type2');
    expect(steps.map((s) => s.stepKey)).toEqual(['plan', 'marketing', 'courts', 'ready']);
    expect(steps.find((s) => s.stepKey === 'marketing')!.after).toEqual(['plan']);
    expect(steps.find((s) => s.stepKey === 'courts')!.after).toEqual(['plan']);
    expect(steps.every((s) => !s.needsOwnerOk)).toBe(true);
    // Type 1 is untouched by the type 2 copy.
    expect(builtInStep('tournament', 'feasibility', 'type1')!.needsOwnerOk).toBe(true);
  });

  it('makes the optional steps exactly tournament marketing and price announce', () => {
    const optional = PROTOCOL_KINDS.flatMap((kind) =>
      builtInSteps(kind, kind === 'tournament' ? 'type1' : null)
        .filter((s) => s.optional)
        .map((s) => `${kind}.${s.stepKey}`),
    );
    expect(optional.sort()).toEqual(['price_promo.announce', 'tournament.marketing']);
  });
});

describe('who starts what', () => {
  it('matches the start_protocol guard (§2.7)', () => {
    const table = Object.fromEntries(STAFF_ROLES.map((r) => [r, startableKinds(r)]));
    expect(table.owner).toEqual(['product_release', 'tournament', 'hiring', 'price_promo']);
    expect(table.manager).toEqual(['product_release', 'tournament', 'hiring', 'price_promo']);
    expect(table.head_barista).toEqual(['product_release']);
    expect(table.head_chef).toEqual(['product_release']);
    expect(table.marketing).toEqual(['price_promo']);
    // tournament_desk_start (#67): the court desk starts a tournament.
    expect(table.court_desk).toEqual(['tournament']);
    for (const r of ['cashier', 'prep', 'barista', 'chef', 'driver'] as const) {
      expect(table[r], r).toEqual([]);
    }
    expect(startableKinds(null)).toEqual([]);
  });

  it('offers marketing every change kind but shop_launch, and management all eight', () => {
    expect(priceChangeKinds('owner')).toEqual([...PRICE_CHANGE_KINDS]);
    expect(priceChangeKinds('manager')).toEqual([...PRICE_CHANGE_KINDS]);
    expect(priceChangeKinds('marketing')).toEqual(PRICE_CHANGE_KINDS.filter((k) => k !== 'shop_launch'));
    expect(priceChangeKinds('head_chef')).toEqual([]);
    expect(priceChangeKinds(undefined)).toEqual([]);
  });
});

describe('forms', () => {
  it('has a form for every built-in step and none for a key the kind lacks', () => {
    for (const kind of PROTOCOL_KINDS) {
      for (const key of STEP_KEYS[kind]) {
        expect(stepForm(kind, key, { variant: 'type1', change: 'price' }), `${kind}.${key}`).not.toBeNull();
      }
    }
    expect(stepForm('hiring', 'launch')).toBeNull();
    expect(stepForm('tournament', 'feasibility', { variant: 'type2' })).toBeNull();
  });

  it('gives an owner-added step a note and 0 to 6 photos in steps', () => {
    expect(stepForm('hiring', null)).toBe(GENERIC_STEP_FORM);
    expect(GENERIC_STEP_FORM.fields.map((f) => f.name)).toEqual(['note']);
    expect([GENERIC_STEP_FORM.photoFolder, GENERIC_STEP_FORM.photosMin, GENERIC_STEP_FORM.photosMax]).toEqual(['steps', 0, 6]);
  });

  it('starts each kind with its first step', () => {
    expect(startForm('product_release').stepKey).toBe('propose');
    expect(startForm('tournament', { variant: 'type3' }).stepKey).toBe('plan');
    expect(startForm('hiring').stepKey).toBe('open_position');
    expect(startForm('price_promo', { change: 'rate' }).stepKey).toBe('propose');
  });

  it('gives a type 2 tournament the short plan: class, names, ranges, capacity, notes', () => {
    expect(startForm('tournament', { variant: 'type2' }).fields.map((f) => f.name)).toEqual([
      'class',
      'name_en',
      'name_ar',
      'ranges',
      'capacity',
      'notes',
    ]);
  });

  it('shapes a price or promo proposal by its change kind', () => {
    const names = (change: (typeof PRICE_CHANGE_KINDS)[number]) =>
      stepForm('price_promo', 'propose', { change })!.fields.map((f) => f.name);
    expect(names('price')).toEqual(['change', 'reason', 'expected_effect', 'menu_item_id', 'prices', 'new_sizes', 'renames']);
    expect(names('addon_price')).toEqual(['change', 'reason', 'expected_effect', 'addons', 'renames']);
    expect(names('promotion_enable')).toEqual(['change', 'reason', 'expected_effect', 'promotion_id']);
    expect(names('rate')).toEqual(['change', 'reason', 'expected_effect', 'rule_id', 'rule']);
  });

  it('asks the decider of a release proposal for its category, and nobody else for decision data', () => {
    expect(decisionFields('product_release', 'propose').map((f) => f.name)).toEqual(['category_id']);
    expect(decisionFields('product_release', 'test')).toEqual([]);
    expect(decisionFields('price_promo', 'numbers')).toEqual([]);
  });
});

const PROPOSAL = {
  name_en: 'Rose latte',
  item_kind: 'drink',
  lines: [
    { ingredient_id: U1, qty: 18, unit: 'g' },
    { label: 'Rose syrup', qty: 15, unit: 'ml' },
  ],
  sizes: [{ name_en: 'Regular' }],
};

describe('validateStep: release', () => {
  it('passes a proposal with one name, recipe lines and a size', () => {
    expect(validateStep('product_release', 'propose', PROPOSAL, {}, { photos: 2 })).toEqual([]);
  });

  it('needs a name in one language at least', () => {
    const { name_en: _drop, ...noName } = PROPOSAL;
    expect(fields(validateStep('product_release', 'propose', noName))).toEqual(['name_en:RECORD_INVALID']);
  });

  it('marks the line that names neither an ingredient nor a label, by its index', () => {
    const record = { ...PROPOSAL, lines: [...PROPOSAL.lines, { qty: 3, unit: 'pc' }] };
    expect(fields(validateStep('product_release', 'propose', record))).toEqual(['lines:RECORD_INVALID@2']);
  });

  it('refuses a zero quantity, an unknown unit and more than four sizes', () => {
    const record = {
      ...PROPOSAL,
      lines: [{ ingredient_id: U1, qty: 0, unit: 'kg' }],
      sizes: [{ name_en: 'S' }, { name_en: 'M' }, { name_en: 'L' }, { name_en: 'XL' }, { name_en: 'XXL' }],
    };
    expect(fields(validateStep('product_release', 'propose', record))).toEqual([
      'lines:RECORD_INVALID@0',
      'sizes:RECORD_INVALID',
    ]);
  });

  it('asks for the category only when the submitter decides the step (a manager starting one)', () => {
    expect(validateStep('product_release', 'propose', PROPOSAL, {}, { submitterDecides: false })).toEqual([]);
    expect(fields(validateStep('product_release', 'propose', PROPOSAL, {}, { submitterDecides: true }))).toEqual([
      'category_id:RECORD_INVALID',
    ]);
    expect(
      validateStep('product_release', 'propose', { ...PROPOSAL, category_id: U3 }, {}, { submitterDecides: true }),
    ).toEqual([]);
  });

  it('takes only an https link, and caps the item name at 60', () => {
    expect(fields(validateStep('product_release', 'propose', { ...PROPOSAL, link: 'http://example.com' }))).toEqual([
      'link:RECORD_INVALID',
    ]);
    expect(validateStep('product_release', 'propose', { ...PROPOSAL, link: 'https://example.com/r' })).toEqual([]);
    expect(
      fields(validateStep('product_release', 'propose', { ...PROPOSAL, name_en: 'x'.repeat(RECORD_CAPS.itemName + 1) })),
    ).toEqual(['name_en:TEXT_TOO_LONG']);
  });

  it('counts Arabic by characters, the way the database does', () => {
    expect(validateStep('product_release', 'propose', { ...PROPOSAL, name_ar: 'ق'.repeat(60) })).toEqual([]);
    expect(fields(validateStep('product_release', 'propose', { ...PROPOSAL, name_ar: 'ق'.repeat(61) }))).toEqual([
      'name_ar:TEXT_TOO_LONG',
    ]);
  });

  it('checks the photo count against the step (a test needs one)', () => {
    const test = { servings: [{ variant_id: U2, count: 2 }] };
    expect(fields(validateStep('product_release', 'test', test, {}, { photos: 0 }))).toEqual(['photos:RECORD_INVALID']);
    expect(validateStep('product_release', 'test', test, {}, { photos: 1 })).toEqual([]);
    expect(fields(validateStep('product_release', 'propose', PROPOSAL, {}, { photos: 7 }))).toEqual(['photos:RECORD_INVALID']);
  });

  it('launches on a date that is ahead, and not more than 90 days ahead', () => {
    const launch = (at: string) => validateStep('product_release', 'launch', { when: 'date', at, photo_path: 'p.jpg' }, {}, { now: NOW });
    expect(launch(new Date(NOW + 5 * DAY).toISOString())).toEqual([]);
    expect(fields(launch(new Date(NOW - DAY).toISOString()))).toEqual(['at:RECORD_INVALID']);
    expect(fields(launch(new Date(NOW + 91 * DAY).toISOString()))).toEqual(['at:RECORD_INVALID']);
    expect(validateStep('product_release', 'launch', { when: 'now', photo_path: 'p.jpg' }, {}, { now: NOW })).toEqual([]);
  });

  it('refuses what is not a record, and a step the kind does not have', () => {
    expect(fields(validateStep('product_release', 'propose', null))).toEqual(['record:RECORD_INVALID']);
    expect(fields(validateStep('product_release', 'plan', {}))).toEqual(['record:RECORD_INVALID']);
  });
});

const PLAN = {
  class: 'B',
  name_en: 'Autumn cup',
  name_ar: 'كأس الخريف',
  format: 'americano',
  ranges: [{ court_ids: [U1, U2], from: '2026-10-10T16:00:00Z', to: '2026-10-10T22:00:00Z' }],
  capacity: { unit: 'pairs', count: 16 },
};

describe('validateStep: tournament and hiring', () => {
  it('needs a format for type 1 and type 3, and the sponsor for type 3', () => {
    const { format: _f, ...noFormat } = PLAN;
    expect(fields(validateStep('tournament', 'plan', noFormat, { variant: 'type1' }))).toEqual(['format:RECORD_INVALID']);
    expect(validateStep('tournament', 'plan', PLAN, { variant: 'type1' })).toEqual([]);
    expect(fields(validateStep('tournament', 'plan', PLAN, { variant: 'type3' }))).toEqual([
      'sponsor:SPONSOR_DETAILS_REQUIRED',
    ]);
    const sponsored = { ...PLAN, sponsor: { name: 'Zain', contact: 'events desk', contribution_iqd: 500000 } };
    expect(validateStep('tournament', 'plan', sponsored, { variant: 'type3' })).toEqual([]);
  });

  it('takes the short form for type 2', () => {
    const { format: _f, ...short } = PLAN;
    expect(validateStep('tournament', 'plan', short, { variant: 'type2' })).toEqual([]);
  });

  it('marks a court range that ends before it starts', () => {
    const record = { ...PLAN, ranges: [{ ...PLAN.ranges[0], to: '2026-10-10T15:00:00Z' }] };
    expect(fields(validateStep('tournament', 'plan', record, { variant: 'type1' }))).toEqual(['ranges:RECORD_INVALID@0']);
  });

  it('opens a position only for a role that can be hired', () => {
    const position = { role: 'barista', why: 'Weekend rush', hours: 'Fri and Sat evenings', start_date: '2026-10-01' };
    expect(validateStep('hiring', 'open_position', position)).toEqual([]);
    for (const role of ['prep', 'owner']) {
      expect(fields(validateStep('hiring', 'open_position', { ...position, role })), role).toEqual(['role:RECORD_INVALID']);
    }
    expect(fields(validateStep('hiring', 'open_position', { ...position, start_date: '2026-02-30' }))).toEqual([
      'start_date:RECORD_INVALID',
    ]);
  });

  it('picks one of the candidates it names', () => {
    expect(validateStep('hiring', 'interviews', { candidate_ids: [U1, U2], picked_id: U2 })).toEqual([]);
    expect(fields(validateStep('hiring', 'interviews', { candidate_ids: [U1], picked_id: U2 }))).toEqual([
      'picked_id:RECORD_INVALID',
    ]);
  });
});

const PROMOTION = {
  name_en: 'Happy hour',
  name_ar: 'ساعة سعيدة',
  type: 'percent',
  value: 20,
  weekdays: [0, 1, 2],
  hour_from: '15:00',
  hour_to: '17:00',
  scope: { categoryIds: [U1] },
};

const RULE = {
  name: 'Weekday evenings',
  days_of_week: [0, 1, 2, 3, 4],
  start_time: '17:00',
  end_time: '23:00',
  prices: { '60': 40000, '90': 55000 },
  is_active: true,
};

describe('validateStep: price or promotion change', () => {
  const propose = (record: object) =>
    fields(validateStep('price_promo', 'propose', { reason: 'Costs rose', expected_effect: 'Margin back to 60%', ...record }));

  it('needs a price or a new size on a price change', () => {
    expect(propose({ change: 'price', menu_item_id: U1, prices: [{ variant_id: U2, price_iqd: 5000 }] })).toEqual([]);
    expect(propose({ change: 'price', menu_item_id: U1, new_sizes: [{ name_ar: 'كبير', price_iqd: 7000 }] })).toEqual([]);
    expect(propose({ change: 'price', menu_item_id: U1, prices: [], new_sizes: [] })).toEqual(['prices:RECORD_INVALID']);
    expect(propose({ change: 'price', menu_item_id: U1, prices: [{ variant_id: U2, price_iqd: 0 }] })).toEqual([
      'prices:RECORD_INVALID@0',
    ]);
  });

  it('lets an add-on go to 0 but never below', () => {
    expect(propose({ change: 'addon_price', addons: [{ modifier_id: U1, price_delta_iqd: 0 }] })).toEqual([]);
    expect(propose({ change: 'addon_price', addons: [{ modifier_id: U1, price_delta_iqd: -500 }] })).toEqual([
      'addons:RECORD_INVALID@0',
    ]);
  });

  it('takes renames on a price or add-on price change, as the only thing to do or beside prices (#9)', () => {
    const rename = { variant_id: U2, name_en: 'Large', name_ar: 'كبير' };
    expect(propose({ change: 'price', menu_item_id: U1, prices: [], renames: [rename] })).toEqual([]);
    expect(propose({ change: 'price', menu_item_id: U1, prices: [{ variant_id: U2, price_iqd: 5000 }], renames: [rename] })).toEqual([]);
    expect(propose({ change: 'price', menu_item_id: U1, prices: [], new_sizes: [], renames: [] })).toEqual(['prices:RECORD_INVALID']);
    const addon = { modifier_id: U3, name_en: 'Double shot', name_ar: 'شوت مزدوج' };
    expect(propose({ change: 'addon_price', renames: [addon] })).toEqual([]);
    expect(propose({ change: 'addon_price', addons: [], renames: [addon] })).toEqual([]);
    expect(propose({ change: 'addon_price', addons: [], renames: [] })).toEqual(['addons:RECORD_INVALID']);
    expect(propose({ change: 'addon_price' })).toEqual(['addons:RECORD_INVALID']);
  });

  it('needs both names of a rename, each within the name cap, and its id', () => {
    const rename = (r: object) => propose({ change: 'price', menu_item_id: U1, prices: [], renames: [r] });
    expect(rename({ variant_id: U2, name_en: 'Large', name_ar: ' ' })).toEqual(['renames:RECORD_INVALID@0']);
    expect(rename({ variant_id: U2, name_en: 'Large' })).toEqual(['renames:RECORD_INVALID@0']);
    expect(rename({ name_en: 'Large', name_ar: 'كبير' })).toEqual(['renames:RECORD_INVALID@0']);
    expect(rename({ variant_id: U2, name_en: 'x'.repeat(TEXT_CAPS.name + 1), name_ar: 'كبير' })).toEqual([
      'renames:TEXT_TOO_LONG@0',
    ]);
    expect(rename({ variant_id: U2, name_en: 'x'.repeat(TEXT_CAPS.name), name_ar: 'كبير' })).toEqual([]);
    const thirteen = Array.from({ length: 13 }, () => ({ variant_id: U2, name_en: 'Large', name_ar: 'كبير' }));
    expect(propose({ change: 'price', menu_item_id: U1, prices: [], renames: thirteen })).toEqual(['renames:RECORD_INVALID']);
  });

  it('keeps names out of the numbers: the owner approves the proposal’s names or sends it back', () => {
    for (const change of ['price', 'addon_price'] as const) {
      expect(stepForm('price_promo', 'numbers', { change })!.fields.map((f) => f.name)).not.toContain('renames');
    }
  });

  it('refuses an unknown change kind by its field', () => {
    expect(propose({ change: 'coupon' })).toEqual(['change:RECORD_INVALID']);
  });

  it('checks a proposed promotion as upsert_promotion would, under promotion.<field>', () => {
    expect(propose({ change: 'promotion', promotion: PROMOTION })).toEqual([]);
    expect(propose({ change: 'promotion', promotion: { ...PROMOTION, value: 100 } })).toEqual(['promotion.value:RECORD_INVALID']);
    expect(propose({ change: 'promotion_edit', promotion_id: U2, promotion: { ...PROMOTION, name_ar: ' ' } })).toEqual([
      'promotion.name_ar:RECORD_INVALID',
    ]);
  });

  it('checks a proposed rate as upsert_rate_rule would, under rule.<field>', () => {
    expect(propose({ change: 'rate', rule: RULE })).toEqual([]);
    expect(propose({ change: 'rate', rule_id: U3, rule: { ...RULE, end_time: '16:00' } })).toEqual(['rule.end_time:RECORD_INVALID']);
  });

  it('keeps the featured discount between 0 and 99', () => {
    expect(propose({ change: 'featured_discount', menu_item_id: U1, discount_pct: 0 })).toEqual([]);
    expect(propose({ change: 'featured_discount', menu_item_id: U1, discount_pct: 100 })).toEqual([
      'discount_pct:RECORD_INVALID',
    ]);
  });

  it('takes the final figures of the proposal’s own targets at numbers', () => {
    expect(validateStep('price_promo', 'numbers', { recommendation: 'go' }, { change: 'price' })).toEqual([]);
    expect(
      fields(validateStep('price_promo', 'numbers', { recommendation: 'go', rule_prices: { '7': 1000 } }, { change: 'rate' })),
    ).toEqual(['rule_prices:RECORD_INVALID']);
    expect(fields(validateStep('price_promo', 'numbers', { recommendation: 'maybe' }, { change: 'price' }))).toEqual([
      'recommendation:RECORD_INVALID',
    ]);
  });

  it('applies on a date only when the date is ahead', () => {
    const apply = (record: object) => fields(validateStep('price_promo', 'apply', record, {}, { now: NOW }));
    expect(apply({ when: 'now' })).toEqual([]);
    expect(apply({ when: 'date' })).toEqual(['at:RECORD_INVALID']);
    expect(apply({ when: 'date', at: new Date(NOW + 200 * DAY).toISOString() })).toEqual([]);
  });
});

describe('validatePromotion mirrors 0067', () => {
  const check = (patch: object) => fields(validatePromotion({ ...PROMOTION, ...patch }));

  it('passes a well-formed promotion', () => {
    expect(check({})).toEqual([]);
    expect(check({ type: 'amount', value: 2500, hour_from: null, hour_to: null })).toEqual([]);
  });

  it('refuses the dates the wrong way round, a half or empty hour window, and a repeated weekday', () => {
    expect(check({ starts_at: '2026-10-02T00:00:00Z', ends_at: '2026-10-01T00:00:00Z' })).toEqual([
      'promotion.ends_at:RECORD_INVALID',
    ]);
    expect(check({ hour_to: null })).toEqual(['promotion.hour_to:RECORD_INVALID']);
    expect(check({ hour_to: '15:00' })).toEqual(['promotion.hour_to:RECORD_INVALID']);
    expect(check({ weekdays: [1, 1] })).toEqual(['promotion.weekdays:RECORD_INVALID']);
    expect(check({ weekdays: [7] })).toEqual(['promotion.weekdays:RECORD_INVALID']);
  });

  it('crosses midnight when the window ends before it starts', () => {
    expect(check({ hour_from: '22:00', hour_to: '02:00' })).toEqual([]);
  });

  it('knows only its own scope and limit keys', () => {
    expect(check({ scope: { tableIds: [U1] } })).toEqual(['promotion.scope:RECORD_INVALID']);
    expect(check({ limits: { perDay: 3 } })).toEqual(['promotion.limits:RECORD_INVALID']);
    expect(check({ limits: { total: 0 } })).toEqual(['promotion.limits.total:RECORD_INVALID']);
    expect(check({ scope: { itemIds: ['not-a-uuid'] } })).toEqual(['promotion.scope.itemIds:RECORD_INVALID']);
  });

  it('takes a typed code of 4 to 16 letters or digits, whatever its case', () => {
    expect(check({ public_code: ' happy20 ' })).toEqual([]);
    expect(check({ public_code: 'AB1' })).toEqual(['promotion.public_code:RECORD_INVALID']);
    expect(check({ public_code: 'HAPPY-20' })).toEqual(['promotion.public_code:RECORD_INVALID']);
  });
});

describe('validateRateRule mirrors 0071', () => {
  const check = (patch: object) => fields(validateRateRule({ ...RULE, ...patch }));

  it('passes a well-formed rule', () => {
    expect(check({})).toEqual([]);
    expect(check({ court_id: U1, priority: 2, valid_from: '2026-10-01' })).toEqual([]);
  });

  it('refuses no days, a day out of range and an overnight window (two rules instead)', () => {
    expect(check({ days_of_week: [] })).toEqual(['rule.days_of_week:RECORD_INVALID']);
    expect(check({ days_of_week: [0, 7] })).toEqual(['rule.days_of_week:RECORD_INVALID']);
    expect(check({ start_time: '22:00', end_time: '02:00' })).toEqual(['rule.end_time:RECORD_INVALID']);
  });

  it('prices 15 to 480 minutes in steps of 5, above zero, at most 12 durations', () => {
    expect(check({ prices: {} })).toEqual(['rule.prices:RECORD_INVALID']);
    expect(check({ prices: { '10': 10000 } })).toEqual(['rule.prices:RECORD_INVALID']);
    expect(check({ prices: { '62': 10000 } })).toEqual(['rule.prices:RECORD_INVALID']);
    expect(check({ prices: { '60': 0 } })).toEqual(['rule.prices:RECORD_INVALID']);
    const thirteen = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [String(30 + i * 5), 1000]));
    expect(check({ prices: thirteen })).toEqual(['rule.prices:RECORD_INVALID']);
  });
});

describe('titles and starts', () => {
  it('lets staff type one language and asks the owner for both (Q10)', () => {
    expect(validateTitles('Rose latte', null, false)).toEqual([]);
    expect(validateTitles(null, 'لاتيه الورد', false)).toEqual([]);
    expect(fields(validateTitles(' ', '', false))).toEqual(['title:TEXT_REQUIRED']);
    expect(fields(validateTitles('Rose latte', null, true))).toEqual(['title:TEXT_BOTH_LANGUAGES_REQUIRED']);
    expect(validateTitles('Rose latte', 'لاتيه الورد', true)).toEqual([]);
    expect(fields(validateTitles('x'.repeat(121), null, false))).toEqual(['title:TEXT_TOO_LONG']);
  });

  it('needs a variant for a tournament and none for anything else', () => {
    const start = { titleEn: 'Cup', byOwner: false, record: PLAN };
    expect(fields(validateStart({ kind: 'tournament', ...start }, { now: NOW }))).toEqual(['variant:RECORD_INVALID']);
    expect(validateStart({ kind: 'tournament', variant: 'type1', ...start }, { now: NOW })).toEqual([]);
    expect(
      fields(validateStart({ kind: 'product_release', variant: 'type1', titleEn: 'Rose', byOwner: false, record: PROPOSAL })),
    ).toEqual(['variant:RECORD_INVALID']);
  });

  it('checks the first step’s record as part of the start', () => {
    expect(
      fields(validateStart({ kind: 'price_promo', change: 'promotion_enable', titleEn: 'Back on', byOwner: false, record: { change: 'promotion_enable' } })),
    ).toEqual(['reason:RECORD_INVALID', 'expected_effect:RECORD_INVALID', 'promotion_id:RECORD_INVALID']);
  });
});

describe('decisions', () => {
  it('needs a reason to send back or stop, and none to approve', () => {
    expect(fields(validateDecision('product_release', 'test', { decision: 'stop' }))).toEqual(['note:REASON_REQUIRED']);
    expect(fields(validateDecision('product_release', 'test', { decision: 'send_back', note: 'Retest', sendBackTo: U1, sendBackTargets: [U1] }))).toEqual([]);
    expect(validateDecision('product_release', 'test', { decision: 'approve' })).toEqual([]);
    expect(fields(validateDecision('price_promo', 'numbers', { decision: 'stop', note: 'x'.repeat(1001) }))).toEqual([
      'note:TEXT_TOO_LONG',
    ]);
  });

  it('sends work back only to a target the engine offered', () => {
    expect(
      fields(validateDecision('product_release', 'test', { decision: 'send_back', note: 'Again', sendBackTo: U2, sendBackTargets: [U1] })),
    ).toEqual(['send_back_to:SEND_BACK_TARGET_INVALID']);
  });

  it('approves a release proposal only with a category', () => {
    expect(fields(validateDecision('product_release', 'propose', { decision: 'approve' }))).toEqual([
      'category_id:RECORD_INVALID',
    ]);
    expect(validateDecision('product_release', 'propose', { decision: 'approve', data: { category_id: U3 } })).toEqual([]);
  });

  it('skips only with a reason', () => {
    expect(fields(validateSkip(''))).toEqual(['note:REASON_REQUIRED']);
    expect(validateSkip('No marketing this time')).toEqual([]);
  });
});

describe('randomPromoCode', () => {
  it('draws eight symbols of the generator’s alphabet from the bytes it is given', () => {
    const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i * 37);
    const code = randomPromoCode(bytes);
    expect(code).toHaveLength(8);
    expect(isGeneratedPromoCode(code)).toBe(true);
    expect(randomPromoCode(bytes)).toBe(code);
  });

  it('is unbiased: byte b and b + 32 give the same symbol', () => {
    expect(randomPromoCode((n) => new Uint8Array(n).fill(5))).toBe(randomPromoCode((n) => new Uint8Array(n).fill(37)));
  });
});

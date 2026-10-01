import { describe, expect, it } from 'vitest';
import { COACHING_SHAPES, missingKeys, type CoachingShape } from '@touch/core/coaching';
import { validateStep } from '@touch/core/protocols';
import { makeT } from '@touch/i18n';
import { finalizeRecord } from './contextLogic';
import {
  NEW_RULE,
  coachLabel,
  lessonNowLine,
  lessonTargetNames,
  lessonTypeLabel,
  pickTarget,
  priceProposalPrefill,
  readTargets,
} from './priceTargets';

const ITEM = '0a000000-0000-4000-8000-000000000001';
const V1 = '0b000000-0000-4000-8000-000000000001';
const V2 = '0b000000-0000-4000-8000-000000000002';
const ADDON = '0c000000-0000-4000-8000-000000000001';
const PROMO = '0d000000-0000-4000-8000-000000000001';
const RULE = '0e000000-0000-4000-8000-000000000001';

const items = readTargets({
  items: [
    {
      menu_item_id: ITEM,
      name_en: 'Latte',
      name_ar: 'لاتيه',
      category_kind: 'cafe',
      is_active: true,
      sizes: [
        { variant_id: V1, name_en: 'Small', name_ar: 'صغير', price_iqd: 4000 },
        { variant_id: V2, name_en: 'Large', name_ar: 'كبير', price_iqd: 5000 },
      ],
    },
    { name_en: 'no id' },
  ],
});

describe('price_promo_targets', () => {
  it('reads each kind’s shape and drops rows with no id', () => {
    expect(items.items).toHaveLength(1);
    const promos = readTargets({
      promotions: [{ promotion_id: PROMO, name_en: 'Mornings', name_ar: 'الصباح', type: 'percent', value: 10, weekdays: [0, 1], scope: { courtIds: ['c'] }, limits: { total: 50 }, enabled: false, hour_from: '07:00:00' }],
    });
    expect(promos.promotions[0]!.fields).toMatchObject({ type: 'percent', value: 10, weekdays: [0, 1], scope: { courtIds: ['c'], categoryIds: [], itemIds: [] }, limits: { total: 50, perCustomer: null } });
    const rules = readTargets({ rules: [{ rule_id: RULE, name: 'Evenings', days_of_week: [5, 6], start_time: '18:00:00', end_time: '23:00:00', prices: { '60': 30000, '90': 'x' }, is_active: true }] });
    expect(rules.rules[0]!.fields).toMatchObject({ name: 'Evenings', prices: { '60': 30000 }, court_id: '' });
    expect(readTargets({ featured_item_id: ITEM, featured_discount_pct: 15, hero_mode: 'media', items: [] }).featured).toEqual({ item_id: ITEM, pct: 15, hero_mode: 'media' });
    expect(readTargets(null)).toEqual({ items: [], addons: [], promotions: [], rules: [], featured: null, lessonTypes: [], coaches: [] });
  });
});

// ── Coaching (0282, operator.md §5.14.2): the three lesson change kinds ─────

const LT_GROUP = '0f000000-0000-4000-8000-000000000001';
const LT_PRIVATE = '0f000000-0000-4000-8000-000000000002';
const LT_COURSE = '0f000000-0000-4000-8000-000000000003';
const COACH_SARA = '0f100000-0000-4000-8000-000000000001';
const COACH_ALI = '0f100000-0000-4000-8000-000000000002';

const lessonTypes = readTargets({
  lesson_types: [
    { lesson_type_id: LT_GROUP, kind: 'group', name_en: 'Beginners', name_ar: 'مبتدئون', duration_min: 90, sessions_count: null, max_places: 6, price_iqd: 25000, court_share_iqd: 5000, is_active: true },
    { lesson_type_id: LT_COURSE, kind: 'course', name_en: 'Academy', name_ar: 'الأكاديمية', duration_min: 60, sessions_count: 8, max_places: 4, price_iqd: 200000, court_share_iqd: 4000, is_active: false },
    { name_en: 'no id' },
  ],
});

const coaches = readTargets({
  coaches: [
    {
      coach_id: COACH_SARA,
      display_name_en: 'Sara',
      display_name_ar: 'سارة',
      lesson_types: [
        { lesson_type_id: LT_PRIVATE, name_en: 'One to one', name_ar: 'فردي', kind: 'private', sessions_count: null, type_price_iqd: 30000, coach_price_iqd: 35000 },
        { lesson_type_id: LT_GROUP, name_en: 'Beginners', name_ar: 'مبتدئون', kind: 'group', sessions_count: null, type_price_iqd: 25000, coach_price_iqd: null },
      ],
    },
    { coach_id: COACH_ALI, display_name_en: 'Ali', display_name_ar: 'علي', lesson_types: [] },
  ],
});

/** A full answer built from a COACHING_SHAPES entry: every listed key, figures as numbers. */
function fixtureOf(shape: CoachingShape): Record<string, unknown> {
  const build = (level: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const key of level === '' ? shape.keys : (shape.nested?.[level] ?? [])) {
      const path = level === '' ? key : `${level}.${key}`;
      if (shape.nested?.[`${path}[]`]) out[key] = [build(`${path}[]`)];
      else if (shape.nested?.[path]) out[key] = build(path);
      else out[key] = /_id$/.test(key) ? LT_GROUP : /^(name|display_name)_|^kind$/.test(key) ? 'x' : key === 'is_active' ? true : 1;
    }
    return out;
  };
  return build('');
}

describe('the lesson targets (X28, R81)', () => {
  it('carries exactly the keys COACHING_SHAPES lists for each array', () => {
    const typesShape = COACHING_SHAPES.price_promo_targets_lesson_types;
    const typesRead = readTargets(fixtureOf(typesShape));
    expect(missingKeys({ lesson_types: typesRead.lessonTypes }, typesShape)).toEqual([]);
    expect(Object.keys(typesRead.lessonTypes![0]!).sort()).toEqual([...(typesShape.nested?.['lesson_types[]'] ?? [])].sort());

    const coachesShape = COACHING_SHAPES.price_promo_targets_coaches;
    const coachesRead = readTargets(fixtureOf(coachesShape));
    expect(missingKeys({ coaches: coachesRead.coaches }, coachesShape)).toEqual([]);
    expect(Object.keys(coachesRead.coaches![0]!).sort()).toEqual([...(coachesShape.nested?.['coaches[]'] ?? [])].sort());
    expect(Object.keys(coachesRead.coaches![0]!.lesson_types[0]!).sort()).toEqual([...(coachesShape.nested?.['coaches[].lesson_types[]'] ?? [])].sort());
  });

  it('drops a row with no id and never makes a figure up', () => {
    expect(lessonTypes.lessonTypes!.map((t) => t.lesson_type_id)).toEqual([LT_GROUP, LT_COURSE]);
    const bare = readTargets({ lesson_types: [{ lesson_type_id: LT_GROUP }] }).lessonTypes![0]!;
    expect(bare).toMatchObject({ price_iqd: null, court_share_iqd: null, duration_min: null, is_active: true, name_en: '' });
    expect(readTargets({ coaches: [{ display_name_en: 'no id', lesson_types: [] }] }).coaches).toEqual([]);
  });

  it('opens a lesson price at the type’s figures now, remembered as `before`', () => {
    expect(priceProposalPrefill('lesson_price', lessonTypes, { lessonType: LT_GROUP })).toEqual({
      change: 'lesson_price',
      lesson_type_id: LT_GROUP,
      price_iqd: 25000,
      court_share_iqd: 5000,
      before: { price_iqd: 25000, court_share_iqd: 5000 },
    });
    // A type the list does not hold is left for the person to pick.
    expect(priceProposalPrefill('lesson_price', lessonTypes, { lessonType: LT_PRIVATE })).toEqual({ change: 'lesson_price' });
  });

  it('opens a launch at the draft’s figures', () => {
    const drafts = readTargets({ lesson_types: [{ lesson_type_id: LT_COURSE, kind: 'course', price_iqd: null, court_share_iqd: 4000, is_active: false }] });
    expect(priceProposalPrefill('lesson_launch', drafts, { lessonType: LT_COURSE })).toEqual({
      change: 'lesson_launch',
      lesson_type_id: LT_COURSE,
      price_iqd: null,
      court_share_iqd: 4000,
    });
  });

  it('opens a coach price at the coach’s own, else the type’s', () => {
    expect(priceProposalPrefill('coach_price', coaches, { coach: COACH_SARA, lessonType: LT_PRIVATE })).toEqual({
      change: 'coach_price',
      coach_id: COACH_SARA,
      lesson_type_id: LT_PRIVATE,
      price_iqd: 35000,
    });
    expect(priceProposalPrefill('coach_price', coaches, { coach: COACH_SARA, lessonType: LT_GROUP })).toMatchObject({ price_iqd: 25000 });
    // A type the coach does not teach: the coach only.
    expect(priceProposalPrefill('coach_price', coaches, { coach: COACH_ALI, lessonType: LT_GROUP })).toEqual({ change: 'coach_price', coach_id: COACH_ALI });
    expect(priceProposalPrefill('coach_price', coaches, {})).toEqual({ change: 'coach_price' });
  });

  it('picks a type and brings its figures; a coach keeps the type only when they teach it', () => {
    const picked = pickTarget('lesson_price', lessonTypes, { change: 'lesson_price', reason: 'Demand', lesson_type_id: '', before: { price_iqd: 1 } }, LT_COURSE, 'lesson_type_id');
    expect(picked).toEqual({
      change: 'lesson_price',
      reason: 'Demand',
      lesson_type_id: LT_COURSE,
      price_iqd: 200000,
      court_share_iqd: 4000,
      before: { price_iqd: 200000, court_share_iqd: 4000 },
    });
    const sara = pickTarget('coach_price', coaches, { change: 'coach_price', coach_id: '', lesson_type_id: LT_GROUP }, COACH_SARA, 'coach_id');
    expect(sara).toMatchObject({ coach_id: COACH_SARA, lesson_type_id: LT_GROUP, price_iqd: 25000 });
    expect(pickTarget('coach_price', coaches, sara, COACH_ALI, 'coach_id')).toMatchObject({ coach_id: COACH_ALI, lesson_type_id: '', price_iqd: null });
    expect(pickTarget('coach_price', coaches, sara, LT_PRIVATE, 'lesson_type_id')).toMatchObject({ lesson_type_id: LT_PRIVATE, price_iqd: 35000 });
  });

  it('sends a lesson price’s changed figures only, never `before`, and the core check takes it', () => {
    const opened = { ...priceProposalPrefill('lesson_price', lessonTypes, { lessonType: LT_GROUP }), reason: 'Demand', expected_effect: 'Fuller sessions' };
    const sent = finalizeRecord('price_promo', 'propose', { ...opened, price_iqd: 28000 }, new Map());
    expect(sent).toEqual({ change: 'lesson_price', lesson_type_id: LT_GROUP, price_iqd: 28000, reason: 'Demand', expected_effect: 'Fuller sessions' });
    expect(validateStep('price_promo', 'propose', sent)).toEqual([]);
    // Nothing changed: the core check asks for a figure before the round trip.
    const nothing = finalizeRecord('price_promo', 'propose', opened, new Map());
    expect(validateStep('price_promo', 'propose', nothing).map((i) => i.field)).toEqual(['price_iqd']);
    // A coach price keeps its figure as typed (empty removes the coach's own).
    const coach = { change: 'coach_price', coach_id: COACH_SARA, lesson_type_id: LT_PRIVATE, price_iqd: 35000, before: { price_iqd: 35000 } };
    expect(finalizeRecord('price_promo', 'propose', coach, new Map())).toEqual({ change: 'coach_price', coach_id: COACH_SARA, lesson_type_id: LT_PRIVATE, price_iqd: 35000 });
  });
});

describe('lesson targets in words', () => {
  const en = makeT('en');
  const ar = makeT('ar');
  const strip = (s: string) => s.replace(/[⁦-⁩]/g, '');

  it('lists a type as "Beginners · Group 90 min · Draft", a course with its sessions', () => {
    const [group, course] = lessonTypes.lessonTypes!;
    expect(lessonTypeLabel(group!, en, 'en', 'draft')).toBe('Beginners · Group 90 min · Draft');
    expect(lessonTypeLabel(group!, ar, 'ar', 'draft')).toBe('مبتدئون · جماعية 90 دقيقة · مسودة');
    expect(strip(lessonTypeLabel(course!, en, 'en', 'off'))).toBe('Academy · Course 60 min · 8 sessions · off');
    // A coach's types carry no length.
    expect(lessonTypeLabel(coaches.coaches![0]!.lesson_types[0]!, en, 'en')).toBe('One to one · Private');
    expect(coachLabel(coaches.coaches![0]!, 'ar')).toBe('سارة');
  });

  it('says the figures now under the new ones, "—" for one the server did not send', () => {
    expect(lessonNowLine('lesson_price', lessonTypes, { lesson_type_id: LT_GROUP }, en, 'en')).toBe('Now: price 25,000 IQD · court share 5,000 IQD');
    expect(lessonNowLine('lesson_price', lessonTypes, { lesson_type_id: '' }, en, 'en')).toBeNull();
    const draft = readTargets({ lesson_types: [{ lesson_type_id: LT_COURSE, kind: 'course', price_iqd: null, court_share_iqd: null }] });
    expect(lessonNowLine('lesson_launch', draft, { lesson_type_id: LT_COURSE }, en, 'en')).toBe('Now: price — · court share —');
    expect(lessonNowLine('coach_price', coaches, { coach_id: COACH_SARA, lesson_type_id: LT_PRIVATE }, en, 'en')).toBe('Now: price 35,000 IQD');
    expect(lessonNowLine('coach_price', coaches, { coach_id: COACH_SARA, lesson_type_id: LT_GROUP }, en, 'en')).toBe('Now: the lesson type’s price, 25,000 IQD');
    expect(lessonNowLine('price', items, { menu_item_id: ITEM }, en, 'en')).toBeNull();
  });

  it('names a lesson change’s type and coach for the record', () => {
    expect(lessonTargetNames(coaches)).toEqual({
      [COACH_SARA]: { en: 'Sara', ar: 'سارة' },
      [COACH_ALI]: { en: 'Ali', ar: 'علي' },
      [LT_PRIVATE]: { en: 'One to one', ar: 'فردي' },
      [LT_GROUP]: { en: 'Beginners', ar: 'مبتدئون' },
    });
    expect(lessonTargetNames(undefined)).toEqual({});
  });
});

describe('a start linked in from another screen (§5.5)', () => {
  it('prices an item at today’s prices', () => {
    expect(priceProposalPrefill('price', items, { item: ITEM })).toEqual({
      change: 'price',
      menu_item_id: ITEM,
      prices: [
        { variant_id: V1, price_iqd: 4000 },
        { variant_id: V2, price_iqd: 5000 },
      ],
    });
    // A target the list does not hold is left for the person to pick.
    expect(priceProposalPrefill('price', items, { item: ADDON })).toEqual({ change: 'price', prices: [] });
  });

  it('starts an add-on at its price, a promotion edit with its fields, a rate with its rule or a new one', () => {
    const addons = readTargets({ addons: [{ modifier_id: ADDON, group_name_en: 'Milk', name_en: 'Oat', price_delta_iqd: 500, launched: true, is_active: true }] });
    expect(priceProposalPrefill('addon_price', addons, { addon: ADDON })).toEqual({ change: 'addon_price', addons: [{ modifier_id: ADDON, price_delta_iqd: 500 }] });
    const promos = readTargets({ promotions: [{ promotion_id: PROMO, name_en: 'Mornings', name_ar: 'الصباح', type: 'amount', value: 2000, weekdays: [], scope: {} }] });
    expect(priceProposalPrefill('promotion_edit', promos, { promotion: PROMO })).toMatchObject({ change: 'promotion_edit', promotion_id: PROMO, promotion: { type: 'amount', value: 2000 } });
    expect(priceProposalPrefill('promotion_enable', promos, { promotion: PROMO })).toEqual({ change: 'promotion_enable', promotion_id: PROMO });
    expect(priceProposalPrefill('rate', readTargets({}), {})).toEqual({ change: 'rate', rule: NEW_RULE });
  });

  it('starts the featured discount on the item and discount stored today', () => {
    const t = readTargets({ featured_item_id: ITEM, featured_discount_pct: 15, items: [{ menu_item_id: ITEM, name_en: 'Latte', name_ar: 'لاتيه', sizes: [] }] });
    expect(priceProposalPrefill('featured_discount', t, {})).toEqual({ change: 'featured_discount', menu_item_id: ITEM, discount_pct: 15 });
  });

  it('picks a target and brings its figures, forgetting the last one’s', () => {
    const record = { change: 'price', reason: 'Milk went up', menu_item_id: 'old', prices: [{ variant_id: 'x', price_iqd: 1 }], new_sizes: [{ name_en: 'XL', price_iqd: 1 }] };
    const next = pickTarget('price', items, record, ITEM);
    expect(next).toMatchObject({ reason: 'Milk went up', menu_item_id: ITEM, new_sizes: [] });
    expect(next.prices).toHaveLength(2);
    expect(pickTarget('rate', readTargets({}), { change: 'rate', rule_id: RULE }, '')).toEqual({ change: 'rate', rule_id: '', rule: NEW_RULE });
  });

  it('gives the core check a proposal it accepts once the reason is in', () => {
    const record = { ...priceProposalPrefill('price', items, { item: ITEM }), reason: 'Milk went up', expected_effect: 'Margin back to 70%' };
    expect(validateStep('price_promo', 'propose', record)).toEqual([]);
  });
});

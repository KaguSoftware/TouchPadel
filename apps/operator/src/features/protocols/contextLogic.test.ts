import { describe, expect, it } from 'vitest';
import { COACHING_SHAPES, missingKeys } from '@touch/core/coaching';
import { makeT } from '@touch/i18n';
import {
  NUMBERS_FIGURES,
  analysisPrefill,
  finalizeRecord,
  interviewsRecord,
  lessonNumbersLines,
  numbersAddons,
  numbersPrefill,
  numbersSizes,
  readCost,
  readNumbers,
  readReadiness,
  readTestContext,
  readTournamentContext,
} from './contextLogic';

describe('context reads', () => {
  it('reads the release reads, keeping only what they may say', () => {
    expect(readTestContext({ sizes: [{ variant_id: 'v1', name_en: 'Small', name_ar: 'صغير', lines: [{ name_en: 'Milk', name_ar: 'حليب', qty: 200, unit: 'ml' }] }, { name_en: 'no id' }] }).sizes).toEqual([
      { variant_id: 'v1', name_en: 'Small', name_ar: 'صغير', lines: [{ name_en: 'Milk', name_ar: 'حليب', qty: 200, unit: 'ml' }] },
    ]);
    const cost = readCost({ sizes: [{ variant_id: 'v1', name_en: 'S', name_ar: 'ص', cost_iqd: 850, cost_known: true }], unknown_lines: ['rose syrup', 3] });
    expect(cost.sizes[0]).toMatchObject({ cost_iqd: 850, cost_known: true });
    expect(cost.unknown_lines).toEqual(['rose syrup']);
    const ready = readReadiness({ ready: false, checks: [{ key: 'photo', ok: false }, { key: 'wings', ok: true }], warnings: [{ key: 'allergens' }] });
    expect(ready).toEqual({ ready: false, checks: [{ key: 'photo', ok: false }], warnings: ['allergens'] });
  });

  it('reads the tournament context with no money in it', () => {
    const t = readTournamentContext({
      name_en: 'Cup',
      name_ar: 'كأس',
      class: 'A',
      capacity: { unit: 'pairs', count: 16 },
      ranges: [{ court_ids: ['c1'], court_names: [{ en: 'Court 1', ar: 'ملعب ١' }], from: 'a', to: 'b' }],
      blocked: [{}, {}],
      entry_fee_iqd: 5000,
    });
    expect(t).toMatchObject({ class: 'A', capacity: { unit: 'pairs', count: 16 }, blocked: 2 });
    expect(t.ranges[0]!.courts).toEqual([{ en: 'Court 1', ar: 'ملعب ١' }]);
    expect(JSON.stringify(t)).not.toContain('5000');
  });

  it('reads the numbers and gives the form the proposal’s sizes and add-ons to price', () => {
    const n = readNumbers({
      change: 'price',
      sizes: [
        { variant_id: 'v1', name_en: 'S', name_ar: 'ص', current_price_iqd: 4000, new_price_iqd: 4500, cost_iqd: 900, cost_known: true, margin_before_iqd: 3100, margin_after_iqd: 3600, units_30d: 120, revenue_30d_iqd: 480000 },
        { variant_id: null, name_en: 'XL', name_ar: 'كبير جدًا', current_price_iqd: null, new_price_iqd: 6000 },
      ],
      addons: [{ modifier_id: 'm1', group_name_en: 'Milk', group_name_ar: 'حليب', name_en: 'Oat', name_ar: 'شوفان', current_delta_iqd: 500, new_delta_iqd: 750, count_30d: 40, revenue_30d_iqd: 20000 }],
    });
    expect(numbersSizes(n)).toEqual([{ variant_id: 'v1', name_en: 'S', name_ar: 'ص', current: 4000 }]);
    expect(numbersAddons(n)[0]).toMatchObject({ modifier_id: 'm1', current: 500, group_en: 'Milk' });
    expect(n.promotion).toBeNull();
    expect(n.lesson).toBeNull();
  });
});

// Coaching (0282, operator.md §5.14.2): a lesson change's numbers.
const LESSON = {
  lesson_type_id: 'lt-1',
  coach_id: null,
  kind: 'group',
  name_en: 'Beginners',
  name_ar: 'مبتدئون',
  current_price_iqd: 25000,
  new_price_iqd: 30000,
  current_court_share_iqd: 5000,
  new_court_share_iqd: 6000,
  places_30d: 40,
  owed_30d_iqd: 1200000,
};

describe('a lesson change’s numbers (X28)', () => {
  const strip = (s: string) => s.replace(/[⁦-⁩]/g, '');

  it('reads the lesson block with exactly its COACHING_SHAPES keys, and nothing made up', () => {
    const shape = COACHING_SHAPES.price_promo_numbers_lesson;
    const n = readNumbers({ change: 'lesson_price', sizes: [], addons: [], lesson: LESSON });
    expect(missingKeys({ change: n.change, lesson: n.lesson }, shape)).toEqual([]);
    expect(Object.keys(n.lesson!).sort()).toEqual([...(shape.nested?.lesson ?? [])].sort());
    expect(n.lesson).toEqual(LESSON);
    const bare = readNumbers({ change: 'coach_price', lesson: { lesson_type_id: 'lt-1', coach_id: 'c-1' } }).lesson!;
    expect(bare).toMatchObject({ coach_id: 'c-1', places_30d: null, owed_30d_iqd: null, current_price_iqd: null, name_en: '' });
  });

  it('says the price, the court share and the places sold in 30 days with their value', () => {
    expect(lessonNumbersLines(LESSON, makeT('en'), 'en').map(strip)).toEqual([
      'Price 25,000 IQD → 30,000 IQD',
      'Court share per session 5,000 IQD → 6,000 IQD',
      'Beginners: places sold in the last 30 days 40 · their value 1,200,000 IQD',
    ]);
    const ar = lessonNumbersLines(LESSON, makeT('ar'), 'ar').map(strip);
    expect(ar[2]).toContain('مبتدئون: الأماكن المبيعة خلال 30 يومًا 40 · قيمتها');
    // A coach price leaves the court share, and a figure not sent reads "—".
    const coach = { ...LESSON, coach_id: 'c-1', places_30d: null, owed_30d_iqd: null };
    expect(lessonNumbersLines(coach, makeT('en'), 'en').map(strip)).toEqual([
      'Price 25,000 IQD → 30,000 IQD',
      'Beginners: places sold in the last 30 days — · their value —',
    ]);
  });

  it('opens the numbers with the figures the proposal carries, and sends them only to change them', () => {
    expect(numbersPrefill({ change: 'lesson_price', lesson_type_id: 'lt-1', price_iqd: 30000 })).toEqual({ recommendation: 'go', price_iqd: 30000 });
    expect(numbersPrefill({ change: 'lesson_launch', price_iqd: 30000, court_share_iqd: 0 })).toEqual({ recommendation: 'go', price_iqd: 30000, court_share_iqd: 0 });
    // A coach price removal carries no figure.
    expect(numbersPrefill({ change: 'coach_price', coach_id: 'c-1', price_iqd: null })).toEqual({ recommendation: 'go' });
    expect(NUMBERS_FIGURES).toEqual(expect.arrayContaining(['price_iqd', 'court_share_iqd']));
    const numbers = { recommendation: 'go', price_iqd: 30000, court_share_iqd: 6000, note: 'fine' };
    expect(finalizeRecord('price_promo', 'numbers', numbers, new Map())).toEqual({ recommendation: 'go', note: 'fine' });
    expect(finalizeRecord('price_promo', 'numbers', { ...numbers, recommendation: 'change' }, new Map())).toMatchObject({ price_iqd: 30000, court_share_iqd: 6000 });
  });
});

describe('prefills', () => {
  it('opens the price step with the proposal’s names and a blank price per size', () => {
    expect(analysisPrefill({ name_en: 'Rose latte', name_ar: null }, [{ variant_id: 'v1' }, { variant_id: 'v2' }])).toEqual({
      name_en: 'Rose latte',
      name_ar: 'Rose latte',
      prices: [
        { variant_id: 'v1', price_iqd: null },
        { variant_id: 'v2', price_iqd: null },
      ],
    });
  });

  it('opens the numbers with the proposal’s own figures', () => {
    expect(numbersPrefill({ change: 'rate', rule: { prices: { '60': 30000 } } })).toEqual({ recommendation: 'go', rule_prices: { '60': 30000 } });
    expect(numbersPrefill({ change: 'promotion', promotion: { value: 15 } })).toEqual({ recommendation: 'go', promotion_value: 15 });
    expect(numbersPrefill(null)).toEqual({ recommendation: 'go' });
  });
});

describe('the last touches before sending', () => {
  it('sends a price change for the sizes that change only', () => {
    const current = new Map([
      ['v1', 4000],
      ['v2', 5000],
    ]);
    const record = { change: 'price', menu_item_id: 'i', prices: [{ variant_id: 'v1', price_iqd: 4000 }, { variant_id: 'v2', price_iqd: 5500 }] };
    expect(finalizeRecord('price_promo', 'propose', record, current).prices).toEqual([{ variant_id: 'v2', price_iqd: 5500 }]);
    // A shop launch prices every size, changed or not.
    const launch = { change: 'shop_launch', prices: record.prices };
    expect(finalizeRecord('price_promo', 'propose', launch, current)).toBe(launch);
  });

  it('sends the numbers’ figures only with the recommendation to change them', () => {
    const numbers = { recommendation: 'go', prices: [{ variant_id: 'v1', price_iqd: 1 }], discount_pct: 10, note: 'fine' };
    expect(finalizeRecord('price_promo', 'numbers', numbers, new Map())).toEqual({ recommendation: 'go', note: 'fine' });
    expect(finalizeRecord('price_promo', 'numbers', { ...numbers, recommendation: 'change' }, new Map())).toMatchObject({ discount_pct: 10 });
  });
});

describe('the interviews record', () => {
  it('names every candidate and the one picked, by id only', () => {
    const list = [
      { id: 'c1', picked: false, candidate_name: 'Ali' },
      { id: 'c2', picked: true, candidate_name: 'Sara' },
    ];
    const out = interviewsRecord(list);
    expect(out).toEqual({ record: { candidate_ids: ['c1', 'c2'], picked_id: 'c2' }, state: 'ready' });
    expect(JSON.stringify(out.record)).not.toContain('Sara');
  });

  it('says what is missing: no candidates yet, or none picked', () => {
    expect(interviewsRecord([]).state).toBe('none');
    expect(interviewsRecord([{ id: 'c1', picked: false }])).toEqual({ record: { candidate_ids: ['c1'], picked_id: null }, state: 'noPick' });
  });
});

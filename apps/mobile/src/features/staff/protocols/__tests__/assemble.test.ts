import { describe, expect, it } from 'vitest';
import { stepForm, validateStep } from '@touch/core';
import {
  draftFromRecord,
  emptyDraft,
  exampleVenueDay,
  getAt,
  parseTypedNumber,
  parseTypedTime,
  parseVenueDateTime,
  recordFromDraft,
  setAt,
  templatePath,
  concretePath,
  venueDateTimeText,
  type Draft,
} from '../assemble';

/**
 * A protocol form's draft and the record it sends (build-contracts-2026-09-23
 * §2.8, §7.2): what the person typed becomes exactly the record the server's
 * check hook takes, and a stored record comes back into the same draft.
 */

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

const fieldsOf = (kind: Parameters<typeof stepForm>[0], key: string, opts = {}) => stepForm(kind, key, opts)!.fields;

describe('typed numbers, times and venue instants', () => {
  it('reads Arabic-Indic digits and drops thousands separators', () => {
    expect(parseTypedNumber('١٢٬٥٠٠', true)).toBe(12500);
    expect(parseTypedNumber('25,000', true)).toBe(25000);
    expect(parseTypedNumber(' 7 ', true)).toBe(7);
  });

  it('keeps decimals only where the field allows them', () => {
    expect(parseTypedNumber('12.5', false)).toBe(12.5);
    expect(parseTypedNumber('١٢٫٥', false)).toBe(12.5);
    expect(parseTypedNumber('12.5', true)).toBeNaN();
    expect(parseTypedNumber('twelve', false)).toBeNaN();
  });

  it('reads a clock time and refuses an impossible one', () => {
    expect(parseTypedTime('9:05')).toBe('09:05');
    expect(parseTypedTime('18:30:00')).toBe('18:30');
    expect(parseTypedTime('24:00')).toBeNull();
    expect(parseTypedTime('9')).toBeNull();
  });

  it('writes a typed venue time with the venue offset, whatever the phone zone', () => {
    expect(parseVenueDateTime('2026-10-02 18:00')).toBe('2026-10-02T18:00:00+03:00');
    expect(parseVenueDateTime('٢٠٢٦/١٠/٠٢ 9:30')).toBe('2026-10-02T09:30:00+03:00');
    expect(parseVenueDateTime('2026-10-02')).toBeNull();
    expect(parseVenueDateTime('2026-02-30 10:00')).toBeNull();
  });

  it('shows a stored instant as the venue reads it, and reads it back to the same instant', () => {
    const text = venueDateTimeText('2026-10-02T15:00:00Z');
    expect(text).toBe('2026-10-02 18:00');
    expect(Date.parse(parseVenueDateTime(text)!)).toBe(Date.parse('2026-10-02T15:00:00Z'));
  });

  it('gives the date hint a day in the venue calendar', () => {
    // 22:30 UTC is already the next day at the venue.
    expect(exampleVenueDay(Date.parse('2026-10-01T22:30:00Z'), 1)).toBe('2026-10-03');
  });
});

describe('empty drafts', () => {
  it('starts a new item with one ingredient line and one size to fill', () => {
    const draft = emptyDraft(fieldsOf('product_release', 'propose'));
    expect(draft.lines).toHaveLength(1);
    expect(draft.sizes).toHaveLength(1);
    expect(draft.name_en).toBe('');
  });

  it('starts optional objects blank and lists with no minimum empty', () => {
    const draft = emptyDraft(fieldsOf('tournament', 'plan', { variant: 'type1' }));
    expect(draft.sponsor).toEqual({ name: '', contact: '', contribution_iqd: '', branding: '', invoice: false });
    expect(draft.ranges).toHaveLength(1);
  });
});

describe('recordFromDraft', () => {
  it('sends a new item exactly as the propose check takes it', () => {
    const fields = fieldsOf('product_release', 'propose');
    const draft: Draft = {
      ...emptyDraft(fields),
      name_en: '  Pistachio latte ',
      item_kind: 'drink',
      lines: [
        { ingredient_id: UUID_A, label: '', qty: '١٨', unit: 'g' },
        { ingredient_id: '', label: 'Pistachio cream', qty: '20', unit: 'g' },
      ],
      sizes: [{ name_en: 'Regular', name_ar: '' }],
    };
    const record = recordFromDraft(fields, draft);
    expect(record).toEqual({
      name_en: 'Pistachio latte',
      item_kind: 'drink',
      lines: [
        { ingredient_id: UUID_A, qty: 18, unit: 'g' },
        { label: 'Pistachio cream', qty: 20, unit: 'g' },
      ],
      sizes: [{ name_en: 'Regular' }],
    });
    expect(validateStep('product_release', 'propose', record, {}, { photos: 0 })).toEqual([]);
  });

  it('marks a mistyped optional field invalid instead of dropping it', () => {
    const fields = fieldsOf('tournament', 'plan', { variant: 'type1' });
    const record = recordFromDraft(fields, { ...emptyDraft(fields), entry_fee_iqd: 'ten' });
    expect(record.entry_fee_iqd).toBeNaN();
    const issues = validateStep('tournament', 'plan', record, { variant: 'type1' });
    expect(issues).toContainEqual({ field: 'entry_fee_iqd', code: 'RECORD_INVALID' });
  });

  it('leaves out an optional object nobody filled, switches included', () => {
    const fields = fieldsOf('tournament', 'plan', { variant: 'type1' });
    const record = recordFromDraft(fields, emptyDraft(fields));
    expect(record).not.toHaveProperty('sponsor');
    expect(record).not.toHaveProperty('prize');
  });

  it('drops the rows of a fixed list the person left blank', () => {
    const fields = fieldsOf('price_promo', 'propose', { change: 'price' });
    const draft: Draft = {
      ...emptyDraft(fields),
      change: 'price',
      menu_item_id: UUID_A,
      reason: 'Costs went up',
      expected_effect: 'Same sales',
      prices: [
        { variant_id: UUID_A, price_iqd: '6500' },
        { variant_id: UUID_B, price_iqd: '' },
      ],
    };
    const record = recordFromDraft(fields, draft, { fixedKeys: { prices: 'variant_id' } });
    expect(record.prices).toEqual([{ variant_id: UUID_A, price_iqd: 6500 }]);
    expect(validateStep('price_promo', 'propose', record)).toEqual([]);
  });

  it('turns weekday chips into numbers and a price table into a duration map', () => {
    const fields = fieldsOf('price_promo', 'propose', { change: 'rate' });
    const rule = {
      ...(emptyDraft(fields).rule as Draft),
      name: 'Evenings',
      days_of_week: ['5', '6'],
      start_time: '18:00',
      end_time: '23:00',
      prices: [
        { minutes: '60', price: '30,000' },
        { minutes: '', price: '' },
      ],
      is_active: true,
    };
    const record = recordFromDraft(fields, { ...emptyDraft(fields), change: 'rate', reason: 'r', expected_effect: 'e', rule });
    expect(record.rule).toEqual({
      name: 'Evenings',
      days_of_week: [5, 6],
      start_time: '18:00',
      end_time: '23:00',
      prices: { '60': 30000 },
      is_active: true,
    });
    expect(validateStep('price_promo', 'propose', record)).toEqual([]);
  });

  it('marks a price table row with no length invalid', () => {
    const fields = fieldsOf('price_promo', 'numbers', { change: 'rate' });
    const record = recordFromDraft(fields, {
      ...emptyDraft(fields),
      recommendation: 'go',
      rule_prices: [{ minutes: '', price: '20000' }],
    });
    expect(validateStep('price_promo', 'numbers', record, { change: 'rate' })).toContainEqual({
      field: 'rule_prices',
      code: 'RECORD_INVALID',
    });
  });
});

describe('draftFromRecord', () => {
  it('brings a sent plan back into the same draft, times in venue time', () => {
    const fields = fieldsOf('tournament', 'plan', { variant: 'type2' });
    const record = {
      class: 'B',
      name_en: 'Friday social',
      name_ar: 'اجتماعي الجمعة',
      ranges: [{ court_ids: [UUID_A], from: '2026-10-02T15:00:00Z', to: '2026-10-02T19:00:00Z' }],
      capacity: { unit: 'pairs', count: 16 },
    };
    const draft = draftFromRecord(fields, record);
    expect(draft.ranges).toEqual([{ court_ids: [UUID_A], from: '2026-10-02 18:00', to: '2026-10-02 22:00' }]);
    expect(draft.capacity).toEqual({ unit: 'pairs', count: '16' });
    const again = recordFromDraft(fields, draft);
    expect(again.ranges).toEqual([
      { court_ids: [UUID_A], from: '2026-10-02T18:00:00+03:00', to: '2026-10-02T22:00:00+03:00' },
    ]);
    expect(validateStep('tournament', 'plan', again, { variant: 'type2' })).toEqual([]);
  });

  it('fills what the record lacks with the empty value', () => {
    const fields = fieldsOf('hiring', 'open_position');
    const draft = draftFromRecord(fields, { role: 'barista' });
    expect(draft.role).toBe('barista');
    expect(draft.why).toBe('');
  });
});

describe('editing a draft', () => {
  it('replaces one value and copies only the path to it', () => {
    const draft: Draft = { lines: [{ qty: '1' }, { qty: '2' }], name_en: 'x' };
    const next = setAt(draft, ['lines', 1, 'qty'], '3');
    expect(getAt(next, ['lines', 1, 'qty'])).toBe('3');
    expect(getAt(draft, ['lines', 1, 'qty'])).toBe('2');
    expect((next.lines as Draft[])[0]).toBe((draft.lines as Draft[])[0]);
  });

  it('names a field by its template path and by its concrete path', () => {
    expect(templatePath(['lines', 0, 'qty'])).toBe('lines.qty');
    expect(concretePath(['lines', 0, 'qty'])).toBe('lines.0.qty');
  });
});

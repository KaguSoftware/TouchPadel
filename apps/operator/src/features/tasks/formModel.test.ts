import { describe, expect, it } from 'vitest';
import { GENERIC_STEP_FORM, startForm, stepForm, validateStep } from '@touch/core/protocols';
import { emptyDraft, fromRecord, getIn, hintFor, isoToLocal, localToIso, setIn, toRecord } from './formModel';

// The draft behind every /tasks form: empty drafts, the record a draft stands
// for, and back again. The server's check hooks judge the record; these only
// have to hand them what the person typed, in the shape §2.8 names.

describe('emptyDraft', () => {
  it('starts a required list with one empty row and leaves an optional group out', () => {
    const draft = emptyDraft(startForm('product_release').fields);
    expect(Array.isArray(draft.lines) && draft.lines.length).toBe(1);
    expect(Array.isArray(draft.sizes) && draft.sizes.length).toBe(1);
    expect(draft.name_en).toBe('');
    const plan = emptyDraft(startForm('tournament', { variant: 'type1' }).fields);
    expect(plan.sponsor).toBeNull();
    expect(plan.prize).toBeNull();
    expect(plan.capacity).toEqual({ unit: '', count: null });
  });
});

describe('toRecord', () => {
  it('leaves out what was not filled in and drops the rows nobody touched', () => {
    const form = startForm('product_release');
    const draft = {
      ...emptyDraft(form.fields),
      name_en: '  Date cake ',
      item_kind: 'dessert',
      lines: [
        { ingredient_id: '', label: 'Dates', qty: 120, unit: 'g' },
        { ingredient_id: '', label: '', qty: null, unit: '' },
      ],
      sizes: [{ name_en: 'Slice', name_ar: '' }],
    };
    expect(toRecord(form.fields, draft)).toEqual({
      name_en: 'Date cake',
      item_kind: 'dessert',
      lines: [{ label: 'Dates', qty: 120, unit: 'g' }],
      sizes: [{ name_en: 'Slice' }],
    });
    // And the core validator takes it as a whole proposal.
    expect(validateStep('product_release', 'propose', toRecord(form.fields, draft))).toEqual([]);
  });

  it('turns a price map back into the {minutes: price} object the rate takes', () => {
    const form = startForm('price_promo', { change: 'rate' });
    const draft = emptyDraft(form.fields);
    const rule = { ...(draft.rule as Record<string, unknown>), prices: [{ duration: 60, price: 20000 }, { duration: null, price: null }] };
    const record = toRecord(form.fields, { ...draft, rule });
    expect((record.rule as { prices: unknown }).prices).toEqual({ '60': 20000 });
  });

  it('reads a date-time in the venue zone and sends an instant', () => {
    expect(localToIso('2026-10-02T19:30', 'Asia/Baghdad')).toBe('2026-10-02T16:30:00.000Z');
    expect(isoToLocal('2026-10-02T16:30:00.000Z', 'Asia/Baghdad')).toBe('2026-10-02T19:30');
    expect(localToIso('not a time')).toBeNull();
  });

  it('keeps an optional group once added, and leaves it out while empty', () => {
    const fields = startForm('tournament', { variant: 'type1' }).fields;
    const base = emptyDraft(fields);
    expect(toRecord(fields, { ...base, sponsor: { name: '', contact: '', contribution_iqd: null, branding: '', invoice: null } }).sponsor).toBeUndefined();
    expect(toRecord(fields, { ...base, sponsor: { name: 'Zain', contact: '0770', contribution_iqd: 500000, branding: '', invoice: true } }).sponsor).toEqual({
      name: 'Zain',
      contact: '0770',
      contribution_iqd: 500000,
      invoice: true,
    });
  });
});

describe('fromRecord', () => {
  it('prefills a resubmission with what was sent, times as the box shows them', () => {
    const fields = startForm('price_promo', { change: 'promotion' }).fields;
    const draft = fromRecord(fields, {
      change: 'promotion',
      reason: 'Slow Tuesdays',
      expected_effect: 'More bookings',
      promotion: { name_en: 'Tuesday', name_ar: 'الثلاثاء', type: 'percent', value: 10, weekdays: [2], hour_from: '16:00:00', hour_to: '19:00:00', scope: {} },
      extra: 'dropped',
    });
    expect(draft.reason).toBe('Slow Tuesdays');
    expect(getIn(draft, ['promotion', 'hour_from'])).toBe('16:00');
    expect(getIn(draft, ['promotion', 'weekdays'])).toEqual([2]);
    expect('extra' in draft).toBe(false);
  });

  it('round-trips an owner-added step', () => {
    const draft = fromRecord(GENERIC_STEP_FORM.fields, { note: 'Done at 9' });
    expect(toRecord(GENERIC_STEP_FORM.fields, draft)).toEqual({ note: 'Done at 9' });
  });
});

describe('paths', () => {
  it('sets a value deep inside a list without touching the rest', () => {
    const draft = { lines: [{ qty: 1 }, { qty: 2 }] };
    const next = setIn(draft, ['lines', 1, 'qty'], 5) as typeof draft;
    expect(next.lines[1]!.qty).toBe(5);
    expect(draft.lines[1]!.qty).toBe(2);
    expect(next.lines[0]).toBe(draft.lines[0]);
  });

  it('names a control the way the server hints it', () => {
    expect(hintFor(['name_en'])).toEqual({ field: 'name_en' });
    expect(hintFor(['promotion', 'public_code'])).toEqual({ field: 'promotion.public_code' });
    expect(hintFor(['ranges', 2, 'from'])).toEqual({ field: 'ranges', index: 2 });
  });

  it('matches the field list core gives for a step', () => {
    expect(stepForm('product_release', 'test')?.photosMin).toBe(1);
  });
});

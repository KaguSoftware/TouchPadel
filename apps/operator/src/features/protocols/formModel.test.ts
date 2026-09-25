import { describe, expect, it } from 'vitest';
import { startForm, stepForm, validateStep } from '@touch/core/protocols';
import { cleanRecord, fromLocalInput, getAt, hintOf, initialValue, issueAt, labelIds, mintKey, setAt, toLocalInput, toTimeInput } from './formModel';

describe('a form’s value', () => {
  it('opens with a blank for every field and one row to fill in a list that needs one', () => {
    const form = startForm('product_release');
    const v = initialValue(form.fields);
    expect(v.name_en).toBe('');
    expect(v.lines).toEqual([{ ingredient_id: '', label: '', qty: null, unit: 'g' }]);
    expect(v.sizes).toEqual([{ name_en: '', name_ar: '' }]);
    expect(initialValue(startForm('tournament', { variant: 'type1' }).fields).capacity).toEqual({ unit: 'players', count: null });
    expect(initialValue(stepForm('price_promo', 'apply')!.fields).when).toBe('now');
  });

  it('overlays a record sent before, blank where it had nothing', () => {
    const form = startForm('product_release');
    const v = initialValue(form.fields, { name_en: 'Rose latte', name_ar: null, lines: [{ ingredient_id: 'i1', qty: 12 }], extra: 1 });
    expect(v.name_en).toBe('Rose latte');
    expect(v.name_ar).toBe('');
    expect(v.lines).toEqual([{ ingredient_id: 'i1', label: '', qty: 12, unit: 'g' }]);
    expect(v.extra).toBe(1);
  });

  it('sends a clean record: trimmed, blanks and untouched rows and objects left out', () => {
    const form = startForm('tournament', { variant: 'type1' });
    const v = initialValue(form.fields, {
      class: 'A',
      name_en: ' Summer Cup ',
      name_ar: 'كأس الصيف',
      format: 'americano',
      ranges: [
        { court_ids: ['0c000000-0000-4000-8000-000000000001'], from: '2099-10-09T15:00:00.000Z', to: '2099-10-09T19:00:00.000Z' },
        { court_ids: [], from: '', to: '' },
      ],
      capacity: { unit: 'pairs', count: 16 },
      prize: { text: '', iqd: null },
    });
    const record = cleanRecord(form.fields, v);
    expect(record.name_en).toBe('Summer Cup');
    expect(record.ranges).toHaveLength(1);
    expect(record).not.toHaveProperty('prize');
    expect(record).not.toHaveProperty('sponsor');
    expect(record).not.toHaveProperty('entry_fee_iqd');
    expect(validateStep('tournament', 'plan', record, { variant: 'type1' })).toEqual([]);
  });

  it('keeps an optional object once any of it is filled, so the core check can name what is missing', () => {
    const form = stepForm('product_release', 'marketing')!;
    const record = cleanRecord(form.fields, initialValue(form.fields, { highlights_en: 'Fresh', highlights_ar: 'طازج', hero: { en: 'New!', ar: '' } }));
    expect(record.hero).toEqual({ en: 'New!' });
    expect(validateStep('product_release', 'marketing', record)).toEqual([{ field: 'hero.ar', code: 'RECORD_INVALID' }]);
  });

  it('keeps keys the form does not list (a resubmission’s fixed change)', () => {
    const form = stepForm('price_promo', 'propose', { change: 'rate' })!;
    const record = cleanRecord(form.fields.filter((f) => f.name !== 'change'), { change: 'rate', reason: ' cheaper mornings ' });
    expect(record).toMatchObject({ change: 'rate', reason: 'cheaper mornings' });
  });
});

describe('paths and hints', () => {
  it('reads and writes by path without touching the original', () => {
    const v = { lines: [{ qty: 1 }], hero: { en: 'a' } };
    const next = setAt(v, ['lines', 0, 'qty'], 2) as typeof v;
    expect(next.lines[0]!.qty).toBe(2);
    expect(v.lines[0]!.qty).toBe(1);
    expect(getAt(setAt(v, ['hero', 'ar'], 'ب'), ['hero'])).toEqual({ en: 'a', ar: 'ب' });
    expect(getAt(v, ['nope', 3, 'x'])).toBeUndefined();
  });

  it('names a field the way the server’s hint does', () => {
    expect(hintOf(['name_en'])).toEqual({ field: 'name_en' });
    expect(hintOf(['promotion', 'public_code'])).toEqual({ field: 'promotion.public_code' });
    expect(hintOf(['lines', 2, 'qty'])).toEqual({ field: 'lines', index: 2 });
    const issues = [{ field: 'lines', code: 'RECORD_INVALID' as const, index: 1 }, { field: 'rule.end_time', code: 'RECORD_INVALID' as const }];
    expect(issueAt(issues, ['lines', 1, 'qty'])).toBe(issues[0]);
    expect(issueAt(issues, ['lines', 0, 'qty'])).toBeNull();
    expect(issueAt(issues, ['rule', 'end_time'])).toBe(issues[1]);
    expect(issueAt(issues, ['lines'])).toBeNull();
  });

  it('looks a label up most specific first', () => {
    expect(labelIds(['notes'])).toEqual(['notes']);
    expect(labelIds(['sponsor', 'contribution_iqd'])).toEqual(['sponsor_contribution_iqd', 'contribution_iqd']);
    expect(labelIds(['lines', 3, 'qty'])).toEqual(['lines_qty', 'qty']);
  });
});

describe('times and keys', () => {
  it('turns a local date-time into an instant and back', () => {
    const iso = fromLocalInput('2099-10-09T18:30');
    expect(iso).toMatch(/^2099-10-09T\d{2}:30:00\.000Z$/);
    expect(toLocalInput(iso)).toBe('2099-10-09T18:30');
    expect(fromLocalInput('')).toBe('');
    expect(toLocalInput('not a date')).toBe('');
    expect(toTimeInput('07:30:00')).toBe('07:30');
    expect(toTimeInput(null)).toBe('');
  });

  it('mints one key per form, with its intent (§5.3)', () => {
    const a = mintKey('protocol.start');
    expect(a).toMatch(/^protocol\.start:.+/);
    expect(mintKey('protocol.start')).not.toBe(a);
  });
});

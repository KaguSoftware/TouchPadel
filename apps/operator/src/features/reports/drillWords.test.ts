import { describe, expect, it } from 'vitest';
import { t, type Locale, type MessageKey } from '@touch/i18n';
import { drillWords } from './drillWords';
import type { DrillTransaction } from './reportPayloads';

// The drill window used to print the server's English label with raw codes
// ("refund · quality · cash") in both languages. These pin the words written
// from the structured detail instead.

const tx = (detail: Record<string, unknown> | null, label = 'raw label'): DrillTransaction => ({
  id: '1',
  at: null,
  kind: 'refund',
  label,
  amountIqd: 1000,
  staffName: null,
  detail,
});
const words = (d: Record<string, unknown> | null, locale: Locale = 'en') =>
  drillWords(tx(d), (key: MessageKey, params) => t(locale, key, params), locale);

describe('drillWords', () => {
  it('says a refund in words, translating a known reason and the method', () => {
    expect(words({ sub: 'refund', reason: 'quality', method: 'cash' })).toEqual({ kind: 'Refund', text: 'Quality issue · Cash' });
    const ar = words({ sub: 'refund', reason: 'quality', method: 'cash' }, 'ar');
    expect(ar.text).not.toMatch(/quality|cash/);
  });

  it('keeps a reason staff typed as written', () => {
    expect(words({ sub: 'waste', movement: 'waste_spill', reason: 'dropped the bag', ingredientEn: 'Milk', ingredientAr: 'حليب', qty: 500, unit: 'ml' }).text).toBe(
      'Milk · 500 ml · dropped the bag',
    );
  });

  it('names discounts by kind, bookings by court and guest, and orders by where they came from', () => {
    expect(words({ sub: 'discount', adjKind: 'discount_percent', reason: 'promotion' }).text).toBe('Percentage off · Promotion');
    expect(words({ sub: 'booking', status: 'no_show', courtEn: 'Court 2', courtAr: 'الملعب 2', guest: 'Ali' }).text).toBe('Court 2 · Ali · No-show');
    expect(words({ sub: 'booking', status: 'no_show', courtEn: 'Court 2', courtAr: 'الملعب 2', guest: 'Ali' }, 'ar').text).toContain('الملعب 2');
    expect(words({ sub: 'order', source: 'guest_web', table: '4' }).text).toBe('QR order · Table 4');
  });

  it('falls back to the server label when there is no detail', () => {
    expect(words(null)).toEqual({ kind: null, text: 'raw label' });
  });
});

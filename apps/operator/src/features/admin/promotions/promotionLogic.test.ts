import { describe, it, expect } from 'vitest';
import {
  EMPTY_DRAFT,
  fromRow,
  hasScope,
  isDirty,
  isoToDateInput,
  lifecycle,
  timeToInput,
  toRpcArgs,
  toggleId,
  toggleWeekday,
  validateDraft,
} from './promotionLogic';
import type { PromotionRow } from './promotionsApi';

const row: PromotionRow = {
  id: 'p1',
  name_en: 'Happy hour',
  name_ar: 'ساعة السعادة',
  type: 'percent',
  value: 20,
  starts_at: '2026-09-01T00:00:00+03:00',
  ends_at: '2026-09-30T23:59:59+03:00',
  weekdays: [4, 1, 2],
  hour_from: '16:00:00',
  hour_to: '19:00:00',
  scope: { categoryIds: ['c1'] },
  limits: { total: 100 },
  auto: true,
  public_code: null,
  code_single_use: false,
  enabled: true,
};

describe('fromRow / toRpcArgs', () => {
  it('maps a row into an editable draft with the contract defaults filled', () => {
    const d = fromRow(row);
    expect(d.name).toEqual({ en: 'Happy hour', ar: 'ساعة السعادة' });
    expect(d.weekdays).toEqual([1, 2, 4]);
    expect(d.hourFrom).toBe('16:00');
    expect(d.hourTo).toBe('19:00');
    expect(d.scope).toEqual({ courtIds: [], categoryIds: ['c1'], itemIds: [] });
    expect(d.limits).toEqual({ total: 100, perCustomer: null, minSpendIqd: null });
  });

  it('sends p_ + the 0067 column names', () => {
    const args = toRpcArgs(fromRow(row), 'p1');
    expect(Object.keys(args).sort()).toEqual(
      [
        'p_auto', 'p_code_single_use', 'p_enabled', 'p_ends_at', 'p_hour_from', 'p_hour_to', 'p_id', 'p_limits',
        'p_name_ar', 'p_name_en', 'p_public_code', 'p_scope', 'p_starts_at', 'p_type', 'p_value', 'p_weekdays',
      ].sort(),
    );
    expect(args.p_id).toBe('p1');
    expect(args.p_weekdays).toEqual([1, 2, 4]);
    expect(args.p_scope).toEqual({ courtIds: [], categoryIds: ['c1'], itemIds: [] });
  });

  it('sends null for blank dates and hours, and null id for a new promotion', () => {
    const args = toRpcArgs(EMPTY_DRAFT, null);
    expect(args.p_id).toBeNull();
    expect(args.p_starts_at).toBeNull();
    expect(args.p_ends_at).toBeNull();
    expect(args.p_hour_from).toBeNull();
    expect(args.p_hour_to).toBeNull();
  });

  it('makes an end date inclusive of its whole day', () => {
    const args = toRpcArgs({ ...EMPTY_DRAFT, endsOn: '2026-09-12' }, null);
    const ends = new Date(args.p_ends_at as string);
    expect(ends.getDate()).toBe(12);
    expect(ends.getHours()).toBe(23);
  });
});

describe('date and time inputs', () => {
  it('formats to the input value types and treats null as blank', () => {
    expect(isoToDateInput(null)).toBe('');
    expect(isoToDateInput('garbage')).toBe('');
    expect(isoToDateInput(new Date(2026, 8, 3, 12).toISOString())).toBe('2026-09-03');
    expect(timeToInput('16:00:00')).toBe('16:00');
    expect(timeToInput(null)).toBe('');
  });
});

describe('validateDraft', () => {
  const ok = fromRow(row);
  it('accepts a complete draft', () => {
    expect(validateDraft(ok)).toEqual([]);
  });
  it('requires both names', () => {
    expect(validateDraft({ ...ok, name: { en: 'x', ar: '' } })).toContain('name');
  });
  it('requires a positive value and a sane percent', () => {
    expect(validateDraft({ ...ok, value: 0 })).toContain('value');
    expect(validateDraft({ ...ok, type: 'percent', value: 150 })).toContain('percent');
    expect(validateDraft({ ...ok, type: 'amount', value: 150 })).toEqual([]);
  });
  it('refuses an end before the start and an hour window that ends first', () => {
    expect(validateDraft({ ...ok, startsOn: '2026-09-10', endsOn: '2026-09-01' })).toContain('dates');
    expect(validateDraft({ ...ok, hourFrom: '19:00', hourTo: '16:00' })).toContain('hours');
  });
});

describe('lifecycle', () => {
  const now = new Date('2026-09-15T12:00:00Z');
  it('is live inside its window when enabled', () => {
    expect(lifecycle(row, now)).toBe('live');
  });
  it('is scheduled before it starts', () => {
    expect(lifecycle({ ...row, starts_at: '2026-10-01T00:00:00Z' }, now)).toBe('scheduled');
  });
  it('is expired after its end even when enabled — automatic expiry', () => {
    expect(lifecycle({ ...row, ends_at: '2026-09-01T00:00:00Z' }, now)).toBe('expired');
  });
  it('is off when disabled, unless it already expired', () => {
    expect(lifecycle({ ...row, enabled: false }, now)).toBe('disabled');
    expect(lifecycle({ ...row, enabled: false, ends_at: '2026-09-01T00:00:00Z' }, now)).toBe('expired');
  });
  it('is live with no dates at all', () => {
    expect(lifecycle({ enabled: true, starts_at: null, ends_at: null }, now)).toBe('live');
  });
});

describe('small helpers', () => {
  it('detects a narrowed scope', () => {
    expect(hasScope({ courtIds: [], categoryIds: [], itemIds: [] })).toBe(false);
    expect(hasScope({ courtIds: ['c'], categoryIds: [], itemIds: [] })).toBe(true);
  });
  it('toggles ids and weekdays (sorted)', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleWeekday([5], 1)).toEqual([1, 5]);
    expect(toggleWeekday([1, 5], 5)).toEqual([1]);
  });
  it('compares drafts structurally', () => {
    expect(isDirty(EMPTY_DRAFT, { ...EMPTY_DRAFT })).toBe(false);
    expect(isDirty(EMPTY_DRAFT, { ...EMPTY_DRAFT, value: 5 })).toBe(true);
  });
});

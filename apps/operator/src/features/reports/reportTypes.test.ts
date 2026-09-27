import { describe, expect, it } from 'vitest';
import { formatCell, inferKind, normalizeColumns } from './reportTypes';

const unit = { percent: (n: string) => `${n}%`, minutes: (n: string) => `${n} min`, hours: (n: string) => `${n} h` };

describe('inferKind', () => {
  it('trusts a declared kind first, then the key suffix, then the sample', () => {
    expect(inferKind('foo', 'percent', 12)).toBe('percent');
    expect(inferKind('revenue_iqd', null, 1)).toBe('money');
    expect(inferKind('occupancy_pct', undefined, 1)).toBe('percent');
    expect(inferKind('avg_prep_min', null, 1)).toBe('minutes');
    expect(inferKind('available_hours', null, 1)).toBe('hours');
    expect(inferKind('expires_on', null, '2026-09-03')).toBe('date');
    expect(inferKind('at', null, '2026-09-03T10:00:00Z')).toBe('datetime');
    expect(inferKind('bookings', null, 3)).toBe('number');
    expect(inferKind('court', null, 'Court 1')).toBe('text');
  });
  it('ignores an unknown declared kind', () => {
    expect(inferKind('qty', 'weird', 2)).toBe('number');
  });
});

describe('normalizeColumns', () => {
  it('accepts bare keys and specs, carrying both labels', () => {
    const cols = normalizeColumns(['court', { key: 'revenue_iqd', label_en: 'Rev', label_ar: 'إيراد' }], [{ court: 'A', revenue_iqd: 10 }]);
    expect(cols).toEqual([
      { key: 'court', kind: 'text', labelEn: null, labelAr: null },
      { key: 'revenue_iqd', kind: 'money', labelEn: 'Rev', labelAr: 'إيراد' },
    ]);
  });
  it('falls back to the first row, hiding ids and putting the time first', () => {
    const cols = normalizeColumns(null, [{ amount_iqd: 5, court_id: 'x', staffId: 's', at: '2026-01-01T00:00:00Z', kind: 'sale', id: 'y' }]);
    expect(cols.map((c) => c.key)).toEqual(['at', 'kind', 'amount_iqd']);
  });
  it('returns no columns for no data', () => {
    expect(normalizeColumns(undefined, [])).toEqual([]);
  });
});

describe('formatCell', () => {
  it('formats money as integer IQD and never invents decimals', () => {
    expect(formatCell(15000, 'money', 'en', unit)).toBe('15,000 IQD');
    expect(formatCell(null, 'money', 'en', unit)).toBe('—');
  });
  it('appends the localised unit for percent, minutes and hours', () => {
    expect(formatCell(42.5, 'percent', 'en', unit)).toBe('42.5%');
    expect(formatCell(7, 'minutes', 'en', unit)).toBe('7 min');
    expect(formatCell(3, 'hours', 'en', unit)).toBe('3 h');
  });
  it('passes strings through and stringifies objects', () => {
    expect(formatCell('cash', 'text', 'en', unit)).toBe('cash');
    expect(formatCell({ a: 1 }, 'text', 'en', unit)).toBe('{"a":1}');
  });
});

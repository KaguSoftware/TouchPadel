import { describe, expect, it } from 'vitest';
import { ar } from '../catalogs/ar';
import { en } from '../catalogs/en';
import { makeT, t } from '../t';

describe('t()', () => {
  it('looks up nested keys per locale', () => {
    expect(t('en', 'common.ok')).toBe('OK');
    expect(t('ar', 'common.ok')).toBe('حسنًا');
  });

  it('interpolates {placeholders} in both locales', () => {
    expect(t('en', 'degraded.bookingRefused', { phone: '+964 770 000 0000' })).toContain(
      '+964 770 000 0000',
    );
    expect(t('ar', 'degraded.bookingRefused', { phone: '+964 770 000 0000' })).toContain(
      '+964 770 000 0000',
    );
  });

  it('leaves unknown placeholders visible rather than erasing them', () => {
    expect(t('en', 'cafe.tableLabel', {})).toBe('Table {table}');
  });

  it('makeT binds a locale', () => {
    const tr = makeT('ar');
    expect(tr('cafe.callWaiter')).toBe('استدعاء النادل');
  });

  it('catalogs mirror each other key-for-key', () => {
    const keys = (obj: object, prefix = ''): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        typeof v === 'string' ? [`${prefix}${k}`] : keys(v as object, `${prefix}${k}.`),
      );
    expect(keys(ar).sort()).toEqual(keys(en).sort());
  });
});

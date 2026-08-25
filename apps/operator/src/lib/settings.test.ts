import { describe, expect, it } from 'vitest';
import {
  CAFE_SETTING_DEFAULTS,
  CAFE_SETTING_KEYS,
  OWNER_ONLY_SETTING_KEYS,
  PUBLIC_SETTING_KEYS,
  foldCafeSettings,
} from './settings';

describe('foldCafeSettings', () => {
  it('returns the 0029 defaults for an empty table', () => {
    expect(foldCafeSettings([])).toEqual(CAFE_SETTING_DEFAULTS);
  });

  it('never shares array instances with the defaults', () => {
    const a = foldCafeSettings([]);
    a.ticker_en.push('x');
    expect(CAFE_SETTING_DEFAULTS.ticker_en).toEqual([]);
    expect(foldCafeSettings([]).ticker_en).toEqual([]);
  });

  it('applies stored values of the right shape', () => {
    const s = foldCafeSettings([
      { key: 'hero_mode', value: 'featured' },
      { key: 'featured_item_id', value: '2f4e5c1a-0000-4000-8000-000000000001' },
      { key: 'featured_discount_pct', value: 15 },
      { key: 'ticker_ar', value: ['أهلاً', 'وسهلاً'] },
      { key: 'bell_tutorial_enabled', value: false },
      { key: 'telegram_chat_id', value: '-1001234567890' },
      { key: 'analytics_business_day_start_hour', value: 6 },
    ]);
    expect(s.hero_mode).toBe('featured');
    expect(s.featured_item_id).toBe('2f4e5c1a-0000-4000-8000-000000000001');
    expect(s.featured_discount_pct).toBe(15);
    expect(s.ticker_ar).toEqual(['أهلاً', 'وسهلاً']);
    expect(s.bell_tutorial_enabled).toBe(false);
    expect(s.telegram_chat_id).toBe('-1001234567890');
    expect(s.analytics_business_day_start_hour).toBe(6);
  });

  it('ignores unknown keys and wrongly-shaped values', () => {
    const s = foldCafeSettings([
      { key: 'not_a_setting', value: 1 },
      { key: 'hero_mode', value: 5 },
      { key: 'featured_discount_pct', value: '15' },
      { key: 'ticker_en', value: 'not an array' },
      { key: 'ticker_ar', value: [1, 2] },
      { key: 'bell_tutorial_enabled', value: 'yes' },
      { key: 'featured_label_en', value: null },
    ]);
    expect(s).toEqual(CAFE_SETTING_DEFAULTS);
  });

  it('accepts null only on nullable keys', () => {
    const s = foldCafeSettings([
      { key: 'hero_media_path', value: null },
      { key: 'telegram_chat_id', value: null },
      { key: 'telegram_lang', value: null },
    ]);
    expect(s.hero_media_path).toBeNull();
    expect(s.telegram_chat_id).toBeNull();
    expect(s.telegram_lang).toBe('ar');
  });
});

describe('key registries', () => {
  it('owner-only and public keys are real keys, and public never includes telegram', () => {
    for (const k of [...OWNER_ONLY_SETTING_KEYS, ...PUBLIC_SETTING_KEYS]) {
      expect(CAFE_SETTING_KEYS).toContain(k);
    }
    for (const k of PUBLIC_SETTING_KEYS) expect(k.startsWith('telegram_')).toBe(false);
  });
});

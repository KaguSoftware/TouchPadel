import { describe, expect, it } from 'vitest';
import { t, type MessageKey } from '@touch/i18n';
import { customerFlagLabel, presetPeriod } from './kit';

describe('presetPeriod', () => {
  const wed = new Date(2026, 8, 2, 15, 30); // Wed 2 Sep 2026, local
  it('today / yesterday are single days', () => {
    expect(presetPeriod('today', wed)).toEqual({ from: '2026-09-02', to: '2026-09-02' });
    expect(presetPeriod('yesterday', wed)).toEqual({ from: '2026-09-01', to: '2026-09-01' });
  });
  it('weeks start on Sunday and last week is a full seven days', () => {
    expect(presetPeriod('thisWeek', wed)).toEqual({ from: '2026-08-30', to: '2026-09-02' });
    expect(presetPeriod('lastWeek', wed)).toEqual({ from: '2026-08-23', to: '2026-08-29' });
  });
  it('months and the trailing thirty days', () => {
    expect(presetPeriod('thisMonth', wed)).toEqual({ from: '2026-09-01', to: '2026-09-02' });
    expect(presetPeriod('lastMonth', wed)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(presetPeriod('last30', wed)).toEqual({ from: '2026-08-04', to: '2026-09-02' });
  });
});

describe('customerFlagLabel (open matches §5.15)', () => {
  const tr = (key: string) => t('en', key as MessageKey);
  it('translates a match ban’s code, and leaves every other label as the desk typed it', () => {
    expect(customerFlagLabel({ type: 'match_ban', label: 'reported' }, tr)).toBe('Reported by players');
    expect(customerFlagLabel({ type: 'match_ban', label: 'no_shows' }, (k) => t('ar', k))).toBe('تكرار الغياب');
    // A code this build does not know prints as stored.
    expect(customerFlagLabel({ type: 'match_ban', label: 'future_code' }, tr)).toBe('future_code');
    expect(customerFlagLabel({ type: 'match_ban', label: null }, tr)).toBeNull();
    expect(customerFlagLabel({ type: 'payment_note', label: 'reported' }, tr)).toBe('reported');
  });
});

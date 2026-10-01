import { describe, expect, it } from 'vitest';
import type { CoachingSettings } from '../../coaching/lessonPayloads';
import {
  COACH_MAX_OPEN_PRIVATE,
  bpToPercentText,
  coachingSettingsErrors,
  coachingSettingsPatch,
  draftFromCoachingSettings,
  isOnlineMode,
  onlineModeBlock,
  onlineRefusalOf,
  percentTextToBp,
  serverFieldOf,
} from './coachingSettingsLogic';

// operator.md §5.12: the owner's lesson rules, typed and stored.

const SAVED: CoachingSettings = {
  venue_id: 'v1',
  coaching_enabled: false,
  lesson_payment_mode: 'desk',
  coach_share_bp: 6000,
  lesson_prices_public: false,
  coach_max_open_private: 10,
  online_payments_available: false,
};

describe('percent ↔ basis points (CD-5)', () => {
  it('reads basis points as the percent the owner types', () => {
    expect(bpToPercentText(6000)).toBe('60');
    expect(bpToPercentText(6250)).toBe('62.5');
    expect(bpToPercentText(6255)).toBe('62.55');
    expect(bpToPercentText(6205)).toBe('62.05');
    expect(bpToPercentText(0)).toBe('0');
    expect(bpToPercentText(10000)).toBe('100');
    expect(bpToPercentText(null)).toBe('');
  });

  it('reads a typed percent exactly, never through a float', () => {
    expect(percentTextToBp('60')).toBe(6000);
    expect(percentTextToBp('62.5')).toBe(6250);
    expect(percentTextToBp('62.55')).toBe(6255);
    expect(percentTextToBp('62,55')).toBe(6255);
    expect(percentTextToBp(' 0 ')).toBe(0);
    expect(percentTextToBp('100')).toBe(10000);
  });

  it('refuses above 100, three decimals and anything not a number', () => {
    expect(percentTextToBp('100.5')).toBeNull();
    expect(percentTextToBp('101')).toBeNull();
    expect(percentTextToBp('62.555')).toBeNull();
    expect(percentTextToBp('-5')).toBeNull();
    expect(percentTextToBp('')).toBeNull();
    expect(percentTextToBp('abc')).toBeNull();
  });

  it('round-trips every stored value', () => {
    for (const bp of [0, 1, 99, 100, 4550, 6000, 6255, 9999, 10000]) {
      expect(percentTextToBp(bpToPercentText(bp))).toBe(bp);
    }
  });
});

describe('draft, errors and patch', () => {
  it('a fresh draft has no errors and sends nothing', () => {
    const d = draftFromCoachingSettings(SAVED);
    expect(d).toEqual({
      enabled: false,
      paymentMode: 'desk',
      sharePercent: '60',
      pricesPublic: false,
      maxOpenPrivate: '10',
    });
    expect(coachingSettingsErrors(d)).toEqual({});
    expect(coachingSettingsPatch(SAVED, d)).toEqual({});
  });

  it('sends only the changed keys, the share in basis points', () => {
    const d = {
      ...draftFromCoachingSettings(SAVED),
      enabled: true,
      sharePercent: '62.5',
      maxOpenPrivate: '12',
    };
    expect(coachingSettingsPatch(SAVED, d)).toEqual({
      coaching_enabled: true,
      coach_share_bp: 6250,
      coach_max_open_private: 12,
    });
  });

  it('coach_max_open_private holds to 1..100 (R56)', () => {
    const base = draftFromCoachingSettings(SAVED);
    expect(coachingSettingsErrors({ ...base, maxOpenPrivate: '0' })).toEqual({
      maxOpenPrivate: 'range',
    });
    expect(coachingSettingsErrors({ ...base, maxOpenPrivate: '101' })).toEqual({
      maxOpenPrivate: 'range',
    });
    expect(
      coachingSettingsErrors({ ...base, maxOpenPrivate: String(COACH_MAX_OPEN_PRIVATE.min) }),
    ).toEqual({});
    expect(
      coachingSettingsErrors({ ...base, maxOpenPrivate: String(COACH_MAX_OPEN_PRIVATE.max) }),
    ).toEqual({});
    expect(coachingSettingsErrors({ ...base, maxOpenPrivate: '' })).toEqual({
      maxOpenPrivate: 'wholeNumber',
    });
    expect(coachingSettingsErrors({ ...base, maxOpenPrivate: '2.5' })).toEqual({
      maxOpenPrivate: 'wholeNumber',
    });
  });

  it('a share past two decimals is a field error', () => {
    expect(
      coachingSettingsErrors({ ...draftFromCoachingSettings(SAVED), sharePercent: '60.123' }),
    ).toEqual({ sharePercent: 'percent' });
  });

  it('a null the server sent counts as changed once typed', () => {
    const saved = { ...SAVED, coach_share_bp: null, coach_max_open_private: null };
    const d = { ...draftFromCoachingSettings(saved), sharePercent: '60', maxOpenPrivate: '10' };
    expect(coachingSettingsPatch(saved, d)).toEqual({
      coach_share_bp: 6000,
      coach_max_open_private: 10,
    });
  });
});

describe('server key → field', () => {
  it('maps INVALID_ARGUMENT details to their field', () => {
    expect(serverFieldOf('coach_share_bp')).toBe('sharePercent');
    expect(serverFieldOf(' coach_max_open_private ')).toBe('maxOpenPrivate');
    expect(serverFieldOf('lesson_payment_mode')).toBe('paymentMode');
    expect(serverFieldOf('coaching_enabled')).toBe('enabled');
    expect(serverFieldOf('lesson_prices_public')).toBe('pricesPublic');
    expect(serverFieldOf('something_else')).toBeNull();
    expect(serverFieldOf(null)).toBeNull();
  });
});

describe('onlineModeBlock (C-26, R50, R67)', () => {
  it('no terms: the online modes are blocked with the terms line', () => {
    expect(onlineModeBlock({ online_payments_available: false })).toEqual(['terms']);
  });

  it('terms live: nothing blocks', () => {
    expect(onlineModeBlock({ online_payments_available: true })).toEqual([]);
  });

  it('no provider (a refusal the server sent): the provider line', () => {
    expect(onlineModeBlock({ online_payments_available: true }, 'provider')).toEqual(['provider']);
  });

  it('both: provider first, then terms', () => {
    expect(onlineModeBlock({ online_payments_available: false }, 'provider')).toEqual([
      'provider',
      'terms',
    ]);
    expect(onlineModeBlock({ online_payments_available: false }, 'terms')).toEqual(['terms']);
  });

  it('reads ONLINE_PAYMENT_OFF details and the online modes', () => {
    expect(onlineRefusalOf('provider')).toBe('provider');
    expect(onlineRefusalOf('terms')).toBe('terms');
    expect(onlineRefusalOf('other')).toBeNull();
    expect(isOnlineMode('desk')).toBe(false);
    expect(isOnlineMode('online_optional')).toBe(true);
    expect(isOnlineMode('online_required')).toBe(true);
  });
});

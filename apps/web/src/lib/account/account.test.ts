import { describe, expect, it } from 'vitest';
import { t } from '@touch/i18n';
import {
  accountHref,
  accountName,
  accountPhone,
  credentialsOf,
  historyKindKey,
  pointsToNextTier,
  safeReturnPath,
} from './account';

describe('credentialsOf (the app’s sign-in rules)', () => {
  it('sends any Iraqi mobile spelling as E.164', () => {
    expect(credentialsOf('phone', '0770 123 4567', 'pw')).toEqual({
      phone: '+9647701234567',
      password: 'pw',
    });
    expect(credentialsOf('phone', '+964 770 123 4567', 'pw')).toEqual({
      phone: '+9647701234567',
      password: 'pw',
    });
    expect(credentialsOf('phone', '12345', 'pw')).toEqual({
      error: 'loyalty.web.signIn.errors.phone',
    });
  });

  it('trims an email and refuses a non-address', () => {
    expect(credentialsOf('email', '  sara@example.com ', 'pw')).toEqual({
      email: 'sara@example.com',
      password: 'pw',
    });
    expect(credentialsOf('email', 'sara', 'pw')).toEqual({
      error: 'loyalty.web.signIn.errors.email',
    });
  });
});

describe('safeReturnPath', () => {
  it('keeps a path on this site', () => {
    expect(safeReturnPath('/en/menu')).toBe('/en/menu');
    expect(safeReturnPath(['/ar/menu?b=1'])).toBe('/ar/menu?b=1');
  });

  it('drops anything that could leave the site', () => {
    for (const bad of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'evil',
      '',
      '/x\n',
      42,
      undefined,
    ]) {
      expect(safeReturnPath(bad)).toBeNull();
    }
    expect(safeReturnPath(`/${'a'.repeat(600)}`)).toBeNull();
  });

  it('builds the account link with the way back', () => {
    expect(accountHref('en', null)).toBe('/en/account');
    expect(accountHref('ar', '/ar/menu')).toBe('/ar/account?return=%2Far%2Fmenu');
  });
});

describe('account display helpers', () => {
  it('names the account by its given name, else its full name', () => {
    expect(accountName({ user_metadata: { given_name: 'Sara', full_name: 'Sara Ali' } })).toBe(
      'Sara',
    );
    expect(accountName({ user_metadata: { full_name: 'Sara Ali' } })).toBe('Sara Ali');
    expect(accountName(null)).toBe('');
  });

  it('reads the phone from GoTrue (no +) or the sign-up metadata', () => {
    expect(accountPhone({ phone: '9647701234567' })).toBe('+9647701234567');
    expect(accountPhone({ phone: '', user_metadata: { phone: '+9647701234567' } })).toBe(
      '+9647701234567',
    );
    expect(accountPhone({ phone: null })).toBeNull();
  });

  it('counts the points to the next tier', () => {
    expect(
      pointsToNextTier({
        points_12m: 800,
        next_tier: { id: 'g', name_en: 'G', name_ar: 'G', multiplier: 1.5, min_points_12m: 1000 },
      }),
    ).toBe(200);
    expect(
      pointsToNextTier({
        points_12m: 1200,
        next_tier: { id: 'g', name_en: 'G', name_ar: 'G', multiplier: 1.5, min_points_12m: 1000 },
      }),
    ).toBe(0);
    expect(pointsToNextTier({ points_12m: 800, next_tier: null })).toBeNull();
  });

  it('words every ledger kind, and an unknown one as an adjustment', () => {
    for (const kind of [
      'earn',
      'redeem',
      'redeem_void',
      'reward',
      'adjust',
      'clawback',
      'expire',
      'merge_in',
    ]) {
      const key = historyKindKey(kind);
      expect(t('en', key)).not.toBe(key);
      expect(t('ar', key)).not.toBe(key);
    }
    expect(historyKindKey('something_new')).toBe('loyalty.web.account.history.kind.adjust');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOnlinePaymentsFlag } from '../../features/deposit/enabled';
import { parsePhoneOtpFlag } from '../../features/auth/phoneOtp';

/**
 * The launch values of the build-time flags (Majed, 2026-11-01), read from
 * eas.json the way EAS reads them. A profile flipped by mistake fails here
 * rather than in the store.
 *
 *  - F-02: no online payment in this build at all. EXPO_PUBLIC_ONLINE_PAYMENTS
 *    is "off" in every profile (features/deposit/enabled.ts), so deposits,
 *    ticket purchases, lesson online pay and the /pay screens are all out.
 *  - F-46: phone OTP is ON in production (features/auth/phoneOtp.ts): the
 *    Profile "Verify phone number" row shows and an edited number needs its code.
 *  - F-71: EXPO_PUBLIC_TOURNAMENTS is gone; the branch settings decide tournaments
 *    (features/tournaments/shipped.ts), so no profile may carry it.
 */
const eas = JSON.parse(readFileSync(join(__dirname, '../../../eas.json'), 'utf8')) as {
  build: Record<string, { env?: Record<string, string> }>;
};
const PROFILES = ['development', 'staging', 'production'] as const;

describe('eas.json build flags', () => {
  it('has the three profiles', () => {
    for (const p of PROFILES) expect(eas.build[p]?.env, p).toBeTruthy();
  });

  it('ships online payments OFF in every profile (F-02)', () => {
    for (const p of PROFILES) {
      const value = eas.build[p]?.env?.EXPO_PUBLIC_ONLINE_PAYMENTS;
      expect(value, p).toBe('off');
      expect(parseOnlinePaymentsFlag(value), p).toBe(false);
    }
  });

  it('ships phone OTP ON in production (F-46)', () => {
    const value = eas.build.production?.env?.EXPO_PUBLIC_PHONE_OTP;
    expect(value).toBe('on');
    expect(parsePhoneOtpFlag(value)).toBe(true);
  });

  it('carries no tournaments flag: the branch decides (F-71)', () => {
    for (const p of PROFILES) expect(eas.build[p]?.env ?? {}, p).not.toHaveProperty('EXPO_PUBLIC_TOURNAMENTS');
  });

  it('keeps every flag a literal on/off', () => {
    for (const p of PROFILES) {
      const env = eas.build[p]?.env ?? {};
      for (const name of ['EXPO_PUBLIC_ONLINE_PAYMENTS', 'EXPO_PUBLIC_PHONE_OTP']) {
        expect(['on', 'off'], `${p} ${name}`).toContain(env[name]);
      }
    }
  });
});

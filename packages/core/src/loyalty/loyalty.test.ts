import { describe, expect, it } from 'vitest';
import { earnPoints, redeemAmount } from './points';
import { qrModules, qrPath } from './qr';
import { sha1, hmacSha1 } from './sha1';
import { base32Decode, hotp, memberToken, parseMemberInput } from './totp';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const utf8 = (s: string) => new TextEncoder().encode(s);

describe('sha1 / hmacSha1', () => {
  it('matches the FIPS 180 vectors', () => {
    expect(hex(sha1(utf8('')))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(hex(sha1(utf8('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(hex(sha1(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    );
  });
  it('matches RFC 2202 HMAC-SHA1 case 2', () => {
    expect(hex(hmacSha1(utf8('Jefe'), utf8('what do ya want for nothing?')))).toBe(
      'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79',
    );
  });
});

describe('totp', () => {
  // RFC 6238 Appendix B, SHA-1 seed "12345678901234567890", last 6 of the 8 digits.
  const seed = utf8('12345678901234567890');
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('RFC 6238 vector at T=%i', (t, want) => {
    expect(hotp(seed, Math.floor(t / 30))).toBe(want);
  });

  it('decodes base32 and builds the token', () => {
    // base32 of "12345678901234567890"
    const b32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(hex(base32Decode(b32))).toBe(hex(seed));
    const { token, secondsLeft } = memberToken(
      { member_code: '8F3K2QXM', secret_b32: b32, step: 30 },
      59_000,
    );
    expect(token).toBe('TP-8F3K2QXM-287082');
    expect(secondsLeft).toBe(1);
  });

  it('parses what the till field holds', () => {
    expect(parseMemberInput(' tp-8f3k2qxm-287082 ')).toMatchObject({
      kind: 'token',
      code: '8F3K2QXM',
      otp: '287082',
    });
    expect(parseMemberInput('0770 123 4567')).toEqual({ kind: 'phone', digits: '07701234567' });
    expect(parseMemberInput('٠٧٧٠١٢٣٤٥٦٧')).toEqual({ kind: 'phone', digits: '07701234567' });
    expect(parseMemberInput('TP-8F3K2QXI-287082')).toEqual({ kind: 'invalid' }); // I is not Crockford
    expect(parseMemberInput('12345')).toEqual({ kind: 'invalid' });
    expect(parseMemberInput('ABC1234567')).toEqual({ kind: 'invalid' });
  });
});

describe('points', () => {
  const on = {
    earn_cafe: true,
    earn_shop: true,
    earn_court: true,
    earn_lesson: true,
    earn_tournament: true,
  };
  it('earns per domain with the multiplier', () => {
    expect(
      earnPoints({
        kind: 'cafe',
        paid: 25_500,
        courtIqd: 20_000,
        iqdPerPoint: 1000,
        multiplier: 1,
        switches: on,
      }),
    ).toBe(25);
    expect(
      earnPoints({
        kind: 'cafe',
        paid: 25_500,
        courtIqd: 20_000,
        iqdPerPoint: 1000,
        multiplier: 1,
        switches: { ...on, earn_court: false },
      }),
    ).toBe(5);
    expect(
      earnPoints({
        kind: 'shop',
        paid: 9_999,
        courtIqd: 0,
        iqdPerPoint: 1000,
        multiplier: 1.5,
        switches: on,
      }),
    ).toBe(14);
    expect(
      earnPoints({
        kind: 'lesson',
        paid: 0,
        courtIqd: 0,
        iqdPerPoint: 1000,
        multiplier: 2,
        switches: on,
      }),
    ).toBe(0);
  });
  it('redeems only what fits the tab', () => {
    expect(redeemAmount({ points: 500, pointValueIqd: 50, remainingIqd: 12_340 })).toEqual({
      points: 246,
      amountIqd: 12_300,
    });
    expect(redeemAmount({ points: 100, pointValueIqd: 50, remainingIqd: 0 })).toEqual({
      points: 0,
      amountIqd: 0,
    });
  });
});

describe('qr', () => {
  it('encodes a member token into one path', () => {
    const m = qrModules('TP-8F3K2QXM-287082');
    expect(m.size).toBeGreaterThanOrEqual(21);
    const { d, size } = qrPath(m);
    expect(size).toBe(m.size);
    expect(d.startsWith('M0 0h7')).toBe(true); // the top-left finder pattern
  });
});

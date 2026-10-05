/**
 * Loyalty (Phase 2 M3, docs/design/loyalty/build-contracts-2026-10-05.md §1.3, §3): the member
 * token is computed offline by the phone and the browser (@touch/core/loyalty hotp / memberToken)
 * and verified at the till by the database (app.loyalty_totp inside app.loyalty_token_profile).
 * One wrong byte order or one wrong mask and every scan at the till fails, so the two are held to
 * one table here:
 *
 *   * the RFC 6238 SHA-1 vectors (seed "12345678901234567890", step 30, the last six digits of
 *     the eight the RFC prints), in SQL and in TS;
 *   * random 20-byte secrets at random counters, SQL against TS;
 *   * app.base32_encode against base32Decode (RFC 4648, no padding) and the RFC 4648 vectors;
 *   * memberToken's TP-<code>-<digits> against the SQL at the same counter;
 *   * app.loyalty_member_code: 8 Crockford characters (MEMBER_CODE_RE).
 *
 * Read-only psql as postgres (the functions are internal, granted to nobody); without docker the
 * suite skips.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base32Decode, hotp, MEMBER_CODE_RE, memberToken } from '../../core/src/loyalty/totp';
import { stackAvailable } from './helpers';
import { dockerReachable, psql } from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

const RFC_SEED = '12345678901234567890';
/** RFC 6238 Appendix B, SHA-1: time -> TOTP (8 digits; the token uses the last 6). */
const RFC_VECTORS: Array<[number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe.skipIf(!docker)('loyalty TOTP: SQL and TS agree (contracts §1.3, §3)', () => {
  it('matches the RFC 6238 SHA-1 vectors on both sides', () => {
    const seed = new TextEncoder().encode(RFC_SEED);
    const rows = RFC_VECTORS.map(([t]) => `(${Math.floor(t / 30)})`).join(', ');
    const sql = psql(
      `select string_agg(app.loyalty_totp(convert_to('${RFC_SEED}', 'UTF8'), c), ',' order by c)
         from (values ${rows}) v(c)`,
    ).split(',');
    RFC_VECTORS.forEach(([t, eight], i) => {
      const six = eight.slice(-6);
      expect(hotp(seed, Math.floor(t / 30)), `TS at ${t}`).toBe(six);
      expect(sql[i], `SQL at ${t}`).toBe(six);
    });
  });

  it('agrees on 200 random secrets and counters', () => {
    const cases = Array.from({ length: 200 }, () => ({
      secret: new Uint8Array(randomBytes(20)),
      // Up to 2^40: well past any epoch / 15 s, and above 2^32 so the high counter bytes count.
      counter: Math.floor(Math.random() * 2 ** 40),
    }));
    const rows = cases
      .map((c, i) => `(${i}, '${hex(c.secret)}', ${c.counter}::bigint)`)
      .join(',\n');
    const sql = psql(
      `select string_agg(app.loyalty_totp(decode(h, 'hex'), c), ',' order by i)
         from (values ${rows}) v(i, h, c)`,
    ).split(',');
    expect(sql).toHaveLength(cases.length);
    cases.forEach((c, i) =>
      expect(sql[i], `case ${i} (${hex(c.secret)} @ ${c.counter})`).toBe(hotp(c.secret, c.counter)),
    );
  });

  it('encodes base32 as base32Decode reads it (RFC 4648, no padding)', () => {
    // RFC 4648 §10 vectors, padding removed.
    const vectors: Array<[string, string]> = [
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ];
    const rows = vectors.map(([s], i) => `(${i}, '${s}')`).join(', ');
    const sql = psql(
      `select string_agg(coalesce(app.base32_encode(convert_to(s, 'UTF8')), ''), '|' order by i)
         from (values ${rows}) v(i, s)`,
    ).split('|');
    vectors.forEach(([, b32], i) => expect(sql[i]).toBe(b32));

    const secrets = Array.from({ length: 50 }, () => new Uint8Array(randomBytes(20)));
    const enc = psql(
      `select string_agg(app.base32_encode(decode(h, 'hex')), ',' order by i)
         from (values ${secrets.map((s, i) => `(${i}, '${hex(s)}')`).join(', ')}) v(i, h)`,
    ).split(',');
    secrets.forEach((s, i) => {
      expect(enc[i]).toMatch(/^[A-Z2-7]{32}$/);
      expect(hex(base32Decode(enc[i]!))).toBe(hex(s));
    });
  });

  it('memberToken draws the token the database computes for the same step', () => {
    const secret = new Uint8Array(randomBytes(20));
    const b32 = psql(`select app.base32_encode(decode('${hex(secret)}', 'hex'))`);
    for (const step of [15, 30, 60, 120]) {
      const nowMs = 1_790_000_000_123 + step * 7_000;
      const card = { member_code: '8F3K2QXM', secret_b32: b32, step };
      const { token, secondsLeft } = memberToken(card, nowMs);
      const counter = Math.floor(Math.floor(nowMs / 1000) / step);
      const digits = psql(`select app.loyalty_totp(decode('${hex(secret)}', 'hex'), ${counter})`);
      expect(token).toBe(`TP-8F3K2QXM-${digits}`);
      expect(secondsLeft).toBeGreaterThan(0);
      expect(secondsLeft).toBeLessThanOrEqual(step);
    }
  });

  it('makes member codes of 8 Crockford characters', () => {
    const codes = psql(
      `select string_agg(app.loyalty_member_code(), ',') from generate_series(1, 300)`,
    ).split(',');
    expect(codes).toHaveLength(300);
    for (const c of codes) expect(c).toMatch(MEMBER_CODE_RE);
    // 40 random bits: 300 draws never collide in practice.
    expect(new Set(codes).size).toBe(300);
  });
});

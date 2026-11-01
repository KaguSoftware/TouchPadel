import { describe, expect, it } from 'vitest';
import {
  MONITOR_DETAIL_MAX_BYTES,
  MONITOR_MESSAGE_MAX,
  errorDetail,
  errorMessage,
  keyIsSecret,
  scrubDetail,
  scrubText,
  toReportArgs,
} from './monitoring';

describe('monitoring scrub (F-15: no PINs, tokens, phones or personal data leave the device)', () => {
  it('drops keys that name a secret or a contact, keeps look-alikes', () => {
    for (const k of ['pin', 'p_pin', 'managerPin', 'password', 'access_token', 'apiKey', 'Authorization', 'phone', 'guestPhone', 'email', 'otp', 'card_number', 'service_role_key', 'cookie', 'session']) {
      expect(keyIsSecret(k), k).toBe(true);
    }
    for (const k of ['shipping', 'spinner', 'mapping', 'pinned_at', 'route', 'stationId', 'kind', 'company', 'expand']) {
      expect(keyIsSecret(k), k).toBe(false);
    }
  });

  it('masks emails, phone and card numbers, JWTs, bearer tokens and keys in text', () => {
    expect(scrubText('mail a.b@c.co now')).toBe('mail [email] now');
    expect(scrubText('call +964 770 123 4567')).toBe('call [number]');
    expect(scrubText('card 4111-1111-1111-1111')).toBe('card [number]');
    expect(scrubText('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijkl')).toBe('jwt [token]');
    expect(scrubText('Bearer abcdefghijklmnop')).toBe('Bearer [token]');
    expect(scrubText('key sb_secret_abcdef123')).toBe('key [key]');
    // Dates, ids and small numbers survive.
    expect(scrubText('2026-11-01 order 1234 tab 42')).toBe('2026-11-01 order 1234 tab 42');
    expect(scrubText('at 2026-11-01T10:30:00.123Z')).toBe('at 2026-11-01T10:30:00.123Z');
  });

  it('keeps digit-heavy UUIDs whole and still masks the phone beside them (the server agrees)', () => {
    expect(scrubText('branch c0000000-0000-4000-8000-000000000001 call +964 770 123 4567')).toBe(
      'branch c0000000-0000-4000-8000-000000000001 call [number]',
    );
    expect(scrubText('11111111-2222-4333-8444-555555555555/07701234567')).toBe('11111111-2222-4333-8444-555555555555/[number]');
    expect(scrubText('card 4111-1111-1111-1111')).toBe('card [number]');
    expect(scrubText('a\u0001b')).toBe('ab');
    expect(scrubDetail({ venue: 'c0000000-0000-4000-8000-000000000001', phoneish: 'x 07701234567' })).toEqual({
      venue: 'c0000000-0000-4000-8000-000000000001',
      phoneish: 'x [number]',
    });
  });

  it('scrubs nested detail, caps arrays, depth and strings, and survives cycles', () => {
    const cyc: Record<string, unknown> = { a: 1 };
    cyc.self = cyc;
    const out = scrubDetail({
      route: '/till',
      nested: { pin: '1234', note: 'reach me at x@y.io', deeper: { more: { evenMore: { gone: 1 } } } },
      list: Array.from({ length: 30 }, (_, i) => i),
      long: 'x'.repeat(2000),
      cyc,
      fn: () => 1,
      when: new Date('2026-11-01T00:00:00Z'),
    });
    expect(out.route).toBe('/till');
    expect(out.nested).toMatchObject({ note: 'reach me at [email]' });
    expect(out.nested).not.toHaveProperty('pin');
    expect((out.nested as Record<string, Record<string, Record<string, unknown>>>).deeper!.more!.evenMore).toBe('[deep]');
    expect(out.list).toHaveLength(21);
    expect((out.long as string).length).toBe(500);
    expect((out.cyc as Record<string, unknown>).self).toBe('[circular]');
    expect(out).not.toHaveProperty('fn');
    expect(out.when).toBe('2026-11-01T00:00:00.000Z');
  });

  it('cuts an oversized detail down to its key names', () => {
    const big = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, 'v'.repeat(400)]));
    const out = scrubDetail(big);
    expect(out.truncated).toBe(true);
    expect((out.keys as string[]).length).toBe(40);
    expect(JSON.stringify(out).length).toBeLessThan(MONITOR_DETAIL_MAX_BYTES);
  });

  it('never throws on anything', () => {
    expect(scrubDetail(undefined)).toEqual({});
    expect(scrubDetail(null)).toEqual({});
    expect(scrubDetail('text')).toEqual({ value: 'text' });
    expect(scrubDetail([1, 2])).toEqual({ value: [1, 2] });
    expect(errorMessage(Symbol('s') as unknown)).toBeTypeOf('string');
    expect(errorDetail({ toString: () => { throw new Error('no'); } })).toEqual({});
  });
});

describe('toReportArgs', () => {
  it('forces level and kind into range and caps the message', () => {
    const a = toReportArgs('operator', { level: 'loud' as never, kind: 'Not A Kind!', message: 'm'.repeat(5000) }, '0.2.30');
    expect(a.p_level).toBe('error');
    expect(a.p_kind).toBe('unknown');
    expect(a.p_message.length).toBe(MONITOR_MESSAGE_MAX);
    expect(a.p_app_version).toBe('0.2.30');
    expect(a.p_user_reported).toBe(false);
  });

  it('merges the context under the caller detail and scrubs both', () => {
    const a = toReportArgs('mobile', { level: 'warn', kind: 'print_failed', message: 'x', detail: { printer: 'P1', pin: '9' }, userReported: true }, null, { route: '/a', token: 't' });
    expect(a.p_detail).toEqual({ route: '/a', printer: 'P1' });
    expect(a.p_user_reported).toBe(true);
    expect(a.p_source).toBe('mobile');
  });

  it('uses the kind as the message when the message is empty', () => {
    expect(toReportArgs('web', { level: 'info', kind: 'web_error', message: '   ' }, null).p_message).toBe('web_error');
  });
});

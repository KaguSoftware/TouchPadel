import { describe, expect, it } from 'vitest';
import { isRetryablePgError, mapPgError } from '../supabase/functions/_shared/http.ts';
import { REDACTED, redactSecrets } from '../supabase/functions/_shared/redact.ts';

/**
 * Pure tests for the replay transport contract (no stack needed). The C1
 * regression: a transient database error on a queued till write must be
 * classified as retryable and mapped to 503, never to a terminal 4xx/5xx that
 * the replay function would record as a 'conflict' and the worker would then
 * ack as a duplicate. S2: payload secrets never survive into a stored or echoed
 * detail. (C4, the shared mutation-type list, is asserted in
 * apps/operator/src/lib/mutate.test.ts against @touch/core and DIRECT_RPC, and by
 * the replay function itself at boot.)
 */
describe('replay transport: retryable classification (C1)', () => {
  it.each(['40001', '40P01', '55P03', '57014', '53300', '53400', '57P01', '08006', 'PGRST001'])(
    'SQLSTATE %s is retryable and maps to 503 RETRY_LATER',
    (code) => {
      const err = { code, message: 'transient' };
      expect(isRetryablePgError(err)).toBe(true);
      const mapped = mapPgError(err);
      expect(mapped.status).toBe(503);
      expect(mapped.code).toBe('RETRY_LATER');
    },
  );

  it.each([
    ['P0001', 'PIN_INVALID', 403],
    ['P0001', 'FORBIDDEN', 403],
    ['P0001', 'SLOT_TAKEN', 409],
    ['23P01', 'exclusion', 409],
    ['23505', 'duplicate key', 409],
    ['PGRST202', 'no matching function', 501],
    ['22P02', 'invalid input syntax', 500],
  ])('%s %s is terminal (status %i), never retryable', (code, message, status) => {
    const err = { code, message };
    expect(isRetryablePgError(err)).toBe(false);
    expect(mapPgError(err).status).toBe(status);
  });

  it('a missing code is terminal — the server answered, it did not time out', () => {
    expect(isRetryablePgError({ message: 'x' })).toBe(false);
  });
});

describe('replay transport: payload redaction (S2)', () => {
  it('replaces pin/password/secret/token/otp at any depth and leaves the rest intact', () => {
    const payload = {
      tabId: 't1',
      pin: '123456',
      nested: { token: 'abc', keep: 1, list: [{ password: 'p' }, 'x', 2] },
      reasonCode: 'manager_discount',
    };
    const out = redactSecrets(payload);
    expect(out).toEqual({
      tabId: 't1',
      pin: REDACTED,
      nested: { token: REDACTED, keep: 1, list: [{ password: REDACTED }, 'x', 2] },
      reasonCode: 'manager_discount',
    });
    // never mutates its input
    expect(payload.pin).toBe('123456');
  });

  it('passes scalars, null and arrays through', () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(3)).toBe(3);
    expect(redactSecrets(['a', { pin: 1 }])).toEqual(['a', { pin: REDACTED }]);
  });
});

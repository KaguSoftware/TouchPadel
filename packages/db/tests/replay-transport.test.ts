import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isRetryablePgError, isUnjudgedReplayError, mapPgError } from '../supabase/functions/_shared/http.ts';
import { REDACTED, redactSecrets } from '../supabase/functions/_shared/redact.ts';

/**
 * Pure tests for the replay transport contract (no stack needed). The C1
 * regression: a transient database error on a queued till write must be
 * classified as retryable and mapped to 503, never to a terminal 4xx/5xx that
 * the replay function would record as a 'conflict' and the worker would then
 * ack as a duplicate. W2 #11 widens it: the till's sync worker retries EVERY
 * answer ≥ 500, so replay records nothing for a ≥ 500 the server did not judge
 * (501 RPC_NOT_DEPLOYED, 503 DEGRADED_LOCKOUT, a transport-ish 500), only for a
 * deterministic refusal. S2: payload secrets never survive into a stored or
 * echoed detail. (C4, the shared mutation-type list, is asserted in
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
  ])('%s %s maps to status %i and is not a transient SQLSTATE', (code, message, status) => {
    const err = { code, message };
    expect(isRetryablePgError(err)).toBe(false);
    expect(mapPgError(err).status).toBe(status);
  });

  it('a missing code is not a transient SQLSTATE (replay still leaves it unrecorded, below)', () => {
    expect(isRetryablePgError({ message: 'x' })).toBe(false);
  });
});

describe('replay: what is recorded in sync_replays (W2 #11)', () => {
  // The sync worker (apps/operator-shell/src/main/sync-worker.ts) releases every
  // ≥ 500 back to pending and sends it again. A record written before such an
  // answer makes that retry a 'duplicate' of a 'conflict': a permanent refusal.
  it.each([
    ['40001', 'serialization failure', 503, 'RETRY_LATER'],
    ['57014', 'statement timeout', 503, 'RETRY_LATER'],
    ['PGRST202', 'no function matches (a till ahead of its migration)', 501, 'RPC_NOT_DEPLOYED'],
    ['P0001', 'DEGRADED_LOCKOUT', 503, 'DEGRADED_LOCKOUT'],
    [undefined, 'TypeError: fetch failed', 500, 'INTERNAL'],
    ['', 'Bad Gateway', 500, ''],
    ['PGRST301', 'JWT expired', 500, 'PGRST301'],
    ['XX000', 'internal error', 500, 'XX000'],
    ['58030', 'could not read block', 500, '58030'],
    ['55006', 'object in use', 500, '55006'],
  ])('%s (%s) answers %i %s and is NOT recorded', (code, message, status, mappedCode) => {
    const err = { code, message };
    expect(mapPgError(err).status).toBe(status);
    expect(mapPgError(err).code).toBe(mappedCode);
    expect(isUnjudgedReplayError(err)).toBe(true);
  });

  it.each([
    ['P0001', 'PIN_INVALID', 403],
    ['P0001', 'FORBIDDEN', 403],
    ['P0001', 'SLOT_TAKEN', 409],
    ['P0001', 'TAB_NOT_EMPTY', 400],
    ['23P01', 'exclusion', 409],
    ['23505', 'duplicate key', 409],
    ['23514', 'check violation', 500],
    ['22P02', 'invalid input syntax', 500],
    ['42501', 'permission denied', 500],
    ['42883', 'operator does not exist', 500],
  ])('%s %s (status %i) is a deterministic refusal and IS recorded', (code, message, status) => {
    const err = { code, message };
    expect(mapPgError(err).status).toBe(status);
    expect(isUnjudgedReplayError(err)).toBe(false);
  });

  it('replay/index.ts routes every refusal through the classifier before recording', () => {
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../supabase/functions/replay/index.ts'), 'utf8');
    const refusal = src.slice(src.indexOf('if (rpcError) {'));
    const classify = refusal.indexOf('isUnjudgedReplayError(pgErr)');
    expect(classify).toBeGreaterThan(-1);
    // Nothing is recorded before the classifier has had its say.
    expect(classify).toBeLessThan(refusal.indexOf("record('conflict'"));
    expect(src).not.toMatch(/isRetryablePgError\(pgErr\)/);
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

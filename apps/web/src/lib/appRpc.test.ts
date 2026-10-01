import { describe, expect, it } from 'vitest';
import { t } from '@touch/i18n';
import { isRpcError, rpcErrorKey, shouldRefreshMenu } from './appRpc';

/** PostgREST's error object for a `raise exception 'CODE'`. */
const pg = (message: string, code = 'P0001') => ({ message, code, details: null, hint: null });

describe('rpcErrorKey', () => {
  it('keeps the guest site’s own words for the café and table codes', () => {
    expect(rpcErrorKey(pg('TOKEN_INVALID'))).toBe('cafe.invalidQr');
    expect(rpcErrorKey(pg('SESSION_EXPIRED'))).toBe('errors.sessionTableExpired');
    expect(rpcErrorKey(pg('DEGRADED_LOCKOUT'))).toBe('degraded.orderingRefused');
    expect(rpcErrorKey(pg('ITEM_UNAVAILABLE'))).toBe('cafe.itemUnavailable');
    expect(rpcErrorKey(pg('VENUE_MISMATCH'))).toBe('cafe.itemUnavailable');
    expect(rpcErrorKey(pg('CALL_COOLDOWN'))).toBe('cafe.waiterAlreadyCalled');
    // Not actionable for a guest: the generic line, as before.
    expect(rpcErrorKey(pg('IDEMPOTENCY_CONFLICT'))).toBe('errors.generic');
    expect(rpcErrorKey(pg('VENUE_REQUIRED'))).toBe('errors.generic');
    expect(rpcErrorKey(pg('INVALID_KIND'))).toBe('errors.generic');
  });

  it('the ordering limits a guest can hit now say so (0211), in both languages', () => {
    for (const code of ['TOO_MANY_ORDERS', 'TOO_MANY_ITEMS'] as const) {
      const key = rpcErrorKey(pg(code));
      expect(key).toBe(`op.errors.${code}`);
      expect(t('en', key)).toMatch(/member of staff/);
      expect(t('ar', key)).toMatch(/الموظفين/);
    }
  });

  it('maps a native Postgres error by its SQLSTATE, and anything else to the generic line', () => {
    expect(rpcErrorKey(pg('canceling statement due to statement timeout', '57014'))).toBe(
      'errors.busy',
    );
    expect(
      rpcErrorKey(pg('duplicate key value violates unique constraint "orders_pkey"', '23505')),
    ).toBe('errors.duplicate');
    expect(rpcErrorKey(pg('SOMETHING_NEW'))).toBe('errors.generic');
    expect(rpcErrorKey({ message: 'Failed to fetch' })).toBe('errors.generic');
    expect(rpcErrorKey(null)).toBe('errors.generic');
    expect(rpcErrorKey(undefined)).toBe('errors.generic');
  });
});

describe('isRpcError and shouldRefreshMenu', () => {
  it('compare the exact code', () => {
    expect(isRpcError(pg(' TABLE_NOT_FOUND '), 'TABLE_NOT_FOUND')).toBe(true);
    expect(isRpcError(pg('TABLE_NOT_FOUND'), 'TOKEN_INVALID')).toBe(false);
    expect(shouldRefreshMenu('VARIANT_NOT_FOUND')).toBe(true);
    expect(shouldRefreshMenu('TOO_MANY_ITEMS')).toBe(false);
    expect(shouldRefreshMenu(null)).toBe(false);
  });
});

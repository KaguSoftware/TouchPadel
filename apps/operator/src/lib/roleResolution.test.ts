/**
 * SEC-35, client half — the policy that decides whether a failed role lookup
 * means "you were deactivated" or "we could not ask".
 *
 * Getting this wrong is expensive in BOTH directions and neither shows up in
 * ordinary use, which is why it is tested rather than eyeballed:
 *
 *   too eager   a two-second wifi drop throws a trading till onto the
 *               "you are not staff" screen mid-sale
 *   too lax     a deactivated staff member keeps a live kds / floor feed until
 *               their access token expires — up to an hour (0081's own
 *               documented limit)
 */
import { describe, expect, it } from 'vitest';
import {
  ROLE_RECHECK_MS,
  nextStaff,
  resolveStaffRow,
  shouldDropRealtime,
  type StaffInfo,
} from './roleResolution';

const ACTIVE = { id: 'u1', display_name: 'Sara', role: 'cashier', is_active: true };
const PREV: StaffInfo = { id: 'u1', displayName: 'Sara', role: 'cashier' };

describe('resolveStaffRow — an error is never an answer', () => {
  it('reads a live staff row as active', () => {
    const r = resolveStaffRow(ACTIVE, null);
    expect(r).toEqual({ kind: 'active', info: PREV });
  });

  it('reads a query failure as unknown, NOT as revoked', () => {
    // The whole point. PostgREST 503, a dropped socket, an aborted fetch — none
    // of them is evidence about the account.
    expect(resolveStaffRow(null, new Error('fetch failed')).kind).toBe('unknown');
    expect(resolveStaffRow(undefined, { message: '503' }).kind).toBe('unknown');
  });

  it('prefers the ERROR when a response carries both an error and a row', () => {
    // PostgREST can return both. Drawing a conclusion from the partial row
    // beside an error is how a transient 503 comes to mean "you were sacked".
    expect(resolveStaffRow(ACTIVE, { message: 'boom' }).kind).toBe('unknown');
  });

  it('reads a missing row as revoked', () => {
    expect(resolveStaffRow(null, null).kind).toBe('revoked');
    expect(resolveStaffRow(undefined, null).kind).toBe('revoked');
  });

  it('reads is_active = false as revoked — this is the leaver', () => {
    expect(resolveStaffRow({ ...ACTIVE, is_active: false }, null).kind).toBe('revoked');
  });

  it('treats a MISSING is_active as revoked, not as active', () => {
    // Default-deny on a column the select forgot to ask for. `!== true` rather
    // than `=== false`, so undefined and null both refuse.
    expect(resolveStaffRow({ id: 'u1', role: 'cashier' }, null).kind).toBe('revoked');
    expect(resolveStaffRow({ ...ACTIVE, is_active: undefined }, null).kind).toBe('revoked');
  });

  it('refuses a role this build does not know', () => {
    // An unknown role matches nothing in ROUTE_ROLES, so it would render an
    // operator with no navigation and no explanation. Refusing is both safer
    // and more legible than admitting it.
    expect(resolveStaffRow({ ...ACTIVE, role: 'superuser' }, null).kind).toBe('revoked');
    expect(resolveStaffRow({ ...ACTIVE, role: '' }, null).kind).toBe('revoked');
  });

  it('refuses a row with no id', () => {
    expect(resolveStaffRow({ ...ACTIVE, id: '' }, null).kind).toBe('revoked');
  });
});

describe('shouldDropRealtime — only a DEFINITE revocation drops the channel', () => {
  it('drops on revoked', () => {
    expect(shouldDropRealtime({ kind: 'revoked' })).toBe(true);
  });

  it('does not drop on unknown', () => {
    // A control that tears the till's live feed down on every wifi hiccup is a
    // control somebody switches off within a week.
    expect(shouldDropRealtime({ kind: 'unknown' })).toBe(false);
  });

  it('does not drop on active', () => {
    expect(shouldDropRealtime({ kind: 'active', info: PREV })).toBe(false);
  });
});

describe('nextStaff — unknown changes nothing', () => {
  it('keeps the previous staff through a transient failure', () => {
    expect(nextStaff(PREV, { kind: 'unknown' })).toBe(PREV);
  });

  it('clears the staff on revocation', () => {
    expect(nextStaff(PREV, { kind: 'revoked' })).toBeNull();
  });

  it('adopts the freshly resolved staff', () => {
    const next: StaffInfo = { id: 'u2', displayName: 'Ali', role: 'manager' };
    expect(nextStaff(PREV, { kind: 'active', info: next })).toBe(next);
  });

  it('does not conjure a staff row out of an unknown when there was none', () => {
    expect(nextStaff(null, { kind: 'unknown' })).toBeNull();
  });
});

describe('the re-check interval is what bounds a leaver’s live feed', () => {
  it('is well under the token lifetime it exists to shorten', () => {
    // jwt_expiry is 3600s. Without a re-check the role is only re-read when the
    // token refreshes, so a deactivated account keeps its subscribed channel
    // for up to that long — the limit 0081 records in its own header.
    expect(ROLE_RECHECK_MS).toBeLessThan(5 * 60_000);
    // And not so short that every till hammers `staff` for no benefit.
    expect(ROLE_RECHECK_MS).toBeGreaterThanOrEqual(30_000);
  });
});

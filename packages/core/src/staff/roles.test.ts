/**
 * The staff role module both apps classify a staff row with (§7.1 of
 * docs/design/protocols/build-contracts-2026-09-23.md). Moved with the policy
 * from apps/operator/src/lib/roleResolution.ts; the operator's own test still
 * pins what the operator makes of `unknown_role` (revoked).
 *
 * Getting this wrong is expensive in BOTH directions and neither shows up in
 * ordinary use:
 *
 *   too eager   a two-second wifi drop throws a working till (or a phone) onto
 *               the "you are not staff" screen mid-service
 *   too lax     a deactivated staff member keeps a live feed until their
 *               access token expires, up to an hour (0081's documented limit)
 */
import { describe, expect, it } from 'vitest';
import {
  HIREABLE_ROLES,
  RETIRED_ROLES,
  ROLE_RECHECK_MS,
  STAFF_ROLES,
  STAFF_TEAMS,
  TEAM_HEAD,
  isStaffRole,
  nextStaff,
  resolveStaffRow,
  teamOf,
  type StaffInfo,
} from './roles';

const ACTIVE = { id: 'u1', display_name: 'Sara', role: 'cashier', is_active: true };
const PREV: StaffInfo = { id: 'u1', displayName: 'Sara', role: 'cashier' };

describe('STAFF_ROLES', () => {
  it('lists the staff_role enum in its own order', () => {
    expect(STAFF_ROLES).toEqual([
      'cashier',
      'prep',
      'court_desk',
      'manager',
      'owner',
      'head_barista',
      'barista',
      'head_chef',
      'chef',
      'driver',
      'marketing',
    ]);
  });

  it('retires prep and nothing else', () => {
    expect(RETIRED_ROLES).toEqual(['prep']);
  });

  it('hires every role but prep and owner (§2.1 HIREABLE)', () => {
    expect([...HIREABLE_ROLES].sort()).toEqual(
      STAFF_ROLES.filter((r) => r !== 'prep' && r !== 'owner').sort(),
    );
  });

  it('knows a role by exact spelling only', () => {
    expect(isStaffRole('head_chef')).toBe(true);
    expect(isStaffRole('Head_chef')).toBe(false);
    expect(isStaffRole('chef ')).toBe(false);
    expect(isStaffRole(null)).toBe(false);
  });
});

describe('resolveStaffRow: an error is never an answer', () => {
  it('reads a live staff row as active', () => {
    expect(resolveStaffRow(ACTIVE, null)).toEqual({ kind: 'active', info: PREV });
  });

  it('reads a query failure as unknown, NOT as revoked', () => {
    expect(resolveStaffRow(null, new Error('fetch failed')).kind).toBe('unknown');
    expect(resolveStaffRow(undefined, { message: '503' }).kind).toBe('unknown');
  });

  it('prefers the ERROR when a response carries both an error and a row', () => {
    expect(resolveStaffRow(ACTIVE, { message: 'boom' }).kind).toBe('unknown');
  });

  it('reads a missing row as revoked', () => {
    expect(resolveStaffRow(null, null).kind).toBe('revoked');
    expect(resolveStaffRow(undefined, null).kind).toBe('revoked');
  });

  it('reads is_active = false as revoked: this is the leaver', () => {
    expect(resolveStaffRow({ ...ACTIVE, is_active: false }, null).kind).toBe('revoked');
  });

  it('treats a MISSING is_active as revoked, not as active', () => {
    expect(resolveStaffRow({ id: 'u1', role: 'cashier' }, null).kind).toBe('revoked');
  });

  it('refuses a row with no id, or no role at all', () => {
    expect(resolveStaffRow({ ...ACTIVE, id: '' }, null).kind).toBe('revoked');
    expect(resolveStaffRow({ ...ACTIVE, role: '' }, null).kind).toBe('revoked');
    expect(resolveStaffRow({ ...ACTIVE, role: undefined }, null).kind).toBe('revoked');
  });

  it('names an active role this build does not know, instead of calling it revoked', () => {
    // A newer database than the app: the phone asks for an update, the
    // operator maps it back to revoked (its own test pins that).
    expect(resolveStaffRow({ ...ACTIVE, role: 'sommelier' }, null)).toEqual({
      kind: 'unknown_role',
      role: 'sommelier',
    });
  });

  it('still calls an INACTIVE row with an unknown role revoked', () => {
    // Switched off wins: the account is gone whatever its role says.
    expect(resolveStaffRow({ ...ACTIVE, role: 'sommelier', is_active: false }, null).kind).toBe(
      'revoked',
    );
  });

  it('admits every role in the list, prep included while accounts still hold it', () => {
    for (const role of STAFF_ROLES) {
      expect(resolveStaffRow({ ...ACTIVE, role }, null), role).toEqual({
        kind: 'active',
        info: { ...PREV, role },
      });
    }
  });

  it('reads a missing display name as empty rather than undefined', () => {
    const r = resolveStaffRow({ id: 'u1', role: 'chef', is_active: true }, null);
    expect(r).toEqual({ kind: 'active', info: { id: 'u1', displayName: '', role: 'chef' } });
  });
});

describe('nextStaff: unknown changes nothing', () => {
  it('keeps the previous staff through a transient failure', () => {
    expect(nextStaff(PREV, { kind: 'unknown' })).toBe(PREV);
  });

  it('clears the staff on revocation and on an unknown role', () => {
    expect(nextStaff(PREV, { kind: 'revoked' })).toBeNull();
    expect(nextStaff(PREV, { kind: 'unknown_role', role: 'sommelier' })).toBeNull();
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
  it('is well under the token lifetime it exists to shorten, and not a hammer', () => {
    expect(ROLE_RECHECK_MS).toBeLessThan(5 * 60_000);
    expect(ROLE_RECHECK_MS).toBeGreaterThanOrEqual(30_000);
  });
});

describe('teams, the twins of app.staff_team and app.staff_team_head (0170)', () => {
  it('puts the bar and kitchen roles in their team and every other role in none', () => {
    const teams = Object.fromEntries(STAFF_ROLES.map((role) => [role, teamOf(role)]));
    expect(teams).toEqual({
      cashier: null,
      prep: null,
      court_desk: null,
      manager: null,
      owner: null,
      head_barista: 'bar',
      barista: 'bar',
      head_chef: 'kitchen',
      chef: 'kitchen',
      driver: null,
      marketing: null,
    });
  });

  it('names each team’s head, who belongs to that team', () => {
    expect(STAFF_TEAMS).toEqual(['bar', 'kitchen']);
    expect(TEAM_HEAD).toEqual({ bar: 'head_barista', kitchen: 'head_chef' });
    for (const team of STAFF_TEAMS) expect(teamOf(TEAM_HEAD[team])).toBe(team);
  });
});

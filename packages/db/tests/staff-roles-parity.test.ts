/**
 * One role list, five copies that cannot import it (build-contracts-2026-09-23 §7.1).
 *
 * `STAFF_ROLES` lives in @touch/core (packages/core/src/staff/roles.ts), which
 * the operator and the phone import. Four places cannot: Deno cannot import a
 * workspace package, so the edge functions keep their own `StaffRole` union
 * (_shared/auth.ts) and staff-admin its create lists (staff-admin/role.ts); the
 * Electron shell and the renderer's bridge each hand-write a `Role` union for
 * the IPC types. A role added to the enum and to one copy but not another is
 * an account the shell cannot name or staff-admin cannot create, so each copy
 * is compared here, and, with the stack up, the enum itself.
 *
 * The unions are compared as sets (a union has no order); the enum in its own
 * order, which STAFF_ROLES promises to follow.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STAFF_ROLES } from '../../core/src/staff/roles';
import { STOCK_LOCATIONS } from '../../core/src/staff/stores';
import { RETIRED_ROLES, ROLES } from '../supabase/functions/staff-admin/role';
import { stackAvailable } from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

/** The string members of `<decl> = | 'a' | 'b' …;` in a source file. */
function unionMembers(source: string, decl: string): string[] {
  const start = source.indexOf(decl);
  if (start < 0) throw new Error(`${decl} not found`);
  const body = source.slice(start + decl.length, source.indexOf(';', start));
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

const sorted = (list: readonly string[]) => [...list].sort();

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}
function dockerReachable(): boolean {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}
const docker = up && dockerReachable();

describe('staff roles: every copy equals @touch/core STAFF_ROLES', () => {
  it('the edge functions’ StaffRole union (_shared/auth.ts)', () => {
    const roles = unionMembers(read('../supabase/functions/_shared/auth.ts'), 'export type StaffRole =');
    expect(sorted(roles)).toEqual(sorted(STAFF_ROLES));
  });

  it('staff-admin’s ROLES and RETIRED_ROLES together, with no role in both', () => {
    expect(sorted([...ROLES, ...RETIRED_ROLES])).toEqual(sorted(STAFF_ROLES));
    expect(ROLES.filter((r) => (RETIRED_ROLES as readonly string[]).includes(r))).toEqual([]);
  });

  it('the shell’s Role union (apps/operator-shell/src/ipc-channels.ts)', () => {
    const roles = unionMembers(read('../../../apps/operator-shell/src/ipc-channels.ts'), 'export type Role =');
    expect(sorted(roles)).toEqual(sorted(STAFF_ROLES));
  });

  it('the renderer bridge’s Role union (apps/operator/src/ipc/bridge.ts)', () => {
    const roles = unionMembers(read('../../../apps/operator/src/ipc/bridge.ts'), 'export type Role =');
    expect(sorted(roles)).toEqual(sorted(STAFF_ROLES));
  });

  it('reads a union it can find (a renamed declaration would otherwise compare nothing)', () => {
    expect(() => unionMembers('type X = 1;', 'export type Role =')).toThrow();
  });
});

describe.skipIf(!docker)('staff roles: the database enum', () => {
  it('enum_range(null::staff_role) equals STAFF_ROLES, in the enum’s order', () => {
    const out = psql("select array_to_string(enum_range(null::staff_role), ',')");
    expect(out.split(',')).toEqual([...STAFF_ROLES]);
  });

  // Wave 5 §2.8 (lane S): the store list the apps offer is the enum's.
  it('enum_range(null::stock_location) equals @touch/core STOCK_LOCATIONS, in the enum’s order', () => {
    const out = psql("select array_to_string(enum_range(null::stock_location), ',')");
    expect(out.split(',')).toEqual([...STOCK_LOCATIONS]);
  });
});

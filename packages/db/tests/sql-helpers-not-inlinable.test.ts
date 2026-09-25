/**
 * sql_helpers_not_inlinable (security sweep 2026-09-25): a helper revoked from
 * the client roles stays revoked on a pooled PostgREST connection.
 *
 * PostgreSQL inlines a simple LANGUAGE sql function (not SECURITY DEFINER, no
 * SET clause) into the calling query and checks EXECUTE only while it plans.
 * PostgREST prepares each statement on a connection that all roles share. Once
 * service_role has run an RPC often enough for a generic plan (5 custom plans,
 * then generic), anon or authenticated reuse that plan with the body inlined
 * and skip the EXECUTE check. That is how the owner-gate assertion in
 * analytics.test.ts (normalize_finding must be "permission denied") failed when
 * the file ran twice within 30 s. A SET clause stops the inlining, and so does
 * another language: plpgsql is never inlined (the four helpers that run once
 * per row are plpgsql now, the other six SQL with a SET clause).
 *
 * Neither stops constant folding. The planner runs an IMMUTABLE function whose
 * arguments are all constants while it plans, in any language, and keeps the
 * result in the plan; EXECUTE is checked then, for the role that plans.
 * PostgREST binds RPC arguments as parameters, so only a function callable
 * with no argument at all reaches the planner with nothing but constants.
 *
 *   1. Guard: no revoked, non-definer sql function in app or public lacks a SET
 *      clause (extension-owned functions excepted: no migration writes them).
 *   2. The guard notices a new sql offender and passes a plpgsql one (both are
 *      planted in a rolled-back transaction).
 *   3. The reproduction: warm a generic plan as service_role, then EXECUTE it
 *      as authenticated and as anon. It runs for the three helpers service_role
 *      holds, plus two controls: a no-SET copy that must still leak (else the
 *      harness proves nothing) and a SET copy that must not.
 *   4. FOLDABLE guard: no IMMUTABLE function in app or public that needs no
 *      argument is held by an API role but not by both client roles.
 *   5. FOLDABLE notices planted probes and passes the controls, and a planted
 *      probe does leak through a cached plan (why the guard exists).
 *
 * Needs the local stack AND docker on PATH (psql runs in the stack's own
 * container, as rpc-overloads.test.ts and check-safe-update.mjs do); skips
 * itself otherwise. Every write happens in a transaction that is rolled back.
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

/** Runs a psql script; ON_ERROR_STOP is off so an expected 42501 does not end it. */
function psql(sql: string, stopOnError = true): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At',
      '-v', `ON_ERROR_STOP=${stopOnError ? 1 : 0}`],
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

/** The class: a sql function the planner may inline that a client role may not EXECUTE. */
const OFFENDERS = `
  select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
   where n.nspname in ('app', 'public')
     and p.prokind = 'f'
     and l.lanname = 'sql'
     and not p.prosecdef
     and p.proconfig is null
     and not (has_function_privilege('anon', p.oid, 'EXECUTE')
              and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
   order by 1`;

/**
 * The class constant folding reaches: IMMUTABLE, one result (not a set),
 * callable with no argument (every argument has a default), and an API role
 * can plan it while a client role may not run it. service_role plants the plan
 * for both client roles; one client role holding it alone plants it for the
 * other. The fix is any of: STABLE (folded only for estimates, never into the
 * plan), a required argument (PostgREST binds it as a parameter), or a grant to
 * both client roles (then there is nothing to skip).
 */
const FOLDABLE = `
  select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'public')
     and p.prokind = 'f'
     and p.provolatile = 'i'
     and not p.proretset
     and p.pronargs = p.pronargdefaults
     and (has_function_privilege('service_role', p.oid, 'EXECUTE')
          or has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     and not (has_function_privilege('anon', p.oid, 'EXECUTE')
              and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
   order by 1`;

const lines = (out: string) => (out ? out.split('\n') : []);

type Case = { label: string; types: string; call: string; args: string };

/**
 * One case, inside the caller's transaction. It warms a generic plan as
 * service_role, then EXECUTEs that plan and makes a fresh call as authenticated
 * and as anon. Each step echoes "<label> <step> <SQLSTATE>" (00000 = ran,
 * 42501 = permission denied); a savepoint absorbs each expected error.
 */
function caseScript({ label, types, call, args }: Case): string {
  const fresh = call.replace(/\$\d(,\s*\$\d)*/, args);
  const warm = Array.from({ length: 7 }, () => `execute p_${label}(${args}) \\g /dev/null`).join('\n');
  const asRole = (role: string) => `
set local role ${role};
savepoint s;
execute p_${label}(${args}) \\g /dev/null
\\echo ${label} ${role}_cached :SQLSTATE
rollback to savepoint s;
select ${fresh} \\g /dev/null
\\echo ${label} ${role}_fresh :SQLSTATE
rollback to savepoint s;`;
  return `
set local role service_role;
prepare p_${label}(${types}) as select ${call};
${warm}
\\echo ${label} service_role_warm :SQLSTATE
reset role;
\\unset generic_plans
select generic_plans from pg_prepared_statements where name = 'p_${label}' \\gset
\\echo ${label} generic_plans :generic_plans
${asRole('authenticated')}
${asRole('anon')}
reset role;
deallocate p_${label};`;
}

const HELPERS: Case[] = [
  { label: 'normalize_finding', types: 'text', call: 'app.normalize_finding($1)', args: `'Leak!'` },
  {
    label: 'business_date3', types: 'timestamptz, text, int',
    call: 'app.business_date($1, $2, $3)', args: `now(), 'Asia/Baghdad', 4`,
  },
  { label: 'reports_bucket', types: 'date, text', call: 'app.reports_bucket($1, $2)', args: `current_date, 'month'` },
];
const CONTROLS: Case[] = [
  { label: 'probe_no_set', types: 'text', call: 'app.__inline_probe_no_set($1)', args: `'x'` },
  { label: 'probe_set', types: 'text', call: 'app.__inline_probe_set($1)', args: `'x'` },
];

describe.skipIf(!docker)('sql_helpers_not_inlinable: a revoked sql helper stays revoked', () => {
  it('no revoked, non-definer sql function in app or public is without a SET clause', () => {
    expect(
      lines(psql(OFFENDERS)),
      'give each listed function `set search_path = public` (a SET clause stops inlining), or make it security definer',
    ).toEqual([]);
  });

  it('the guard lists a new sql offender and passes a plpgsql helper (planted in a rolled-back transaction)', () => {
    const out = psql(`
begin;
create function app.__inline_probe(p int) returns int language sql immutable as $$ select p + 1 $$;
create function app.__inline_probe_plpgsql(p int) returns int language plpgsql immutable as $$ begin return p + 1; end $$;
revoke all on function app.__inline_probe(int), app.__inline_probe_plpgsql(int) from public, anon, authenticated;
${OFFENDERS};
rollback;`);
    expect(lines(out)).toContain('app.__inline_probe(p integer)');
    // plpgsql is never inlined: the four per-row helpers are written this way.
    expect(lines(out)).not.toContain('app.__inline_probe_plpgsql(p integer)');
  });

  it('a generic plan warmed by service_role does not let authenticated or anon run a revoked helper', () => {
    const out = psql(
      `
begin;
create function app.__inline_probe_no_set(p text) returns text language sql immutable as $$ select upper(p) $$;
create function app.__inline_probe_set(p text) returns text language sql immutable set search_path = public as $$ select upper(p) $$;
revoke all on function app.__inline_probe_no_set(text), app.__inline_probe_set(text) from public, anon, authenticated;
grant execute on function app.__inline_probe_no_set(text), app.__inline_probe_set(text) to service_role;
${[...HELPERS, ...CONTROLS].map(caseScript).join('\n')}
rollback;`,
      false,
    );
    const got = new Map(lines(out).map((l) => {
      const [label, step, state] = l.split(' ');
      return [`${label} ${step}`, state] as const;
    }));
    const at = (label: string, step: string) => got.get(`${label} ${step}`);

    for (const { label } of [...HELPERS, ...CONTROLS]) {
      expect(at(label, 'service_role_warm'), `${label}: service_role runs it`).toBe('00000');
      expect(Number(at(label, 'generic_plans')), `${label}: a generic plan was cached`).toBeGreaterThan(0);
      expect(at(label, 'authenticated_fresh'), `${label}: fresh call as authenticated`).toBe('42501');
      expect(at(label, 'anon_fresh'), `${label}: fresh call as anon`).toBe('42501');
    }
    for (const { label } of [...HELPERS, CONTROLS[1]!]) {
      expect(at(label, 'authenticated_cached'), `${label}: cached plan as authenticated`).toBe('42501');
      expect(at(label, 'anon_cached'), `${label}: cached plan as anon`).toBe('42501');
    }
    // The control with no SET clause must still leak. If it stops leaking, this
    // Postgres re-checks EXECUTE on inlined functions, and the SET-clause rule
    // can be revisited. Until then, this is what shows the harness can see a leak.
    expect(at('probe_no_set', 'authenticated_cached'), 'no-SET control leaks to authenticated').toBe('00000');
    expect(at('probe_no_set', 'anon_cached'), 'no-SET control leaks to anon').toBe('00000');
  });

  it('no IMMUTABLE function that needs no argument is held by an API role but not by both client roles', () => {
    expect(
      lines(psql(FOLDABLE)),
      'make it STABLE, give it a required argument, or grant it to both client roles',
    ).toEqual([]);
  });

  it('FOLDABLE lists planted probes, passes the controls, and a planted probe leaks through a cached plan', () => {
    const probes = ['app.__fold_probe()', 'app.__fold_probe_default(p integer)', 'app.__fold_probe_auth()'];
    const controls = ['app.__fold_probe_arg(p integer)', 'app.__fold_probe_stable()', 'app.__fold_probe_clients()'];
    const out = psql(
      `
begin;
-- listed: service_role holds them, no client role does (plpgsql, and a SET
-- clause, change nothing); one client role holds the third
create function app.__fold_probe() returns int language plpgsql immutable as $$ begin return 42; end $$;
create function app.__fold_probe_default(p int default 1) returns int language sql immutable set search_path = public as $$ select p $$;
create function app.__fold_probe_auth() returns int language plpgsql immutable as $$ begin return 42; end $$;
-- not listed: a required argument; STABLE; both client roles hold it
create function app.__fold_probe_arg(p int) returns int language plpgsql immutable as $$ begin return p; end $$;
create function app.__fold_probe_stable() returns int language plpgsql stable as $$ begin return 42; end $$;
create function app.__fold_probe_clients() returns int language plpgsql immutable as $$ begin return 42; end $$;
revoke all on function app.__fold_probe(), app.__fold_probe_default(int), app.__fold_probe_auth(),
  app.__fold_probe_arg(int), app.__fold_probe_stable(), app.__fold_probe_clients() from public, anon, authenticated;
grant execute on function app.__fold_probe(), app.__fold_probe_default(int),
  app.__fold_probe_arg(int), app.__fold_probe_stable() to service_role;
grant execute on function app.__fold_probe_auth() to authenticated;
grant execute on function app.__fold_probe_clients() to anon, authenticated;
${FOLDABLE};
-- the hole: planned once as service_role, the call is a constant in the plan
set local role service_role;
prepare p_fold as select app.__fold_probe();
execute p_fold \\g /dev/null
\\echo leak service_role_warm :SQLSTATE
reset role;
set local role anon;
savepoint s;
execute p_fold \\g /dev/null
\\echo leak anon_cached :SQLSTATE
rollback to savepoint s;
select app.__fold_probe() \\g /dev/null
\\echo leak anon_fresh :SQLSTATE
rollback to savepoint s;
reset role;
deallocate p_fold;
rollback;`,
      false,
    );
    const listed = lines(out).filter((l) => l.startsWith('app.'));
    for (const p of probes) expect(listed, p).toContain(p);
    for (const c of controls) expect(listed, c).not.toContain(c);
    const got = new Map(lines(out).filter((l) => l.startsWith('leak ')).map((l) => {
      const [, step, state] = l.split(' ');
      return [step, state] as const;
    }));
    expect(got.get('service_role_warm'), 'service_role runs it').toBe('00000');
    // Folded while service_role planned: anon reuses the plan and never calls
    // the function. A fresh call is planned as anon and refused.
    expect(got.get('anon_cached'), 'cached plan as anon (leaks: the class FOLDABLE keeps empty)').toBe('00000');
    expect(got.get('anon_fresh'), 'fresh call as anon').toBe('42501');
  });
});

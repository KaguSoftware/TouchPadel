/**
 * 0119 — no accidental overloads in schema app, proved against pg_proc.
 *
 * The static gate (check-rpc-registry.mjs + scripts/lib/fn-signatures.mjs)
 * replays the migration text; this is the catalog truth it approximates. Both
 * read fixtures/rpc-overloads.json, so a deliberate overload is declared once.
 *
 * Needs the local stack AND docker on PATH (pg_proc is read through psql in the
 * stack's own container, as check-safe-update.mjs does); skips itself otherwise.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

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

const allowed = JSON.parse(readFileSync(path.join(import.meta.dirname, '../fixtures/rpc-overloads.json'), 'utf8')) as {
  allowed: Record<string, string>;
};

function identityArgs(name: string): string[] {
  const out = psql(
    `select pg_get_function_identity_arguments(p.oid)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = '${name}'
      order by 1`,
  );
  return out ? out.split('\n') : [];
}

describe.skipIf(!docker)('0119 overloads in schema app', () => {
  it('every name with more than one live signature is a declared, deliberate overload', () => {
    const out = psql(
      `select p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app'
        group by 1 having count(*) > 1
        order by 1`,
    );
    const overloaded = out ? out.split('\n') : [];
    expect(overloaded).toEqual(Object.keys(allowed.allowed).sort());
  });

  it('apply_discount and override_price each have exactly the 0049 signature (with p_idempotency_key)', () => {
    expect(identityArgs('apply_discount')).toEqual([
      'p_tab_id uuid, p_kind adjustment_kind, p_value integer, p_pin text, p_reason_code text, p_order_item_id uuid, p_device_id text, p_idempotency_key text',
    ]);
    expect(identityArgs('override_price')).toEqual([
      'p_order_item_id uuid, p_new_unit_price_iqd bigint, p_pin text, p_reason_code text, p_device_id text, p_idempotency_key text',
    ]);
  });

  it('the surviving bodies are the 0119 ones (grant model + claim_replay), and the strays are gone', () => {
    const tags = psql(
      `select p.proname, position('consume_pin_grant' in p.prosrc) > 0, position('claim_replay' in p.prosrc) > 0
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname in ('apply_discount', 'override_price')
        order by 1`,
    );
    expect(tags.split('\n')).toEqual(['apply_discount|t|t', 'override_price|t|t']);
  });
});

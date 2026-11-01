/**
 * 0380 tax_zero (F-06): every tax rate is 0, so the till's offline estimate
 * (which carries no tax) and the server's total agree. The tax arithmetic
 * itself is still proved in cafe-money.test.ts with a rate set for the test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { docker, scenario, Q, FX } from './psql-scenario';

const SEED = readFileSync(fileURLToPath(new URL('../supabase/seed.sql', import.meta.url)), 'utf8');

describe('0380 seed', () => {
  it('seeds every tax group at 0', () => {
    const block = SEED.slice(SEED.indexOf('insert into tax_groups'), SEED.indexOf('on conflict', SEED.indexOf('insert into tax_groups')));
    const rates = [...block.matchAll(/'[^']*',\s*'[^']*',\s*'[^']*',\s*(\d+),\s*(?:true|false)\)/g)].map((m) => Number(m[1]));
    expect(rates.length).toBeGreaterThanOrEqual(2);
    expect(rates.every((r) => r === 0)).toBe(true);
  });
});

describe.skipIf(!docker)('0380 tax_zero', () => {
  it('holds no non-zero rate, and a new group defaults to 0', () => {
    const r = scenario([
      Q('nonzero', `select to_jsonb(count(*)) from tax_groups where rate_bp <> 0`),
      FX(`insert into tax_groups (venue_id, name_en, name_ar) values ({{venue}}::uuid, 'ldb tax', 'ضريبة')`),
      Q('fresh', `select to_jsonb(rate_bp) from tax_groups where name_en = 'ldb tax'`),
    ]);
    expect(r.nonzero?.data).toBe(0);
    expect(r.fresh?.data).toBe(0);
  });
});

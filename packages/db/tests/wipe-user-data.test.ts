/**
 * scripts/wipe-user-data.mjs, the go-live wipe of everything collected from
 * users (Majed 2026-10-11), in its DRY RUN: the whole wipe runs and checks
 * itself inside a transaction that is then rolled back. This keeps it working
 * as the schema grows: a new table that fixtures/wipe-user-data.json does not
 * place, or a new link from a kept table to a wiped one, fails here first.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serviceClient, stackAvailable } from './helpers';

const up = await stackAvailable();
const root = join(__dirname, '..');

describe('wipe-user-data', () => {
  it('lists every table once, keeping the setup the owner named', () => {
    const plan = JSON.parse(readFileSync(join(root, 'fixtures', 'wipe-user-data.json'), 'utf8')) as {
      keep: Record<string, string>;
      wipe: Record<string, string>;
    };
    const keep = Object.keys(plan.keep);
    const wipe = Object.keys(plan.wipe);
    expect(keep.filter((t) => wipe.includes(t))).toEqual([]);
    for (const t of ['menu_items', 'menu_item_variants', 'courts', 'rate_rules', 'recipe_lines', 'ingredients', 'staff', 'venues', 'venue_settings']) {
      expect(keep, t).toContain(t);
    }
    for (const t of ['profiles', 'reservations', 'tabs', 'orders', 'payments', 'audit_log', 'loyalty_accounts', 'customer_notes']) {
      expect(wipe, t).toContain(t);
    }
  });

  it.skipIf(!up)('dry run: wipes and checks inside a transaction, then changes nothing', async () => {
    const svc = serviceClient();
    const count = async (t: string) => (await svc.from(t).select('*', { count: 'exact', head: true })).count;
    const before = { reservations: await count('reservations'), menu_items: await count('menu_items') };

    const out = execFileSync('node', ['scripts/wipe-user-data.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' },
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(out).toMatch(/DRY RUN: rolled back, nothing changed/);
    expect(out).toMatch(/== totals ==\nerased rows: \d+, kept tables: \d+, wiped tables: \d+/);

    expect(await count('reservations')).toBe(before.reservations);
    expect(await count('menu_items')).toBe(before.menu_items);
  }, 600_000);

  it('refuses a remote database without --hosted, and a commit there without WIPE_CONFIRM', () => {
    const run = (args: string[], env: Record<string, string>) => {
      try {
        execFileSync('node', ['scripts/wipe-user-data.mjs', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, stdio: 'pipe' });
        return { status: 0, err: '' };
      } catch (e) {
        const x = e as { status: number; stderr: string };
        return { status: x.status, err: x.stderr };
      }
    };
    const remote = { DATABASE_URL: 'postgresql://postgres:x@db.example.supabase.co:5432/postgres', WIPE_CONFIRM: '' };
    expect(run([], remote)).toMatchObject({ status: 2, err: expect.stringMatching(/not the local stack/) });
    expect(run(['--hosted', '--execute'], remote)).toMatchObject({ status: 2, err: expect.stringMatching(/WIPE_CONFIRM=db\.example\.supabase\.co/) });
  });
});

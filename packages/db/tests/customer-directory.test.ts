/**
 * 0144 — customer_directory: the desk's whole customer book in one read.
 *
 * Asserted: the guard (a guest is refused, desk and cashier read), the row
 * shape the Customers screen binds to (same field names as customer_search),
 * counts and flags computed set-wise matching the per-customer helpers,
 * tombstones and active staff accounts left out, and the cap reporting `truncated` with the real total.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stackAvailable, serviceClient, signedInClient, guestClient, appRpc, SEED_STAFF, DEV_PASSWORD } from './helpers';

const up = await stackAvailable();

interface DirectoryRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  flags: { type: string; label: string | null }[];
  counts: { bookings: number; cancellations: number; noShows: number };
}
interface Directory {
  rows: DirectoryRow[];
  total: number;
  truncated: boolean;
}

describe.skipIf(!up)('0144 customer_directory', () => {
  let svc: SupabaseClient;
  let desk: SupabaseClient;
  let cashier: SupabaseClient;
  let guest: SupabaseClient;
  const tag = `dir${Date.now()}`;
  const users: string[] = [];
  let liveId: string;
  let goneId: string;

  async function makeCustomer(fullName: string): Promise<string> {
    const { data, error } = await svc.auth.admin.createUser({
      email: `${tag}-${users.length}@test.touch.local`,
      password: DEV_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName, phone: '+9647701112233' },
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    users.push(data.user.id);
    return data.user.id;
  }

  beforeAll(async () => {
    svc = serviceClient();
    desk = await signedInClient(SEED_STAFF.court_desk);
    cashier = await signedInClient(SEED_STAFF.cashier);
    guest = await guestClient(svc, tag);
    liveId = await makeCustomer(`Directory Live ${tag}`);
    goneId = await makeCustomer(`Directory Gone ${tag}`);
    const flag = await appRpc(desk, 'set_customer_flags', { p_customer_id: liveId, p_flags: [{ type: 'vip' }] });
    if (flag.error) throw new Error(flag.error.message);
    const del = await svc.from('profiles').update({ deleted_at: new Date().toISOString() }).eq('id', goneId);
    if (del.error) throw new Error(del.error.message);
  });

  afterAll(async () => {
    for (const id of users) await svc.auth.admin.deleteUser(id);
  });

  it('refuses a guest and serves the desk and the cashier', async () => {
    const g = await appRpc(guest, 'customer_directory', {});
    expect(g.error?.message).toMatch(/FORBIDDEN/);
    for (const c of [desk, cashier]) {
      const r = await appRpc(c, 'customer_directory', {});
      expect(r.error).toBeNull();
    }
  });

  it('lists live customers with the search row shape, and leaves tombstones out', async () => {
    const r = await appRpc(desk, 'customer_directory', {});
    const d = r.data as Directory;
    const live = d.rows.find((x) => x.id === liveId);
    expect(live).toMatchObject({
      full_name: `Directory Live ${tag}`,
      email: `${tag}-0@test.touch.local`,
      flags: [{ type: 'vip', label: null }],
      counts: { bookings: 0, cancellations: 0, noShows: 0 },
    });
    expect(d.rows.some((x) => x.id === goneId)).toBe(false);
    const { data: staffRows } = await svc.from('staff').select('id').eq('is_active', true);
    const staffIds = new Set((staffRows ?? []).map((s: { id: string }) => s.id));
    expect(d.rows.some((x) => staffIds.has(x.id))).toBe(false);
    expect(d.total).toBe(d.rows.length);
    expect(d.truncated).toBe(false);
  });

  it('agrees with customer_search on the same customer', async () => {
    const search = await appRpc(desk, 'customer_search', { p_query: `Directory Live ${tag}` });
    const hit = (search.data as DirectoryRow[])[0]!;
    const d = (await appRpc(desk, 'customer_directory', {})).data as Directory;
    const row = d.rows.find((x) => x.id === liveId)!;
    expect(row.counts).toEqual(hit.counts);
    expect(row.flags).toEqual(hit.flags);
    expect(row.phone).toBe(hit.phone);
  });

  it('caps the list and says so, with the real total', async () => {
    const d = (await appRpc(desk, 'customer_directory', { p_limit: 1 })).data as Directory;
    expect(d.rows).toHaveLength(1);
    expect(d.total).toBeGreaterThan(1);
    expect(d.truncated).toBe(true);
  });
});

/**
 * 0449 — the full ban and customer tags with a rule.
 *
 * A night at the desk: the desk bans a customer and from that moment the
 * phone app answers them nothing, no desk can book, seat or bill them, a game
 * they already played can still be paid, and lifting the ban opens it all
 * again. The manager sets up a "Family 15%" tag, the cashier puts it on a
 * customer, and the café bill and the court fee both drop by 15%, authorised
 * by whoever put the tag on; the customer's own discount still wins where it
 * sets a part, and nobody tags themselves into a discount.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  guestClient,
  appRpc,
  testIdemKey,
  DEV_PASSWORD,
  SEED_STAFF,
  SEED_STAFF_IDS,
  createTestMenuItem,
  createTestCourt,
  createTestCafeTable,
  ensureOpenDay,
  ensureTillFresh,
} from './helpers';
import { psql } from './psql-scenario';

const up = await stackAvailable();

function errCode(e: { message: string } | null): string | null {
  return e ? e.message : null;
}

type Tag = { id: string; name: string; cafe_bp: number | null; court_bp: number | null };
type Read = {
  ban: { reason: string; by: { id: string; name: string } | null; at: string } | null;
  tags: (Tag & { set_by: { id: string } })[];
  effective: {
    cafe: { kind: string; value: number; tag: string | null } | null;
    court: { kind: string; value: number; tag: string | null } | null;
    reason: string;
  } | null;
  coming: { bookings: number; seats: number };
  is_staff: boolean;
  catalog: (Tag & { members: number })[];
  can_manage: boolean;
};

describe.skipIf(!up)('0449 customer ban and tags', () => {
  let svc: SupabaseClient;
  let desk: SupabaseClient;
  let cashier: SupabaseClient;
  let manager: SupabaseClient;
  let owner: SupabaseClient;
  let bannedApp: SupabaseClient;
  let bannedId: string;
  let bannedEmail: string;
  let taggedId: string;
  let courtId: string;
  let drink: Awaited<ReturnType<typeof createTestMenuItem>>;
  const tagIds: string[] = [];

  let slot = 0;
  async function makeBooking(priceIqd: number, guestId: string | null, client?: SupabaseClient) {
    const start = new Date(Date.now() + (90 + slot++) * 86_400_000);
    start.setUTCHours(12, 0, 0, 0);
    return (client ?? svc)
      .from('reservations')
      .insert({
        court_id: courtId,
        kind: 'booking',
        status: 'confirmed',
        source: 'desk',
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + 60 * 60_000).toISOString(),
        guest_id: guestId,
        guest_name: guestId ? null : 'Ban Walk-in',
        price_iqd: priceIqd,
      })
      .select('id')
      .single();
  }

  async function bookingId(priceIqd: number, guestId: string | null): Promise<string> {
    const { data, error } = await makeBooking(priceIqd, guestId);
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  async function cafeTab(): Promise<string> {
    const res = await appRpc(cashier, 'open_tab', {
      p_table_id: await createTestCafeTable(svc, 'ban'),
      p_idempotency_key: testIdemKey('tab.open'),
    });
    if (res.error) throw new Error(`open_tab: ${res.error.message}`);
    return (res.data as { tab_id: string }).tab_id;
  }

  async function read(client: SupabaseClient, id: string | null): Promise<Read> {
    const res = await appRpc(client, 'customer_ban_and_tags', { p_customer_id: id });
    if (res.error) throw new Error(`customer_ban_and_tags: ${res.error.message}`);
    return res.data as Read;
  }

  async function saveTag(client: SupabaseClient, args: Record<string, unknown>) {
    const res = await appRpc(client, 'save_customer_tag', args);
    if (!res.error) tagIds.push((res.data as Tag).id);
    return res;
  }

  beforeAll(async () => {
    svc = serviceClient();
    desk = await signedInClient(SEED_STAFF.court_desk);
    cashier = await signedInClient(SEED_STAFF.cashier);
    manager = await signedInClient(SEED_STAFF.manager);
    owner = await signedInClient(SEED_STAFF.owner);
    await ensureTillFresh(svc);
    await ensureOpenDay(manager, svc);
    courtId = await createTestCourt(svc, `Ban ${Date.now()}`);
    drink = await createTestMenuItem(svc, 'ban-drink', 10_000);
    bannedApp = await guestClient(svc, 'ban-me');
    const u = (await bannedApp.auth.getUser()).data.user!;
    bannedId = u.id;
    bannedEmail = u.email!;
    const t = await guestClient(svc, 'tag-me');
    taggedId = (await t.auth.getUser()).data.user!.id;
    await t.auth.signOut();
  });

  afterAll(async () => {
    if (bannedId) {
      await svc.from('customer_flags').delete().eq('customer_id', bannedId);
      await svc.auth.admin.updateUserById(bannedId, { ban_duration: 'none' });
    }
    if (tagIds.length) await svc.from('customer_tags').delete().in('id', tagIds);
    if (taggedId) await svc.from('customer_discounts').delete().eq('customer_id', taggedId);
    await Promise.all([desk, cashier, manager, owner].map((c) => c.auth.signOut()));
  });

  // ── the ban ───────────────────────────────────────────────────────────────

  it('the desk bans with a reason; the cashier may not; staff cannot be banned', async () => {
    expect(errCode((await appRpc(cashier, 'set_customer_ban', { p_customer_id: bannedId, p_banned: true, p_reason: 'x' })).error))
      .toBe('FORBIDDEN');
    expect(errCode((await appRpc(desk, 'set_customer_ban', { p_customer_id: bannedId, p_banned: true, p_reason: '  ' })).error))
      .toBe('REASON_REQUIRED');
    expect(errCode((await appRpc(desk, 'set_customer_ban', { p_customer_id: SEED_STAFF_IDS.cashier, p_banned: true, p_reason: 'x' })).error))
      .toBe('CUSTOMER_IS_STAFF');

    // A booking made before the ban, still coming.
    const before = await bookingId(40_000, bannedId);

    const ban = await appRpc(desk, 'set_customer_ban', { p_customer_id: bannedId, p_banned: true, p_reason: 'Fought at the bar' });
    expect(ban.error).toBeNull();
    expect(ban.data).toMatchObject({ banned: true, duplicate: false });
    expect((await appRpc(desk, 'set_customer_ban', { p_customer_id: bannedId, p_banned: true, p_reason: 'Fought at the bar' })).data)
      .toMatchObject({ duplicate: true });

    const r = await read(desk, bannedId);
    expect(r.ban).toMatchObject({ reason: 'Fought at the bar', by: { id: SEED_STAFF_IDS.court_desk } });
    expect(r.coming.bookings).toBeGreaterThanOrEqual(1);

    // It shows wherever flags show.
    const search = await appRpc(desk, 'customer_record', { p_customer_id: bannedId });
    expect((search.data as { flags: { type: string; label: string }[] }).flags).toContainEqual({ type: 'ban', label: 'Fought at the bar' });

    // A flag edit never lifts it.
    expect(errCode((await appRpc(desk, 'set_customer_flags', { p_customer_id: bannedId, p_flags: [{ type: 'ban' }] })).error))
      .toBe('INVALID_FLAG');
    expect((await appRpc(desk, 'set_customer_flags', { p_customer_id: bannedId, p_flags: [{ type: 'vip' }] })).error).toBeNull();
    expect((await read(desk, bannedId)).ban).not.toBeNull();

    const { data: audit } = await svc
      .from('audit_log')
      .select('action, actor_id')
      .eq('entity', 'customer_flags')
      .eq('entity_id', bannedId)
      .eq('action', 'customer.ban');
    expect(audit?.length).toBeGreaterThanOrEqual(1);

    // The booking made before stays; its bill can still be opened and paid.
    const { data: still } = await svc.from('reservations').select('status').eq('id', before).single();
    expect(still).toMatchObject({ status: 'confirmed' });
    const bill = await appRpc(desk, 'open_tab', {
      p_reservation_id: before,
      p_idempotency_key: testIdemKey('tab.open'),
    });
    expect(errCode(bill.error) ?? '').not.toBe('CUSTOMER_BANNED');
  });

  it('the banned account gets nothing from the API, and cannot sign in again', async () => {
    const call = await appRpc(bannedApp, 'release_hold', { p_reservation_id: crypto.randomUUID() });
    expect(errCode(call.error)).toBe('CUSTOMER_BANNED');
    const rows = await bannedApp.from('courts').select('id').limit(1);
    expect(rows.error?.message).toBe('CUSTOMER_BANNED');

    expect(psql(`select banned_until = 'infinity' from auth.users where id = '${bannedId}'`)).toBe('t');
    expect(psql(`select count(*) from auth.sessions where user_id = '${bannedId}'`)).toBe('0');
    await expect(signedInClient(bannedEmail, DEV_PASSWORD)).rejects.toThrow();
  });

  it('no desk, till or service writer can give them a new booking, seat, place or bill', async () => {
    const booking = await makeBooking(40_000, bannedId);
    expect(booking.error?.message).toBe('CUSTOMER_BANNED');

    // A nameless booking given the banned customer afterwards.
    const walkIn = await bookingId(40_000, null);
    const { error: attachErr } = await svc.from('reservations').update({ guest_id: bannedId, guest_name: null }).eq('id', walkIn);
    expect(attachErr?.message).toBe('CUSTOMER_BANNED');

    // A café bill: the member attach at the till.
    const tab = await cafeTab();
    const { error: tabErr } = await svc.from('tabs').update({ customer_id: bannedId, customer_method: 'desk' }).eq('id', tab);
    expect(tabErr?.message).toBe('CUSTOMER_BANNED');

    // The till's own RPC refuses the same way.
    const add = await appRpc(cashier, 'till_add_items', {
      p_tab_id: tab,
      p_items: [{ variant_id: drink.variantId, qty: 1 }],
      p_idempotency_key: testIdemKey('order.add_items'),
    });
    expect(add.error).toBeNull();
  });

  it('lifting the ban opens everything again', async () => {
    expect(errCode((await appRpc(cashier, 'set_customer_ban', { p_customer_id: bannedId, p_banned: false })).error)).toBe('FORBIDDEN');
    const lift = await appRpc(manager, 'set_customer_ban', { p_customer_id: bannedId, p_banned: false, p_reason: 'Apologised' });
    expect(lift.error).toBeNull();
    expect(lift.data).toMatchObject({ banned: false, duplicate: false });
    expect((await read(desk, bannedId)).ban).toBeNull();
    // The vip flag set during the ban survived.
    const rec = await appRpc(desk, 'customer_record', { p_customer_id: bannedId });
    expect((rec.data as { flags: { type: string }[] }).flags.map((f) => f.type)).toEqual(['vip']);

    const again = await signedInClient(bannedEmail, DEV_PASSWORD);
    const rows = await again.from('courts').select('id').limit(1);
    expect(rows.error).toBeNull();
    await again.auth.signOut();
    const booking = await makeBooking(40_000, bannedId);
    expect(booking.error).toBeNull();
  });

  it('a merge carries the ban to the account kept', async () => {
    const a = await guestClient(svc, 'ban-drop');
    const dropId = (await a.auth.getUser()).data.user!.id;
    await a.auth.signOut();
    const b = await guestClient(svc, 'ban-keep');
    const keepId = (await b.auth.getUser()).data.user!.id;
    await b.auth.signOut();
    expect((await appRpc(desk, 'set_customer_ban', { p_customer_id: dropId, p_banned: true, p_reason: 'Stole a racket' })).error).toBeNull();
    // The merge writes its record last (walk-in claim: flags stay on the drop).
    const out = psql(`begin;
      insert into app.profile_merges (keep_id, drop_id, reason) values ('${keepId}', '${dropId}', 'walkin_claim');
      select label from customer_flags where customer_id = '${keepId}' and type = 'ban';
      rollback;`);
    expect(out).toBe('Stole a racket');
    await svc.from('customer_flags').delete().eq('customer_id', dropId);
  });

  // ── tags ──────────────────────────────────────────────────────────────────

  it('a manager sets up tags; the desk cannot; names are unique ignoring case', async () => {
    expect(errCode((await appRpc(desk, 'save_customer_tag', { p_name: 'Family', p_cafe_bp: 1500 })).error)).toBe('FORBIDDEN');
    const fam = await saveTag(manager, { p_name: ` Family ${Date.now()} `, p_cafe_bp: 1500, p_court_bp: 1500 });
    expect(fam.error).toBeNull();
    const famTag = fam.data as Tag;
    expect(famTag.name).toBe(famTag.name.trim());
    expect(errCode((await appRpc(owner, 'save_customer_tag', { p_name: famTag.name.toUpperCase() })).error)).toBe('TAG_NAME_TAKEN');
    expect(errCode((await appRpc(owner, 'save_customer_tag', { p_name: 'Over', p_cafe_bp: 10_001 })).error)).toBe('INVALID_VALUE');
    const plain = await saveTag(owner, { p_name: `Regular ${Date.now()}` });
    expect(plain.error).toBeNull();
    const sponsor = await saveTag(owner, { p_name: `Sponsor ${Date.now()}`, p_court_bp: 3000 });
    expect(sponsor.error).toBeNull();

    const cat = await read(cashier, null);
    expect(cat.can_manage).toBe(false);
    expect(cat.catalog.map((t) => t.id)).toEqual(expect.arrayContaining(tagIds));
  });

  it('the cashier tags a customer and both the café bill and the court fee drop, authorised by them', async () => {
    const [famId, plainId, sponsorId] = tagIds;
    const set = await appRpc(cashier, 'set_customer_tags', { p_customer_id: taggedId, p_tag_ids: [famId, plainId] });
    expect(set.error).toBeNull();
    expect((set.data as { effective: Read['effective'] }).effective).toMatchObject({
      cafe: { kind: 'percent', value: 1500 },
      court: { kind: 'percent', value: 1500 },
      reason: 'tag',
    });

    // Café: the till refreshes the customer discount, 15% of 2 drinks.
    const tab = await cafeTab();
    await svc.from('tabs').update({ customer_id: taggedId, customer_method: 'desk' }).eq('id', tab);
    await appRpc(cashier, 'till_add_items', {
      p_tab_id: tab,
      p_items: [{ variant_id: drink.variantId, qty: 2 }],
      p_idempotency_key: testIdemKey('order.add_items'),
    });
    const applied = await appRpc(desk, 'apply_customer_discount', { p_tab_id: tab });
    expect(applied.error).toBeNull();
    expect(applied.data).toMatchObject({ amount_iqd: 3000 });
    const { data: adj } = await svc.from('tab_adjustments').select('reason_code, authorized_by').eq('tab_id', tab);
    expect(adj).toEqual([{ reason_code: 'customer_discount', authorized_by: SEED_STAFF_IDS.cashier }]);

    // Court: the sponsor tag's 30% beats the family 15% on the court part.
    expect((await appRpc(cashier, 'set_customer_tags', { p_customer_id: taggedId, p_tag_ids: [famId, sponsorId] })).error).toBeNull();
    const r = await bookingId(40_000, taggedId);
    const bill = await appRpc(desk, 'bill_customer_discount', { p_reservation_id: r });
    expect(bill.error).toBeNull();
    expect(bill.data).toMatchObject({ court_needs_refresh: true, standing: { court: { value: 3000, tag: expect.any(String) } } });
    const court = await appRpc(desk, 'apply_customer_court_discount', { p_reservation_id: r });
    expect(court.error).toBeNull();
    expect(court.data).toMatchObject({ amount_iqd: 12_000 });
    const { data: rcd } = await svc.from('reservation_court_discounts').select('reason, authorized_by, standing').eq('reservation_id', r).single();
    expect(rcd).toEqual({ reason: 'tag', authorized_by: SEED_STAFF_IDS.cashier, standing: true });
  });

  it('the customer\'s own discount wins on the part it sets; the tag fills the other', async () => {
    const own = await appRpc(desk, 'set_customer_discount', {
      p_customer_id: taggedId, p_cafe_kind: 'percent', p_cafe_value: 500, p_reason: 'coach',
    });
    expect(own.error).toBeNull();
    const r = await read(desk, taggedId);
    expect(r.effective).toMatchObject({
      cafe: { kind: 'percent', value: 500, tag: null },
      court: { kind: 'percent', value: 3000 },
      reason: 'coach',
    });
    await appRpc(desk, 'set_customer_discount', { p_customer_id: taggedId });
  });

  it('nobody tags themselves into a discount; a manager cannot change a tag they carry', async () => {
    const [famId, plainId] = tagIds;
    expect(errCode((await appRpc(cashier, 'set_customer_tags', { p_customer_id: SEED_STAFF_IDS.cashier, p_tag_ids: [famId] })).error))
      .toBe('SELF_DISCOUNT');
    // A tag with no rule is fine on yourself.
    expect((await appRpc(cashier, 'set_customer_tags', { p_customer_id: SEED_STAFF_IDS.cashier, p_tag_ids: [plainId] })).error).toBeNull();
    await appRpc(cashier, 'set_customer_tags', { p_customer_id: SEED_STAFF_IDS.cashier, p_tag_ids: [] });

    expect((await appRpc(owner, 'set_customer_tags', { p_customer_id: SEED_STAFF_IDS.manager, p_tag_ids: [famId] })).error).toBeNull();
    const name = (await read(owner, null)).catalog.find((t) => t.id === famId)!.name;
    expect(errCode((await appRpc(manager, 'save_customer_tag', { p_tag_id: famId, p_name: name, p_cafe_bp: 5000, p_court_bp: 1500 })).error))
      .toBe('SELF_DISCOUNT');
    // Renaming without touching the rule is fine.
    expect((await appRpc(manager, 'save_customer_tag', { p_tag_id: famId, p_name: `${name}!`, p_cafe_bp: 1500, p_court_bp: 1500 })).error).toBeNull();
    await appRpc(owner, 'set_customer_tags', { p_customer_id: SEED_STAFF_IDS.manager, p_tag_ids: [] });
    expect(errCode((await appRpc(desk, 'set_customer_tags', { p_customer_id: taggedId, p_tag_ids: [crypto.randomUUID()] })).error))
      .toBe('TAG_NOT_FOUND');
  });

  it('deleting a tag takes it off everyone and their discount with it', async () => {
    const sponsorId = tagIds[2]!;
    const del = await appRpc(manager, 'delete_customer_tag', { p_tag_id: sponsorId });
    expect(del.error).toBeNull();
    expect((del.data as { members: number }).members).toBe(1);
    const r = await read(desk, taggedId);
    expect(r.tags.map((t) => t.id)).not.toContain(sponsorId);
    expect(r.effective?.court).toMatchObject({ value: 1500 });
    expect(errCode((await appRpc(manager, 'delete_customer_tag', { p_tag_id: sponsorId })).error)).toBe('TAG_NOT_FOUND');
  });
});

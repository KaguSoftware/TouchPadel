/**
 * 0065 — the desk's customer surface (spec 06.8 search, 06.9 record + notes +
 * flags, 06.10 create) and the desk-customer-create edge function's pure
 * helpers.
 *
 * Search is asserted through the tolerance the spec puts server-side: a
 * partial phone typed with spaces, a phone typed in Arabic-Indic digits, a
 * Latin name with the space in a different place, an Arabic name with a
 * hamza the operator did not type, and an email fragment. The record's shape
 * is asserted key by key so the desk screen can bind to it before the series
 * lane fills `series`.
 *
 * Every row it creates is removed in afterAll (reservations first — they
 * reference the profile without a cascade — then the auth users, which
 * cascade through profiles into notes and flags).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  guestClient,
  appRpc,
  outcome,
  createTestCourt,
  ensureCafeProbeData,
  probeId,
  SEED_STAFF,
  SEED_STAFF_IDS,
  DEV_PASSWORD,
} from './helpers';
import {
  isSyntheticEmail,
  isValidPhone,
  looksLikeEmail,
  phoneDigits,
  syntheticEmail,
} from '../supabase/functions/desk-customer-create/phone';

const up = await stackAvailable();

// ── pure helpers (no stack needed) ──────────────────────────────────────────
describe('desk-customer-create phone helpers (pure)', () => {
  it('phoneDigits keeps digits only and folds Arabic-Indic digits', () => {
    expect(phoneDigits('+964 (770) 123-4567')).toBe('9647701234567');
    expect(phoneDigits('٠٧٧٠١٢٣٤٥٦٧')).toBe('07701234567');
    expect(phoneDigits('۰۷۸۰')).toBe('0780');
    expect(phoneDigits('')).toBe('');
    expect(phoneDigits(undefined)).toBe('');
    expect(phoneDigits(12 as unknown as string)).toBe('');
  });

  it('isValidPhone accepts 7-15 digits and refuses the rest', () => {
    expect(isValidPhone('07701234567')).toBe(true);
    expect(isValidPhone('+964 770 123 4567')).toBe(true);
    expect(isValidPhone('1234567')).toBe(true);
    expect(isValidPhone('123456')).toBe(false);
    expect(isValidPhone('1234567890123456')).toBe(false);
    expect(isValidPhone('abc')).toBe(false);
    expect(isValidPhone(null)).toBe(false);
  });

  it('syntheticEmail is digits@guest.touch.local and recognised as synthetic', () => {
    const e = syntheticEmail('+964 770 123 4567');
    expect(e).toBe('9647701234567@guest.touch.local');
    expect(isSyntheticEmail(e)).toBe(true);
    expect(isSyntheticEmail('Someone@Guest.Touch.Local')).toBe(true);
    expect(isSyntheticEmail('someone@example.com')).toBe(false);
  });

  it('looksLikeEmail is a loose shape check', () => {
    expect(looksLikeEmail('a@b.co')).toBe(true);
    expect(looksLikeEmail(' a@b.co ')).toBe(true);
    expect(looksLikeEmail('nope')).toBe(false);
    expect(looksLikeEmail('a@b')).toBe(false);
    expect(looksLikeEmail(undefined)).toBe(false);
  });
});

// ── against the stack ───────────────────────────────────────────────────────
type SearchRow = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  preferred_lang: string;
  flags: { type: string; label: string | null }[];
  counts: { bookings: number; cancellations: number; noShows: number };
};

type CustomerRecord = {
  customer: {
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    preferred_lang: string;
    created_at: string;
  };
  flags: { type: string; label: string | null }[];
  counts: { bookings: number; cancellations: number; noShows: number };
  upcoming: { id: string; court_name_en: string; court_name_ar: string; status: string; kind: string; price_iqd: number | null }[];
  history: { id: string; status: string }[];
  cafeOrders: { id: string; opened_at: string; total_iqd: number | null; status: string }[];
  notes: {
    id: string;
    body: string;
    author_id: string;
    author_name: string;
    created_at: string;
    edited_at: string | null;
    edited_by: string | null;
    edited_by_name: string | null;
  }[];
  series: unknown[];
};

describe.skipIf(!up)('0065 customers', () => {
  let svc: SupabaseClient;
  let desk: SupabaseClient;
  let cashier: SupabaseClient;
  let guest: SupabaseClient;
  let anonSession: SupabaseClient;

  const tag = `${Date.now()}`;
  const users: string[] = [];
  const reservations: string[] = [];
  const tabs: string[] = [];
  let courtId: string;

  /** Arabic customer, phone stored with +964 and spaces. */
  let arabId: string;
  /** Latin customer, phone stored bare, real-looking email. */
  let latinId: string;
  let latinEmail: string;

  async function makeCustomer(fullName: string, phone: string, email: string): Promise<string> {
    const { data, error } = await svc.auth.admin.createUser({
      email,
      password: DEV_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName, phone },
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    users.push(data.user.id);
    return data.user.id;
  }

  async function plantReservation(
    guestId: string,
    status: string,
    offsetHours: number,
    kind: 'booking' | 'hold' = 'booking',
  ): Promise<string> {
    const start = new Date(Date.now() + offsetHours * 3600_000);
    const end = new Date(start.getTime() + 3600_000);
    const { data, error } = await svc
      .from('reservations')
      .insert({
        court_id: courtId,
        kind,
        status,
        source: 'desk',
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        guest_id: guestId,
        price_iqd: 40_000,
        ...(kind === 'hold' ? { hold_expires_at: end.toISOString() } : {}),
        ...(status === 'cancelled' ? { cancellation_reason: 'staff_error' } : {}),
      })
      .select('id')
      .single();
    if (error) throw new Error(`reservation failed: ${error.message}`);
    const id = (data as { id: string }).id;
    reservations.push(id);
    return id;
  }

  beforeAll(async () => {
    svc = serviceClient();
    desk = await signedInClient(SEED_STAFF.court_desk);
    cashier = await signedInClient(SEED_STAFF.cashier);
    guest = await guestClient(svc, `cust-${tag}`);
    anonSession = await anonymousSessionClient();
    courtId = await createTestCourt(svc, `CUST-${tag}`);
    await ensureCafeProbeData(svc); // a closed day session (ee57…301) for the cafe tab

    // Hamza in the stored name; the operator will type it without.
    arabId = await makeCustomer('أحمد الكرخي', `+964 770 ${tag.slice(-3)} 1122`, `cust-ar-${tag}@test.touch.local`);
    latinEmail = `cust-latin-${tag}@example.test`;
    latinId = await makeCustomer('Abdul Rahman Search', `0780${tag.slice(-3)}3344`, latinEmail);
  });

  afterAll(async () => {
    if (tabs.length > 0) await svc.from('tabs').delete().in('id', tabs);
    if (reservations.length > 0) await svc.from('reservations').delete().in('id', reservations);
    for (const id of users) await svc.auth.admin.deleteUser(id).catch(() => undefined);
    await svc.from('courts').delete().eq('id', courtId);
    await desk.auth.signOut();
    await cashier.auth.signOut();
    await guest.auth.signOut();
    await anonSession.auth.signOut();
  });

  async function search(c: SupabaseClient, q: string): Promise<SearchRow[]> {
    const res = await appRpc(c, 'customer_search', { p_query: q });
    if (res.error) throw new Error(res.error.message);
    return res.data as SearchRow[];
  }
  const ids = (rows: SearchRow[]) => rows.map((r) => r.id);

  // ── search ────────────────────────────────────────────────────────────────

  it('finds a customer by a partial phone typed with spaces, and in Arabic-Indic digits', async () => {
    const part = `770 ${tag.slice(-3)}`; // "770 123" against "+964 770 123 1122"
    expect(ids(await search(desk, part))).toContain(arabId);

    const arabicDigits = `٠٧٨٠${tag.slice(-3).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)] ?? d)}`;
    expect(ids(await search(desk, arabicDigits))).toContain(latinId);
  });

  it('finds a name across spacing and across a hamza, in both scripts', async () => {
    // Space in a different place than stored ("Abdul Rahman" -> "abdulrahman").
    expect(ids(await search(desk, 'abdulrah'))).toContain(latinId);
    expect(ids(await search(desk, 'Abdul Rahman Sea'))).toContain(latinId);
    // Stored with أ, typed with ا; stored "الكرخي", typed partial.
    expect(ids(await search(desk, 'احمد الكرخي'))).toContain(arabId);
    expect(ids(await search(desk, 'الكرخ'))).toContain(arabId);
    // A name that is not there is not there.
    expect(ids(await search(desk, `nobody-${tag}`))).toHaveLength(0);
  });

  it('finds by an email fragment and returns the email (from auth.users) in the row', async () => {
    const rows = await search(desk, `cust-latin-${tag}`);
    expect(ids(rows)).toContain(latinId);
    const row = rows.find((r) => r.id === latinId)!;
    expect(row.email).toBe(latinEmail);
    expect(row.preferred_lang).toBe('en');
    expect(row.flags).toEqual([]);
    expect(row.counts).toEqual({ bookings: 0, cancellations: 0, noShows: 0 });
  });

  it('treats LIKE metacharacters in the query as literal characters', async () => {
    expect(await search(desk, '%%')).toHaveLength(0);
    expect(await search(desk, '__')).toHaveLength(0);
  });

  it('honours p_limit and returns nothing for a one-character query', async () => {
    const one = await appRpc(desk, 'customer_search', { p_query: 'a' });
    expect(one.error).toBeNull();
    expect(one.data).toEqual([]);
    const limited = await appRpc(desk, 'customer_search', { p_query: 'test.touch.local', p_limit: 1 });
    expect(limited.error).toBeNull();
    expect((limited.data as unknown[]).length).toBeLessThanOrEqual(1);
  });

  it('cashier may search and read a record; guests are refused before the query is read', async () => {
    expect(ids(await search(cashier, 'abdulrah'))).toContain(latinId);
    const rec = await appRpc(cashier, 'customer_record', { p_customer_id: latinId });
    expect(rec.error).toBeNull();

    for (const c of [guest, anonSession]) {
      const s = outcome(await appRpc(c, 'customer_search', { p_query: 'abdulrah' }));
      expect(s.errorMessage).toContain('FORBIDDEN');
      const r = outcome(await appRpc(c, 'customer_record', { p_customer_id: latinId }));
      expect(r.errorMessage).toContain('FORBIDDEN');
    }
  });

  // ── record ────────────────────────────────────────────────────────────────

  it('customer_record has the contract shape, splits upcoming from history and counts by status', async () => {
    const upcoming = await plantReservation(arabId, 'confirmed', 24 * 3);
    const played = await plantReservation(arabId, 'completed', -24 * 3);
    const cancelled = await plantReservation(arabId, 'cancelled', 24 * 5);
    const noShow = await plantReservation(arabId, 'no_show', -24 * 5);
    // An expired hold is booking-flow debris, not history.
    const staleHold = await plantReservation(arabId, 'expired', -24 * 7, 'hold');

    // A cafe tab charged to the upcoming booking.
    const { data: tab, error: tabErr } = await svc
      .from('tabs')
      .insert({
        day_session_id: probeId('301'),
        status: 'settled',
        reservation_id: upcoming,
        label: `cust-${tag}`,
        opened_by_staff_id: SEED_STAFF_IDS.cashier,
        subtotal_iqd: 5000,
        tax_iqd: 0,
        discount_iqd: 0,
        total_iqd: 5000,
        settled_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (tabErr) throw new Error(`tab failed: ${tabErr.message}`);
    tabs.push((tab as { id: string }).id);

    const res = await appRpc(desk, 'customer_record', { p_customer_id: arabId });
    expect(res.error).toBeNull();
    const rec = res.data as CustomerRecord;

    expect(Object.keys(rec).sort()).toEqual(
      ['cafeOrders', 'counts', 'customer', 'flags', 'history', 'notes', 'series', 'upcoming'].sort(),
    );
    expect(rec.customer).toMatchObject({
      id: arabId,
      full_name: 'أحمد الكرخي',
      email: `cust-ar-${tag}@test.touch.local`,
      preferred_lang: 'en',
    });
    expect(typeof rec.customer.created_at).toBe('string');
    expect(rec.counts).toEqual({ bookings: 2, cancellations: 1, noShows: 1 });

    expect(rec.upcoming.map((r) => r.id)).toEqual([upcoming]);
    expect(rec.upcoming[0]!).toMatchObject({
      status: 'confirmed',
      kind: 'booking',
      price_iqd: 40_000,
      court_name_en: `CUST-${tag}`,
    });
    expect(rec.upcoming[0]!.court_name_ar).toContain('ملعب');

    const historyIds = rec.history.map((r) => r.id);
    expect(historyIds).toContain(played);
    expect(historyIds).toContain(cancelled); // a cancelled future booking is history, not upcoming
    expect(historyIds).toContain(noShow);
    expect(historyIds).not.toContain(upcoming);
    expect(historyIds).not.toContain(staleHold);

    expect(rec.cafeOrders).toHaveLength(1);
    expect(rec.cafeOrders[0]!).toMatchObject({ id: tabs[0], total_iqd: 5000, status: 'settled' });
    expect(rec.series).toEqual([]);
    expect(rec.notes).toEqual([]);
    expect(rec.flags).toEqual([]);
  });

  it('customer_record refuses an unknown customer by name', async () => {
    const res = outcome(
      await appRpc(desk, 'customer_record', { p_customer_id: '00000000-0000-4000-8000-000000000000' }),
    );
    expect(res.errorMessage).toContain('CUSTOMER_NOT_FOUND');
  });

  // ── notes ─────────────────────────────────────────────────────────────────

  it('adds and edits a note; both are audited, the edit stamps editor and time', async () => {
    const added = await appRpc(desk, 'add_customer_note', {
      p_customer_id: latinId,
      p_body: '  Prefers court 2  ',
    });
    expect(added.error).toBeNull();
    const noteId = added.data as string;

    let rec = (await appRpc(desk, 'customer_record', { p_customer_id: latinId })).data as CustomerRecord;
    expect(rec.notes).toHaveLength(1);
    expect(rec.notes[0]!).toMatchObject({
      id: noteId,
      body: 'Prefers court 2',
      author_id: SEED_STAFF_IDS.court_desk,
      author_name: 'Dev Court Desk',
      edited_at: null,
      edited_by: null,
      edited_by_name: null,
    });

    const edited = await appRpc(desk, 'edit_customer_note', { p_note_id: noteId, p_body: 'Prefers court 3' });
    expect(edited.error).toBeNull();
    rec = (await appRpc(desk, 'customer_record', { p_customer_id: latinId })).data as CustomerRecord;
    expect(rec.notes[0]!).toMatchObject({
      body: 'Prefers court 3',
      edited_by: SEED_STAFF_IDS.court_desk,
      edited_by_name: 'Dev Court Desk',
    });
    expect(rec.notes[0]!.edited_at).not.toBeNull();

    const { data: audit } = await svc
      .from('audit_log')
      .select('action, actor_id, before, after')
      .eq('entity', 'customer_notes')
      .eq('entity_id', noteId)
      .order('at', { ascending: true });
    const rows = audit as { action: string; actor_id: string; before: unknown; after: unknown }[];
    expect(rows.map((r) => r.action)).toEqual(['customer.note_add', 'customer.note_edit']);
    expect(rows[0]!.actor_id).toBe(SEED_STAFF_IDS.court_desk);
    expect(rows[1]!.before).toMatchObject({ body: 'Prefers court 2' });
    expect(rows[1]!.after).toMatchObject({ body: 'Prefers court 3' });

    const blank = outcome(await appRpc(desk, 'add_customer_note', { p_customer_id: latinId, p_body: '   ' }));
    expect(blank.errorMessage).toContain('NOTE_LENGTH');
    const missing = outcome(
      await appRpc(desk, 'edit_customer_note', {
        p_note_id: '00000000-0000-4000-8000-000000000000',
        p_body: 'x',
      }),
    );
    expect(missing.errorMessage).toContain('NOTE_NOT_FOUND');
  });

  it('cashier cannot write notes or flags (reads them fine)', async () => {
    const add = outcome(await appRpc(cashier, 'add_customer_note', { p_customer_id: latinId, p_body: 'x' }));
    expect(add.errorMessage).toContain('FORBIDDEN');
    const flags = outcome(
      await appRpc(cashier, 'set_customer_flags', { p_customer_id: latinId, p_flags: [{ type: 'vip' }] }),
    );
    expect(flags.errorMessage).toContain('FORBIDDEN');

    const { data, error } = await cashier.from('customer_notes').select('id').eq('customer_id', latinId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it('guests cannot read notes or flags at all — RLS silence on the tables, FORBIDDEN on the RPCs', async () => {
    for (const c of [guest, anonSession]) {
      const notes = await c.from('customer_notes').select('*');
      expect(notes.error).toBeNull();
      expect(notes.data).toEqual([]);
      const flags = await c.from('customer_flags').select('*');
      expect(flags.error).toBeNull();
      expect(flags.data).toEqual([]);

      const add = outcome(await appRpc(c, 'add_customer_note', { p_customer_id: latinId, p_body: 'x' }));
      expect(add.errorMessage).toContain('FORBIDDEN');
      const edit = outcome(
        await appRpc(c, 'edit_customer_note', { p_note_id: '00000000-0000-4000-8000-000000000000', p_body: 'x' }),
      );
      expect(edit.errorMessage).toContain('FORBIDDEN');
      const set = outcome(await appRpc(c, 'set_customer_flags', { p_customer_id: latinId, p_flags: [] }));
      expect(set.errorMessage).toContain('FORBIDDEN');
    }
    // And no direct write for anyone, staff included.
    const direct = await desk
      .from('customer_notes')
      .insert({ customer_id: latinId, body: 'x', author_id: SEED_STAFF_IDS.court_desk });
    expect(direct.error).not.toBeNull();
  });

  // ── flags ─────────────────────────────────────────────────────────────────

  it('set_customer_flags replaces the whole set, surfaces in search, and is audited', async () => {
    const first = await appRpc(desk, 'set_customer_flags', {
      p_customer_id: arabId,
      p_flags: [
        { type: 'vip' },
        { type: 'birthday', label: '  12 March  ' },
      ],
    });
    expect(first.error).toBeNull();
    expect(first.data).toEqual([
      { type: 'birthday', label: '12 March' },
      { type: 'vip', label: null },
    ]);

    const rows = await search(desk, 'الكرخي');
    expect(rows.find((r) => r.id === arabId)!.flags.map((f) => f.type).sort()).toEqual(['birthday', 'vip']);

    const second = await appRpc(desk, 'set_customer_flags', {
      p_customer_id: arabId,
      p_flags: [{ type: 'payment_note', label: 'Pays by card' }],
    });
    expect(second.error).toBeNull();
    expect(second.data).toEqual([{ type: 'payment_note', label: 'Pays by card' }]);
    const rec = (await appRpc(desk, 'customer_record', { p_customer_id: arabId })).data as CustomerRecord;
    expect(rec.flags).toEqual([{ type: 'payment_note', label: 'Pays by card' }]);

    // No change, no audit row.
    const same = await appRpc(desk, 'set_customer_flags', {
      p_customer_id: arabId,
      p_flags: [{ type: 'payment_note', label: 'Pays by card' }],
    });
    expect(same.error).toBeNull();

    const { data: audit } = await svc
      .from('audit_log')
      .select('action, before, after')
      .eq('entity', 'customer_flags')
      .eq('entity_id', arabId)
      .order('at', { ascending: true });
    const a = audit as { action: string; before: unknown; after: unknown }[];
    expect(a.map((r) => r.action)).toEqual(['customer.flags_set', 'customer.flags_set']);
    expect(a[0]!.before).toEqual([]);
    expect(a[1]!.after).toEqual([{ type: 'payment_note', label: 'Pays by card' }]);

    // Refusals leave the set untouched.
    const bad = outcome(
      await appRpc(desk, 'set_customer_flags', { p_customer_id: arabId, p_flags: [{ type: 'banned' }] }),
    );
    expect(bad.errorMessage).toContain('INVALID_FLAG');
    const dup = outcome(
      await appRpc(desk, 'set_customer_flags', {
        p_customer_id: arabId,
        p_flags: [{ type: 'vip' }, { type: 'vip' }],
      }),
    );
    expect(dup.errorMessage).toContain('DUPLICATE_FLAG');
    const notArray = outcome(
      await appRpc(desk, 'set_customer_flags', { p_customer_id: arabId, p_flags: { type: 'vip' } }),
    );
    expect(notArray.errorMessage).toContain('INVALID_FLAGS');
    const after = (await appRpc(desk, 'customer_record', { p_customer_id: arabId })).data as CustomerRecord;
    expect(after.flags).toEqual([{ type: 'payment_note', label: 'Pays by card' }]);

    // Empty array clears.
    const cleared = await appRpc(desk, 'set_customer_flags', { p_customer_id: arabId, p_flags: [] });
    expect(cleared.error).toBeNull();
    expect(cleared.data).toEqual([]);
  });

  // ── service-role pair behind desk-customer-create ─────────────────────────

  it('find_customer_by_phone / desk_register_customer: service-role only, digits-only duplicate rule', async () => {
    // No client EXECUTE at all — not even the desk.
    const probe = outcome(await appRpc(desk, 'find_customer_by_phone', { p_phone: '0770' }));
    expect(probe.errorMessage).toMatch(/permission denied/i);
    const reg = outcome(
      await appRpc(desk, 'desk_register_customer', {
        p_customer_id: latinId,
        p_full_name: 'x',
        p_phone: '07701234567',
        p_preferred_lang: 'en',
        p_actor_id: SEED_STAFF_IDS.court_desk,
      }),
    );
    expect(reg.errorMessage).toMatch(/permission denied/i);

    // Same digits, different formatting, is the same phone.
    const found = await appRpc(svc, 'find_customer_by_phone', { p_phone: `+964 (780) ${tag.slice(-3)} 33-44` });
    expect(found.error).toBeNull();
    expect(found.data).toBe(latinId);
    const none = await appRpc(svc, 'find_customer_by_phone', { p_phone: '0000000' });
    expect(none.error).toBeNull();
    expect(none.data).toBeNull();

    // A fresh auth user registered by the desk, as the edge function does it.
    const { data: created, error: cErr } = await svc.auth.admin.createUser({
      email: `${tag}9988@guest.touch.local`,
      password: DEV_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'Walk In', phone: `0781 ${tag.slice(-3)} 9988`, preferred_lang: 'ar' },
    });
    if (cErr || !created.user) throw new Error(`createUser failed: ${cErr?.message}`);
    users.push(created.user.id);

    const dupPhone = outcome(
      await appRpc(svc, 'desk_register_customer', {
        p_customer_id: created.user.id,
        p_full_name: 'Walk In',
        p_phone: `0780${tag.slice(-3)}3344`, // latinId's phone
        p_preferred_lang: 'ar',
        p_actor_id: SEED_STAFF_IDS.court_desk,
      }),
    );
    expect(dupPhone.errorMessage).toContain('DUPLICATE_PHONE');

    const badPhone = outcome(
      await appRpc(svc, 'desk_register_customer', {
        p_customer_id: created.user.id,
        p_full_name: 'Walk In',
        p_phone: '12',
        p_preferred_lang: 'ar',
        p_actor_id: SEED_STAFF_IDS.court_desk,
      }),
    );
    expect(badPhone.errorMessage).toContain('INVALID_PHONE');

    const notDesk = outcome(
      await appRpc(svc, 'desk_register_customer', {
        p_customer_id: created.user.id,
        p_full_name: 'Walk In',
        p_phone: `0781${tag.slice(-3)}9988`,
        p_preferred_lang: 'ar',
        p_actor_id: SEED_STAFF_IDS.cashier,
      }),
    );
    expect(notDesk.errorMessage).toContain('FORBIDDEN');

    const ok = await appRpc(svc, 'desk_register_customer', {
      p_customer_id: created.user.id,
      p_full_name: '  Walk In Guest ',
      p_phone: `0781 ${tag.slice(-3)} 9988`,
      p_preferred_lang: 'ar',
      p_actor_id: SEED_STAFF_IDS.court_desk,
    });
    expect(ok.error).toBeNull();
    expect(ok.data).toMatchObject({ id: created.user.id, full_name: 'Walk In Guest', preferred_lang: 'ar' });

    const { data: prof } = await svc.from('profiles').select('full_name, phone, preferred_lang').eq('id', created.user.id).single();
    expect(prof).toEqual({ full_name: 'Walk In Guest', phone: `0781 ${tag.slice(-3)} 9988`, preferred_lang: 'ar' });

    const { data: audit } = await svc
      .from('audit_log')
      .select('action, actor_id, actor_role, after')
      .eq('entity', 'profiles')
      .eq('entity_id', created.user.id);
    expect(audit).toHaveLength(1);
    expect((audit as { action: string; actor_id: string; actor_role: string }[])[0]).toMatchObject({
      action: 'customer.create',
      actor_id: SEED_STAFF_IDS.court_desk,
      actor_role: 'court_desk',
    });

    // The new walk-in is searchable by the phone they were typed in with.
    expect(ids(await search(desk, `${tag.slice(-3)} 9988`))).toContain(created.user.id);
  });
});

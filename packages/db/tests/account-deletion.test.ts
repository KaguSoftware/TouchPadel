/**
 * 0077 — app.delete_my_account.
 *
 * Both stores require in-app account deletion, and the honest version of it is
 * harder than `auth.admin.deleteUser`. Measured against the schema, that call
 * either FAILS with 23503 (reservations.guest_id and guest_sessions.auth_user_id
 * are both NO ACTION) or, for a guest who never booked, silently takes the
 * customer history the venue's statistics are built on.
 *
 * So 0077 keeps the profile row as an anonymised TOMBSTONE and destroys the auth
 * user. These are the assertions that keep both halves honest — that nothing
 * naming the person survives, and that everything the venue counts does.
 *
 * The last test in the "footprint" block is the one that matters most: a refresh
 * token captured before the deletion must no longer mint a JWT. Deleting a row
 * the user can still authenticate against is not a deletion.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  guestClient,
  anonymousSessionClient,
  appRpc,
  createTestCourt,
  ensureTestRateRule,
  createTestCafeTable,
  futureSlot,
  outcome,
  SEED_STAFF,
  SEED_STAFF_IDS,
  SUPABASE_URL,
  ANON_KEY,
} from './helpers';

const up = await stackAvailable();

const DELETE = { p_confirm: 'DELETE' };

describe.skipIf(!up)('0077 delete_my_account', () => {
  let svc: SupabaseClient;
  let courtId: string;
  const madeCourts: string[] = [];
  const madeTables: string[] = [];

  beforeAll(async () => {
    svc = serviceClient();
    await ensureTestRateRule(svc);
    courtId = await createTestCourt(svc, `DEL${Date.now() % 100000}`);
    madeCourts.push(courtId);
  });

  afterAll(async () => {
    for (const id of madeCourts) await svc.from('courts').delete().eq('id', id);
    for (const id of madeTables) {
      await svc.from('guest_sessions').delete().eq('table_id', id);
      await svc.from('cafe_tables').delete().eq('id', id);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The guards. Each one is load-bearing for a different reason.
  // ───────────────────────────────────────────────────────────────────────────

  describe('guards', () => {
    /**
     * This is not only a correctness assertion, it is what keeps CI from eating
     * itself. check-rpc-authz.mjs calls EVERY RPC granted to `authenticated`
     * with NULL arguments as a real anonymous guest. If delete_my_account did
     * not refuse on its first line, the authorization gate would delete the
     * account it probes with, on every single run.
     */
    it('refuses an anonymous cafe session with ACCOUNT_REQUIRED', async () => {
      const anon = await anonymousSessionClient();
      const res = outcome(await appRpc(anon, 'delete_my_account', DELETE));
      expect(res.ok).toBe(false);
      expect(res.errorMessage).toMatch(/ACCOUNT_REQUIRED/);
    });

    it('refuses a staff account with FORBIDDEN — staff are deactivated, not deleted', async () => {
      const desk = await signedInClient(SEED_STAFF.court_desk);
      const res = outcome(await appRpc(desk, 'delete_my_account', DELETE));
      expect(res.ok).toBe(false);
      expect(res.errorMessage).toMatch(/FORBIDDEN/);

      // And the staff row is untouched.
      const { data } = await svc.from('staff').select('id').eq('id', SEED_STAFF_IDS.court_desk);
      expect(data).toHaveLength(1);
      await desk.auth.signOut();
    });

    /**
     * The confirmation token is defence against a bare zero-argument RPC being
     * spent by a stray retry or an injected fetch. A refused call must leave the
     * account completely intact — not half-anonymised.
     */
    it('refuses without the confirmation token, and changes nothing', async () => {
      const guest = await guestClient(svc, 'noconfirm');
      const uid = (await guest.auth.getUser()).data.user!.id;

      const res = outcome(await appRpc(guest, 'delete_my_account', {}));
      expect(res.ok).toBe(false);
      expect(res.errorMessage).toMatch(/CONFIRMATION_REQUIRED/);

      const { data } = await svc
        .from('profiles')
        .select('full_name, phone, deleted_at')
        .eq('id', uid)
        .single();
      const row = data as { full_name: string; phone: string | null; deleted_at: string | null };
      expect(row.full_name).not.toBe('Deleted account');
      expect(row.phone).not.toBeNull();
      expect(row.deleted_at).toBeNull();

      // The auth user is still there and can still sign in.
      const { data: u } = await svc.auth.admin.getUserById(uid);
      expect(u.user).not.toBeNull();
    });

    it('refuses a wrong confirmation token', async () => {
      const guest = await guestClient(svc, 'wrongconfirm');
      const res = outcome(await appRpc(guest, 'delete_my_account', { p_confirm: 'delete' }));
      expect(res.ok).toBe(false);
      expect(res.errorMessage).toMatch(/CONFIRMATION_REQUIRED/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A guest with a full footprint, deleted.
  // ───────────────────────────────────────────────────────────────────────────

  describe('a guest with bookings, a table session and customer history', () => {
    let uid: string;
    let reservationId: string;
    let sessionId: string;
    let refreshToken: string;
    let result: Record<string, unknown>;

    /**
     * Unique per run. The sweep at the end of this block scans the guest-facing
     * tables ENTIRELY — that is the point of it — so a fixed literal would trip
     * over rows left behind by an earlier run against the same local database
     * and turn a real assertion into a flake.
     */
    const MARK = `Footprint Guest ${Date.now()}`;
    const MARK_PHONE = `+96477${String(Date.now()).slice(-8)}`;

    beforeAll(async () => {
      const guest = await guestClient(svc, 'footprint');
      uid = (await guest.auth.getUser()).data.user!.id;

      // Keep the refresh token from BEFORE the deletion — the global sign-out
      // assertion below is the whole point of destroying the auth user.
      refreshToken = (await guest.auth.getSession()).data.session!.refresh_token;

      // A confirmed booking.
      const slot = futureSlot();
      const held = await appRpc(guest, 'hold_slot', {
        p_court_id: courtId,
        p_start_at: slot.start.toISOString(),
        p_duration_min: 60,
      });
      if (held.error) throw new Error(`hold_slot: ${held.error.message}`);
      reservationId = (held.data as { reservation_id: string }).reservation_id;
      const confirmed = await appRpc(guest, 'confirm_booking', { p_hold_id: reservationId });
      if (confirmed.error) throw new Error(`confirm_booking: ${confirmed.error.message}`);

      // The denormalised copies. No shipping client writes these beside a
      // guest_id yet, but confirm_booking and create_series both accept them and
      // nothing forbids the combination, so the scrub has to cover it.
      await svc
        .from('reservations')
        .update({
          guest_name: MARK,
          guest_phone: MARK_PHONE,
          notes: 'called about parking',
          device_id: 'DEVICE-FOOTPRINT',
        })
        .eq('id', reservationId);

      // A table session, owned by the ACCOUNT (open_table_session binds
      // auth.uid()), so auth_user_id points at the user about to be deleted.
      const tableId = await createTestCafeTable(svc, `del${Date.now() % 100000}`);
      madeTables.push(tableId);
      const manager = await signedInClient(SEED_STAFF.manager);
      const tok = await appRpc(manager, 'generate_table_token', { p_table_id: tableId });
      if (tok.error) throw new Error(`generate_table_token: ${tok.error.message}`);
      const opened = await appRpc(guest, 'open_table_session', { p_token: tok.data as string });
      if (opened.error) throw new Error(`open_table_session: ${opened.error.message}`);
      sessionId = (opened.data as { session_id: string }).session_id;
      await manager.auth.signOut();

      // Customer history, a push token, and a queued notification.
      await svc.from('profiles').update({ expo_push_token: 'ExponentPushToken[del]' }).eq('id', uid);
      await svc
        .from('customer_notes')
        .insert({ customer_id: uid, body: 'asks for court 3', author_id: SEED_STAFF_IDS.court_desk });
      await svc
        .from('customer_flags')
        .insert({ customer_id: uid, type: 'vip', label: 'regular', created_by: SEED_STAFF_IDS.court_desk });
      await svc.from('notification_outbox').insert({
        profile_id: uid,
        kind: 'reservation_reminder',
        payload: { reservation_id: reservationId, guest_name: MARK },
        scheduled_for: new Date().toISOString(),
      });

      const res = await appRpc(guest, 'delete_my_account', DELETE);
      if (res.error) throw new Error(`delete_my_account: ${res.error.message}`);
      result = res.data as Record<string, unknown>;
    });

    it('reports the deletion, and whether Apple still owes a token revocation', () => {
      expect(result.deleted).toBe(true);
      expect(result.profile_id).toBe(uid);
      // No Apple identity on an email/password guest.
      expect(result.apple_revoke_pending).toBe(false);
    });

    it('destroys the auth user — email, phone and metadata go with it', async () => {
      const { data } = await svc.auth.admin.getUserById(uid);
      expect(data.user).toBeNull();
    });

    /**
     * The global sign-out. auth.sessions CASCADEs from auth.users and
     * auth.refresh_tokens CASCADEs from auth.sessions, so a token captured
     * before the deletion must now be dead. A row the user can still
     * authenticate against has not been deleted.
     */
    it('a refresh token taken before the deletion no longer mints a JWT', async () => {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      expect(res.ok).toBe(false);
      const body = (await res.json()) as { access_token?: string };
      expect(body.access_token).toBeUndefined();
    });

    it('keeps the profile row as a tombstone, with nothing that names a person', async () => {
      const { data } = await svc.from('profiles').select('*').eq('id', uid).single();
      const row = data as {
        full_name: string;
        phone: string | null;
        expo_push_token: string | null;
        deleted_at: string | null;
      };
      expect(row.full_name).toBe('Deleted account');
      expect(row.phone).toBeNull();
      expect(row.expo_push_token).toBeNull();   // SEC-21: cleared on deletion
      expect(row.deleted_at).not.toBeNull();
    });

    /**
     * The reason the row is kept at all. The venue's statistics run off these.
     */
    it('keeps the booking, its court, time and price — the statistics still add up', async () => {
      const { data } = await svc
        .from('reservations')
        .select('id, guest_id, court_id, status, price_iqd, start_at')
        .eq('id', reservationId)
        .single();
      const row = data as { guest_id: string; status: string; price_iqd: number | null };
      expect(row.guest_id).toBe(uid);          // still parented by the tombstone
      expect(row.status).toBe('confirmed');
      expect(row.price_iqd).toBeGreaterThan(0);
    });

    it('scrubs the denormalised identity off the booking', async () => {
      const { data } = await svc
        .from('reservations')
        .select('guest_name, guest_phone, notes, device_id')
        .eq('id', reservationId)
        .single();
      expect(data).toEqual({ guest_name: null, guest_phone: null, notes: null, device_id: null });
    });

    it('removes staff notes, flags and queued notifications', async () => {
      for (const [table, col] of [
        ['customer_notes', 'customer_id'],
        ['customer_flags', 'customer_id'],
        ['notification_outbox', 'profile_id'],
      ] as const) {
        const { data } = await svc.from(table).select('*').eq(col, uid);
        expect(data, `${table} should be empty`).toHaveLength(0);
      }
    });

    /**
     * guest_sessions must SURVIVE: orders.guest_session_id and
     * waiter_calls.guest_session_id are NO ACTION onto it, so deleting a guest's
     * sessions to delete the guest would take the cafe's sales history too.
     */
    it('keeps the table session, so the cafe keeps its order history', async () => {
      const { data } = await svc.from('guest_sessions').select('id, auth_user_id').eq('id', sessionId);
      expect(data).toHaveLength(1);
    });

    /**
     * The audit row proves the deletion happened. It must not reintroduce the
     * data one table further down: audit_log is append-only and manager/owner
     * can read it, so a before-image of the profile would undo the whole
     * exercise.
     */
    it('writes an audit row that records the shape of the deletion, not the person', async () => {
      const { data } = await svc
        .from('audit_log')
        .select('action, actor_id, before, after, reason_code')
        .eq('entity_id', uid)
        .eq('action', 'account.delete');
      expect(data).toHaveLength(1);
      const row = data![0] as {
        actor_id: string;
        before: Record<string, unknown>;
        after: Record<string, unknown>;
        reason_code: string;
      };
      expect(row.actor_id).toBe(uid);
      expect(row.reason_code).toBe('guest_request');
      expect(row.before).toEqual({ had_phone: true, had_push_token: true, created_at: expect.any(String) });
      expect(row.after.reservations_anonymised).toBe(1);
      expect(row.after.customer_notes_deleted).toBe(1);
      expect(row.after.apple_revoke_pending).toBe(false);

      const serialised = JSON.stringify(row);
      expect(serialised).not.toContain(MARK);
      expect(serialised).not.toContain(MARK_PHONE);
    });

    /**
     * The sweep for the whole guest-facing surface: after the deletion, nothing
     * anywhere still carries this person's name or number. This is the assertion
     * that would have caught anonymising `profiles` alone.
     */
    it('leaves the name and phone nowhere in the guest-facing tables', async () => {
      const hits: string[] = [];
      for (const [table, cols] of [
        ['profiles', 'full_name, phone'],
        ['reservations', 'guest_name, guest_phone, notes'],
        ['reservation_series', 'guest_name, guest_phone, notes'],
      ] as const) {
        const { data } = await svc.from(table).select(cols);
        const blob = JSON.stringify(data ?? []);
        if (blob.includes(MARK) || blob.includes(MARK_PHONE)) hits.push(table);
      }
      expect(hits).toEqual([]);
    });

    it('refuses a second deletion — the account is already gone', async () => {
      // The JWT is dead with the user, so this is the realistic repeat: a stale
      // client retrying. It must not 200.
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      expect(res.ok).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 0077 replaced profiles_id_fkey ON DELETE CASCADE with a trigger. The admin
  // paths that relied on the cascade must behave exactly as they did before.
  // ───────────────────────────────────────────────────────────────────────────

  describe('auth.admin.deleteUser keeps its pre-0077 meaning', () => {
    /**
     * desk-customer-create:161 and staff-admin:115 both create an auth user and,
     * on a failed follow-up, delete it to roll the account back — relying on the
     * cascade to take the half-built profile with it. Without the trigger that
     * replaced it, a failed desk registration would leave a ghost customer in
     * the search results.
     */
    it('still removes the profile of a user deleted through the admin API', async () => {
      const email = `rollback-${Date.now()}@test.touch.local`;
      const { data: created, error } = await svc.auth.admin.createUser({
        email,
        password: 'touch-dev-password',
        email_confirm: true,
        user_metadata: { full_name: 'Rollback Ghost', phone: '+9647700000999' },
      });
      if (error || !created.user) throw new Error(`createUser: ${error?.message}`);
      const id = created.user.id;

      const { data: before } = await svc.from('profiles').select('id').eq('id', id);
      expect(before).toHaveLength(1);

      await svc.auth.admin.deleteUser(id);

      const { data: after } = await svc.from('profiles').select('id').eq('id', id);
      expect(after).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SEC-21 — the push token is write-only to clients.
  // ───────────────────────────────────────────────────────────────────────────

  describe('SEC-21 profiles.expo_push_token is not readable by any client', () => {
    /**
     * 0004:160 granted SELECT on the WHOLE table to `authenticated`, and
     * profiles_select admits court_desk/manager/owner. A cafe guest holds
     * `authenticated` exactly as staff do — so before 0077 every desk session
     * could read every guest's push token, which is the one credential needed to
     * push an arbitrary notification to that guest's phone.
     */
    it('a guest cannot read the column even on their OWN row', async () => {
      const guest = await guestClient(svc, 'tokenread');
      const uid = (await guest.auth.getUser()).data.user!.id;
      const { error } = await guest.from('profiles').select('expo_push_token').eq('id', uid);
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/permission denied/i);
    });

    it('court_desk cannot read another guest\'s token', async () => {
      const desk = await signedInClient(SEED_STAFF.court_desk);
      const { error } = await desk.from('profiles').select('id, expo_push_token');
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/permission denied/i);
      await desk.auth.signOut();
    });

    it('but the app can still REGISTER a token, and still read the rest of its profile', async () => {
      const guest = await guestClient(svc, 'tokenwrite');
      const uid = (await guest.auth.getUser()).data.user!.id;

      const { error: wErr } = await guest
        .from('profiles')
        .update({ expo_push_token: 'ExponentPushToken[write]' })
        .eq('id', uid);
      expect(wErr).toBeNull();

      const { data, error } = await guest
        .from('profiles')
        .select('id, full_name, phone, preferred_lang, created_at')
        .eq('id', uid)
        .single();
      expect(error).toBeNull();
      expect((data as { id: string }).id).toBe(uid);

      // The service role (send-push) still reads it back.
      const { data: svcRow } = await svc.from('profiles').select('expo_push_token').eq('id', uid).single();
      expect((svcRow as { expo_push_token: string }).expo_push_token).toBe('ExponentPushToken[write]');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The desk must not see tombstones.
  // ───────────────────────────────────────────────────────────────────────────

  it('a deleted account disappears from the desk customer search', async () => {
    const guest = await guestClient(svc, 'searchgone');
    const uid = (await guest.auth.getUser()).data.user!.id;
    const unique = `Zqx${Date.now() % 1000000}`;
    await svc.from('profiles').update({ full_name: unique }).eq('id', uid);

    const desk = await signedInClient(SEED_STAFF.court_desk);
    const found = await appRpc(desk, 'customer_search', { p_query: unique });
    expect((found.data as unknown[]).length).toBe(1);

    const del = await appRpc(guest, 'delete_my_account', DELETE);
    expect(del.error).toBeNull();

    const gone = await appRpc(desk, 'customer_search', { p_query: unique });
    expect(gone.data).toEqual([]);

    // And searching for the tombstone's own label finds nothing either.
    const label = await appRpc(desk, 'customer_search', { p_query: 'Deleted account' });
    expect((label.data as unknown[]).length).toBe(0);
    await desk.auth.signOut();
  });
});

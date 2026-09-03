/**
 * 0066 — recurring reservation series (spec 06.5 RecurringSeriesCreate,
 * 06.6 SeriesDetail; build plan 2026-09-03 §4 "0066 series").
 *
 * Every occurrence is created through app.staff_create_reservation, so the
 * exclusion constraint, the booking-hours guard and pricing apply unchanged;
 * these cases prove the series layer on top of it:
 *
 *   - preview generates the right venue-local dates for all three patterns
 *   - a pre-existing booking shows as a conflict with alternative courts
 *   - create honours 'skip' and 'moveCourt' resolutions
 *   - an unresolved conflict rolls the WHOLE series back (no row anywhere)
 *   - a repeat with the same idempotency key returns the same series
 *   - cancel 'future' never touches a played occurrence, and every cancelled
 *     row carries an audit row with the reason
 *   - cashier is FORBIDDEN; a guest cannot preview/create/cancel but may read
 *     a series it owns
 *
 * Venue timezone is Asia/Baghdad (UTC+3, no DST since 2008); opening hours in
 * the seed are 09:00-24:00 (+ a 00:00-02:00 tail), so 10:00-21:00 local is
 * always bookable and 03:00 local never is.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  guestClient,
  appRpc,
  outcome,
  createTestCourt,
  ensureTestRateRule,
  testIdemKey,
  SEED_STAFF,
} from './helpers';

const up = await stackAvailable();

interface Conflict {
  existingReservationId: string | null;
  existingKind: string | null;
  reason: string;
  resolvable: boolean;
  alternativeCourtIds: string[];
}
interface Occurrence {
  date: string;
  startsAt: string;
  endsAt: string;
  courtId: string;
  conflict: Conflict | null;
}
interface Preview {
  occurrences: Occurrence[];
  count: number;
}
interface Created {
  duplicate: boolean;
  seriesId: string;
  created: string[];
  skipped: string[];
}
interface Detail {
  series: { id: string; court_id: string; court_name_en: string; cancelled_at: string | null };
  occurrences: {
    id: string;
    court_id: string;
    court_name_en: string;
    status: string;
    played: boolean;
  }[];
}

/** Venue-local wall clock (Asia/Baghdad, +03:00) -> the UTC instant. */
function localToUtc(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+03:00`);
}
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dow(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * Series start 60 days out: clear of every other suite's futureSlot() window
 * (7..~20 days) and well inside anything the desk path bounds. Each case uses
 * its own fresh court, so the only shared state is the venue calendar.
 */
const BASE = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 60);
  return d.toISOString().slice(0, 10);
})();

const WEEKLY = (courtId: string, startTime = '10:00', extra: Record<string, unknown> = {}) => ({
  p_court_id: courtId,
  p_pattern: 'weekly',
  p_weekdays: null,
  p_start_time: startTime,
  p_duration_min: 60,
  p_starts_on: BASE,
  p_ends_on: addDays(BASE, 21),
  ...extra,
});

describe.skipIf(!up)('0066 reservation series', () => {
  let svc: SupabaseClient;
  let desk: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let guest: SupabaseClient;
  let guestId: string;

  beforeAll(async () => {
    svc = serviceClient();
    desk = await signedInClient(SEED_STAFF.court_desk);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    guest = await guestClient(svc, 'series');
    guestId = (await guest.auth.getUser()).data.user!.id;
    await ensureTestRateRule(svc);
  });

  afterAll(async () => {
    await Promise.all([desk, manager, cashier, guest].map((c) => c.auth.signOut()));
  });

  /** A confirmed desk booking planted directly (service role): the blocker. */
  async function plantBooking(courtId: string, date: string, time: string, extra: Record<string, unknown> = {}) {
    const start = localToUtc(date, time);
    const { data, error } = await svc
      .from('reservations')
      .insert({
        court_id: courtId,
        kind: 'booking',
        status: 'confirmed',
        source: 'desk',
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + 3600_000).toISOString(),
        guest_name: 'series-test blocker',
        price_iqd: 40_000,
        ...extra,
      })
      .select('id')
      .single();
    if (error) throw new Error(`plantBooking failed: ${error.message}`);
    return (data as { id: string }).id;
  }

  it('preview generates the right venue-local dates for weekly, fortnightly and weekdays', async () => {
    const court = await createTestCourt(svc, 'S66-preview');

    const weekly = await appRpc(desk, 'preview_series', WEEKLY(court));
    expect(weekly.error).toBeNull();
    const w = (weekly.data as Preview).occurrences;
    expect(w.map((o) => o.date)).toEqual([0, 7, 14, 21].map((n) => addDays(BASE, n)));
    expect(new Date(w[0]!.startsAt).toISOString()).toBe(localToUtc(BASE, '10:00').toISOString());
    expect(new Date(w[0]!.endsAt).getTime() - new Date(w[0]!.startsAt).getTime()).toBe(3600_000);
    expect(w.every((o) => o.conflict === null)).toBe(true);
    expect(w.every((o) => o.courtId === court)).toBe(true);

    const fortnightly = await appRpc(desk, 'preview_series', {
      ...WEEKLY(court),
      p_pattern: 'fortnightly',
      p_ends_on: addDays(BASE, 28),
    });
    expect(fortnightly.error).toBeNull();
    expect((fortnightly.data as Preview).occurrences.map((o) => o.date)).toEqual(
      [0, 14, 28].map((n) => addDays(BASE, n)),
    );

    const weekdays = await appRpc(desk, 'preview_series', {
      ...WEEKLY(court),
      p_pattern: 'weekdays',
      p_weekdays: [1, 3],
      p_ends_on: addDays(BASE, 13),
    });
    expect(weekdays.error).toBeNull();
    const expected = Array.from({ length: 14 }, (_, i) => addDays(BASE, i)).filter((d) =>
      [1, 3].includes(dow(d)),
    );
    expect(expected).toHaveLength(4);
    expect((weekdays.data as Preview).occurrences.map((o) => o.date)).toEqual(expected);

    // Validation, by name.
    const badPattern = outcome(await appRpc(desk, 'preview_series', { ...WEEKLY(court), p_pattern: 'monthly' }));
    expect(badPattern.errorMessage).toContain('INVALID_PATTERN');
    const badDays = outcome(
      await appRpc(desk, 'preview_series', { ...WEEKLY(court), p_pattern: 'weekdays', p_weekdays: [7] }),
    );
    expect(badDays.errorMessage).toContain('INVALID_WEEKDAYS');
    const tooLong = outcome(
      await appRpc(desk, 'preview_series', {
        ...WEEKLY(court),
        p_pattern: 'weekdays',
        p_weekdays: [0, 1, 2, 3, 4, 5, 6],
        p_ends_on: addDays(BASE, 250),
      }),
    );
    expect(tooLong.errorMessage).toContain('SERIES_TOO_LONG');
  });

  it('a pre-existing booking is a conflict with alternative courts; closed hours are not resolvable', async () => {
    const court = await createTestCourt(svc, 'S66-conflict');
    const spare = await createTestCourt(svc, 'S66-spare');
    const blocker = await plantBooking(court, addDays(BASE, 7), '10:00');

    const res = await appRpc(desk, 'preview_series', WEEKLY(court));
    expect(res.error).toBeNull();
    const occ = (res.data as Preview).occurrences;
    expect(occ[0]!.conflict).toBeNull();
    const clash = occ[1]!;
    expect(clash.date).toBe(addDays(BASE, 7));
    expect(clash.conflict?.existingReservationId).toBe(blocker);
    expect(clash.conflict?.existingKind).toBe('booking');
    expect(clash.conflict?.reason).toBe('SLOT_TAKEN');
    expect(clash.conflict?.resolvable).toBe(true);
    expect(clash.conflict?.alternativeCourtIds).toContain(spare);
    expect(clash.conflict?.alternativeCourtIds).not.toContain(court);

    // A maintenance block occupies the same table and reads as a conflict too.
    const block = await plantBooking(court, addDays(BASE, 14), '10:00', {
      kind: 'maintenance',
      guest_name: null,
      price_iqd: null,
    });
    const again = await appRpc(desk, 'preview_series', WEEKLY(court));
    expect(again.error).toBeNull();
    const blocked = (again.data as Preview).occurrences[2]!;
    expect(blocked.conflict?.existingReservationId).toBe(block);
    expect(blocked.conflict?.existingKind).toBe('maintenance');

    // 03:00 local is outside opening hours on every day: venue-wide, so no
    // other court can take it.
    const closed = await appRpc(desk, 'preview_series', WEEKLY(court, '03:00'));
    expect(closed.error).toBeNull();
    for (const o of (closed.data as Preview).occurrences) {
      expect(o.conflict?.reason).toBe('OUTSIDE_HOURS');
      expect(o.conflict?.existingReservationId).toBeNull();
      expect(o.conflict?.resolvable).toBe(false);
      expect(o.conflict?.alternativeCourtIds).toEqual([]);
    }
  });

  it("create with a 'skip' resolution, tagged and audited; the same key replays the same series", async () => {
    const court = await createTestCourt(svc, 'S66-skip');
    await plantBooking(court, addDays(BASE, 7), '10:00');
    const key = testIdemKey('series.create');
    const args = WEEKLY(court, '10:00', {
      p_guest_name: 'Series Skip',
      p_guest_phone: '+9647700000001',
      p_notes: 'weekly club night',
      p_resolutions: [{ date: addDays(BASE, 7), action: 'skip' }],
      p_idempotency_key: key,
      p_device_id: 'TEST-DESK',
    });

    const first = await appRpc(desk, 'create_series', args);
    expect(first.error, first.error?.message).toBeNull();
    const c = first.data as Created;
    expect(c.duplicate).toBe(false);
    expect(c.created).toHaveLength(3);
    expect(c.skipped).toEqual([addDays(BASE, 7)]);

    const { data: rows } = await svc
      .from('reservations')
      .select('id, court_id, kind, status, series_id, idempotency_key, guest_name, price_iqd, start_at')
      .eq('series_id', c.seriesId)
      .order('start_at');
    const r = rows as {
      id: string; court_id: string; kind: string; status: string; idempotency_key: string;
      guest_name: string; price_iqd: number; start_at: string;
    }[];
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.id).sort()).toEqual([...c.created].sort());
    expect(r.every((x) => x.court_id === court && x.kind === 'booking' && x.status === 'confirmed')).toBe(true);
    expect(r.every((x) => x.guest_name === 'Series Skip' && x.price_iqd > 0)).toBe(true);
    expect(r.map((x) => x.idempotency_key)).toEqual(
      [0, 14, 21].map((n) => `${key}:${addDays(BASE, n)}`),
    );
    expect(r.map((x) => new Date(x.start_at).toISOString())).toEqual(
      [0, 14, 21].map((n) => localToUtc(addDays(BASE, n), '10:00').toISOString()),
    );

    const { data: series } = await svc.from('reservation_series').select('*').eq('id', c.seriesId).single();
    expect(series).toMatchObject({
      court_id: court,
      pattern: 'weekly',
      duration_min: 60,
      starts_on: BASE,
      ends_on: addDays(BASE, 21),
      guest_name: 'Series Skip',
      idempotency_key: key,
      cancelled_at: null,
    });

    const { data: audit } = await svc
      .from('audit_log')
      .select('action, device_id, after')
      .eq('entity', 'reservation_series')
      .eq('entity_id', c.seriesId);
    expect(audit).toHaveLength(1);
    expect(audit![0]).toMatchObject({ action: 'series.create', device_id: 'TEST-DESK' });
    expect((audit![0] as { after: { skipped: string[] } }).after.skipped).toEqual([addDays(BASE, 7)]);

    // Same key, same caller: the same series, nothing new written.
    const replay = await appRpc(desk, 'create_series', args);
    expect(replay.error).toBeNull();
    const d = replay.data as Created;
    expect(d.duplicate).toBe(true);
    expect(d.seriesId).toBe(c.seriesId);
    expect([...d.created].sort()).toEqual([...c.created].sort());
    expect(d.skipped).toEqual([addDays(BASE, 7)]);
    const { count } = await svc
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('series_id', c.seriesId);
    expect(count).toBe(3);

    // Same key, another staff member: refused, nothing learned (0048/H3).
    const other = outcome(await appRpc(manager, 'create_series', args));
    expect(other.errorMessage).toContain('IDEMPOTENCY_CONFLICT');
    expect(other.errorMessage).not.toContain(c.seriesId);
  });

  it("create with a 'moveCourt' resolution places that occurrence on the other court", async () => {
    const court = await createTestCourt(svc, 'S66-move');
    const spare = await createTestCourt(svc, 'S66-move-spare');
    await plantBooking(court, addDays(BASE, 7), '10:00');

    const res = await appRpc(desk, 'create_series', WEEKLY(court, '10:00', {
      p_guest_id: guestId,
      p_resolutions: [{ date: addDays(BASE, 7), action: 'moveCourt', courtId: spare }],
      p_idempotency_key: testIdemKey('series.create'),
    }));
    expect(res.error, res.error?.message).toBeNull();
    const c = res.data as Created;
    expect(c.created).toHaveLength(4);
    expect(c.skipped).toEqual([]);

    const detail = await appRpc(desk, 'series_detail', { p_series_id: c.seriesId });
    expect(detail.error).toBeNull();
    const d = detail.data as Detail;
    expect(d.series.court_id).toBe(court);
    expect(d.series.court_name_en).toBe('S66-move');
    expect(d.occurrences.map((o) => o.court_id)).toEqual([court, spare, court, court]);
    const movedOcc = d.occurrences[1]!;
    expect(movedOcc.court_name_en).toBe('S66-move-spare');
    expect(d.occurrences.every((o) => o.status === 'confirmed' && o.played === false)).toBe(true);

    // The moved one is still a member of the series.
    const { data: moved } = await svc
      .from('reservations')
      .select('series_id, guest_id')
      .eq('id', movedOcc.id)
      .single();
    expect(moved).toEqual({ series_id: c.seriesId, guest_id: guestId });

    // A resolution naming a nonsense court is refused before anything is written.
    const bad = outcome(await appRpc(desk, 'create_series', WEEKLY(court, '12:00', {
      p_guest_name: 'x',
      p_resolutions: [{ date: BASE, action: 'moveCourt', courtId: 'not-a-uuid' }],
    })));
    expect(bad.errorMessage).toContain('INVALID_RESOLUTION');
  });

  it('an unresolved conflict rolls back the whole series: no series row, no reservations', async () => {
    const court = await createTestCourt(svc, 'S66-unresolved');
    const blocker = await plantBooking(court, addDays(BASE, 14), '10:00');
    const key = testIdemKey('series.create');

    const res = await appRpc(desk, 'create_series', WEEKLY(court, '10:00', {
      p_guest_name: 'No Resolution',
      p_idempotency_key: key,
    }));
    expect(res.error?.message).toContain('SERIES_UNRESOLVED_CONFLICTS');
    expect(res.error?.details).toBe(addDays(BASE, 14));
    expect(res.error?.hint).toContain('SLOT_TAKEN');

    // Occurrences BEFORE the clash (BASE, BASE+7) were inserted inside the
    // transaction; the rollback took them with it.
    const { data: series } = await svc.from('reservation_series').select('id').eq('idempotency_key', key);
    expect(series).toEqual([]);
    const { data: byKey } = await svc.from('reservations').select('id').like('idempotency_key', `${key}:%`);
    expect(byKey).toEqual([]);
    const { data: onCourt } = await svc.from('reservations').select('id').eq('court_id', court);
    expect((onCourt as { id: string }[]).map((r) => r.id)).toEqual([blocker]);
    const { data: audit } = await svc.from('audit_log').select('id').eq('action', 'series.create').eq('device_id', key);
    expect(audit).toEqual([]);

    // Resolving it makes the identical call succeed.
    const ok = await appRpc(desk, 'create_series', WEEKLY(court, '10:00', {
      p_guest_name: 'No Resolution',
      p_idempotency_key: key,
      p_resolutions: [{ date: addDays(BASE, 14), action: 'skip' }],
    }));
    expect(ok.error, ok.error?.message).toBeNull();
    expect((ok.data as Created).created).toHaveLength(3);
  });

  it("cancel 'future' leaves a played occurrence untouched and audits every cancelled row with the reason", async () => {
    const court = await createTestCourt(svc, 'S66-cancel');
    const res = await appRpc(desk, 'create_series', WEEKLY(court, '10:00', {
      p_guest_name: 'Cancel Me',
      p_idempotency_key: testIdemKey('series.create'),
    }));
    expect(res.error, res.error?.message).toBeNull();
    const c = res.data as Created;

    // A played occurrence: three days ago, still 'confirmed' (never marked), so
    // status alone would let cancel_reservation take it. end_at < now() must win.
    const past = new Date(Date.now() - 3 * 24 * 3600_000);
    const { data: playedRow, error: plantErr } = await svc
      .from('reservations')
      .insert({
        court_id: court,
        kind: 'booking',
        status: 'confirmed',
        source: 'desk',
        start_at: past.toISOString(),
        end_at: new Date(past.getTime() + 3600_000).toISOString(),
        guest_name: 'Cancel Me',
        price_iqd: 40_000,
        series_id: c.seriesId,
      })
      .select('id')
      .single();
    expect(plantErr).toBeNull();
    const playedId = (playedRow as { id: string }).id;

    const before = await appRpc(desk, 'series_detail', { p_series_id: c.seriesId });
    expect(before.error).toBeNull();
    const played = (before.data as Detail).occurrences.find((o) => o.id === playedId);
    expect(played?.played).toBe(true);
    expect((before.data as Detail).occurrences.filter((o) => o.played)).toHaveLength(1);

    const noReason = outcome(
      await appRpc(desk, 'cancel_series', { p_series_id: c.seriesId, p_scope: 'future', p_reason_code: '  ' }),
    );
    expect(noReason.errorMessage).toContain('REASON_REQUIRED');
    const badScope = outcome(
      await appRpc(desk, 'cancel_series', { p_series_id: c.seriesId, p_scope: 'past', p_reason_code: 'guest_request' }),
    );
    expect(badScope.errorMessage).toContain('INVALID_SCOPE');

    const cancel = await appRpc(desk, 'cancel_series', {
      p_series_id: c.seriesId,
      p_scope: 'future',
      p_reason_code: 'guest_request',
    });
    expect(cancel.error, cancel.error?.message).toBeNull();
    const cancelled = (cancel.data as { cancelled: string[]; seriesCancelledAt: string | null }).cancelled;
    expect([...cancelled].sort()).toEqual([...c.created].sort());
    expect(cancelled).not.toContain(playedId);

    const { data: rows } = await svc
      .from('reservations')
      .select('id, status, cancellation_reason')
      .eq('series_id', c.seriesId);
    const byId = new Map((rows as { id: string; status: string; cancellation_reason: string | null }[]).map((r) => [r.id, r]));
    expect(byId.get(playedId)).toMatchObject({ status: 'confirmed', cancellation_reason: null });
    for (const id of c.created) {
      expect(byId.get(id)).toMatchObject({ status: 'cancelled', cancellation_reason: 'guest_request' });
    }

    const { data: audit } = await svc
      .from('audit_log')
      .select('entity_id, reason_code')
      .eq('action', 'reservation.cancel')
      .in('entity_id', [...c.created, playedId]);
    const a = audit as { entity_id: string; reason_code: string }[];
    expect(a.map((x) => x.entity_id).sort()).toEqual([...c.created].sort());
    expect(a.every((x) => x.reason_code === 'guest_request')).toBe(true);

    const { data: seriesAudit } = await svc
      .from('audit_log')
      .select('reason_code')
      .eq('action', 'series.cancel')
      .eq('entity_id', c.seriesId);
    expect(seriesAudit).toEqual([{ reason_code: 'guest_request' }]);

    // Nothing live remains ahead of it: the plan itself is stamped.
    const { data: series } = await svc
      .from('reservation_series')
      .select('cancelled_at, cancelled_reason')
      .eq('id', c.seriesId)
      .single();
    expect((series as { cancelled_at: string | null }).cancelled_at).not.toBeNull();
    expect((series as { cancelled_reason: string }).cancelled_reason).toBe('guest_request');

    // Idempotent: a second cancel finds nothing to do and changes nothing.
    const again = await appRpc(desk, 'cancel_series', {
      p_series_id: c.seriesId,
      p_scope: 'all',
      p_reason_code: 'guest_request',
    });
    expect(again.error).toBeNull();
    expect((again.data as { cancelled: string[] }).cancelled).toEqual([]);
    const { data: stillPlayed } = await svc.from('reservations').select('status').eq('id', playedId).single();
    expect(stillPlayed).toEqual({ status: 'confirmed' });
  });

  it('cashier is FORBIDDEN everywhere; a guest cannot preview, create or cancel, but reads a series it owns', async () => {
    const court = await createTestCourt(svc, 'S66-authz');

    for (const c of [cashier, guest]) {
      const preview = outcome(await appRpc(c, 'preview_series', WEEKLY(court)));
      expect(preview.errorMessage).toContain('FORBIDDEN');
      const create = outcome(await appRpc(c, 'create_series', WEEKLY(court, '10:00', { p_guest_name: 'x' })));
      expect(create.errorMessage).toContain('FORBIDDEN');
      const cancel = outcome(
        await appRpc(c, 'cancel_series', { p_series_id: court, p_scope: 'future', p_reason_code: 'x' }),
      );
      expect(cancel.errorMessage).toContain('FORBIDDEN');
    }

    // Owned by the guest: the desk creates it against the guest's account.
    const res = await appRpc(desk, 'create_series', WEEKLY(court, '10:00', {
      p_guest_id: guestId,
      p_idempotency_key: testIdemKey('series.create'),
    }));
    expect(res.error, res.error?.message).toBeNull();
    const seriesId = (res.data as Created).seriesId;

    const own = await appRpc(guest, 'series_detail', { p_series_id: seriesId });
    expect(own.error).toBeNull();
    expect((own.data as Detail).series.id).toBe(seriesId);
    expect((own.data as Detail).occurrences).toHaveLength(4);
    const ownRow = await guest.from('reservation_series').select('id').eq('id', seriesId);
    expect(ownRow.error).toBeNull();
    expect(ownRow.data).toHaveLength(1);

    // Another guest: RLS silence on the table, SERIES_NOT_FOUND from the RPC.
    const stranger = await guestClient(svc, 'series-stranger');
    const peek = await stranger.from('reservation_series').select('id').eq('id', seriesId);
    expect(peek.error).toBeNull();
    expect(peek.data).toHaveLength(0);
    const detail = outcome(await appRpc(stranger, 'series_detail', { p_series_id: seriesId }));
    expect(detail.errorMessage).toContain('SERIES_NOT_FOUND');
    await stranger.auth.signOut();

    // The cashier may READ series (till needs to charge to a booking) and so may the desk.
    const cashierRead = await cashier.from('reservation_series').select('id').eq('id', seriesId);
    expect(cashierRead.error).toBeNull();
    expect(cashierRead.data).toHaveLength(1);
    const cashierDetail = await appRpc(cashier, 'series_detail', { p_series_id: seriesId });
    expect(cashierDetail.error).toBeNull();

    // Direct writes are RPC-only for every principal, staff included.
    const direct = await desk.from('reservation_series').insert({
      court_id: court,
      pattern: 'weekly',
      start_time: '10:00',
      duration_min: 60,
      starts_on: BASE,
      ends_on: BASE,
      guest_name: 'x',
    });
    expect(direct.error).not.toBeNull();
    const tag = await desk.from('reservations').update({ series_id: null }).eq('series_id', seriesId);
    expect(tag.error).not.toBeNull();
  });
});

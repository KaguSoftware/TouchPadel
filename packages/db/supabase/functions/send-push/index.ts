/**
 * send-push — outbox sender for Expo push notifications.
 *
 * Invoked through app.push_nudge (service-role Authorization header; see
 * packages/db/README.md "Edge functions") — the moment a booking notification
 * is queued, and by the tp_push_sweep cron every 30 s (migration 0090). Flow:
 *   1. app.claim_due_notifications(limit) — due, unsent, attempts < 5, not
 *      claimed in the last 60 s, SKIP LOCKED; claiming increments `attempts`
 *      and stamps `claimed_at` (0024, lease 0090). Overlapping invocations
 *      therefore never send the same row twice — as long as this function
 *      finishes inside the lease, which is what EXPO_TIMEOUT_MS guarantees.
 *   2. Resolve each row's CURRENT expo_push_token + preferred_lang from
 *      profiles (tokens rot, language is a live preference) and court names.
 *   3. Batch to https://exp.host/--/api/v2/push/send (max 100/request).
 *   4. Per-ticket: ok -> sent_at; error -> last_error (row retries once its
 *      lease runs out, until the attempts cap of 5); DeviceNotRegistered also clears
 *      the profile's token so future bookings stop enqueueing.
 *
 * Three families of kind. The booking kinds (and `test`) take their copy from
 * STRINGS below, with the court and time. The staff kinds, queued only by
 * app.notify_staff, name their copy by payload.title_key and read it from
 * staffStrings.ts (build-contracts-2026-09-23 §2.21); _shared/staff-push.json
 * is the one list of their kinds, title keys and routes. The guest kinds of
 * open matches (match_update, match_reminder, match_message), queued only by
 * app.match_notify (0261), do the same with guestStrings.ts and
 * _shared/guest-push.json (docs/design/open-matches/guest.md §4.7), with the
 * match's time and branch read from the match row. This function must be
 * deployed before the migration that lets the outbox hold a staff or guest
 * kind: a kind or title key it does not know is terminal.
 */
import { createServiceClient, isServiceRoleRequest } from '../_shared/supabase.ts';
import { json } from '../_shared/http.ts';
import staffPush from '../_shared/staff-push.json' with { type: 'json' };
import guestPush from '../_shared/guest-push.json' with { type: 'json' };
import { staffMessage } from './staffStrings.ts';
import { guestMessage, guestTime, guestWhen } from './guestStrings.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100;
const CLAIM_LIMIT = 100;
const RETRY_CAP = 5; // mirrors the attempts < 5 filter in app.claim_due_notifications
/**
 * Upper bound on one Expo request, reply body included. Without it a stalled
 * connection keeps this invocation alive until the platform's own limit
 * (minutes), long past the 60 s claim lease (0090) — and the next sweep then
 * re-claims rows this invocation may still deliver: a duplicate. 15 s is far
 * above Expo's normal sub-second answer and keeps the worst-case invocation
 * (cold start + reads + this + per-row stamps) near half the lease. A timed-out
 * batch takes the transport-failure path below and is retried after the lease.
 */
const EXPO_TIMEOUT_MS = 15_000;
/**
 * Must equal ANDROID_CHANNEL in apps/mobile/src/features/profile/push.ts — the
 * channel the app creates at boot. Named explicitly rather than left to Expo's
 * fallback, so the importance the app configured (MAX) is the one that applies.
 */
const ANDROID_CHANNEL_ID = 'default';

type Lang = 'en' | 'ar';

const STAFF_KINDS: ReadonlySet<string> = new Set(staffPush.kinds);
const STAFF_ROUTES: ReadonlySet<string> = new Set(staffPush.routes);
const GUEST_KINDS: ReadonlySet<string> = new Set(guestPush.kinds);
const GUEST_ROUTES: ReadonlySet<string> = new Set(guestPush.routes);
const GUEST_KEY_KINDS: Readonly<Record<string, string>> = guestPush.title_keys;
/** A guest row's match id is looked up only when it is a uuid (a bad one would fail the batch read). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_TZ = 'Asia/Baghdad';

// Booking notification copy, EN/AR. SOURCE OF TRUTH: packages/i18n (@touch/i18n) —
// edge functions bundle standalone, so the few push strings are duplicated
// here; keep in sync with the `push.*` keys there when they change. The staff
// kinds' copy is in staffStrings.ts.
const STRINGS: Record<Lang, Record<string, { title: string; body: (court: string, when: string) => string }>> = {
  en: {
    booking_confirmed: {
      title: 'Booking confirmed',
      body: (court, when) => `You're booked on ${court} at ${when}. See you there!`,
    },
    booking_reminder: {
      title: 'Your game is in 3 hours',
      body: (court, when) => `${court} at ${when}.`,
    },
    booking_cancelled: {
      title: 'Booking cancelled',
      body: (court, when) => `Your booking on ${court} at ${when} has been cancelled.`,
    },
    // Deliberately not worded as a cancellation, and deliberately not
    // accusatory: the guest may well have been there and the desk may well
    // have got it wrong, so it says what happened and where to take it.
    booking_no_show: {
      title: 'Booking closed',
      body: (court, when) => `Your booking on ${court} at ${when} was closed as a no-show. Speak to the desk if that is wrong.`,
    },
    // Settings > "Send a test notification" (app.send_test_push, migration 0070).
    test: {
      title: 'Test notification',
      body: () => 'Push notifications are working on this phone.',
    },
    // 0241: an online deposit went back to the guest's card (app.deposit_refund_apply).
    deposit_refunded: {
      title: 'Deposit refunded',
      body: (court, when) => `Your deposit for ${court} at ${when} is on its way back to your card.`,
    },
  },
  ar: {
    booking_confirmed: {
      title: 'تم تأكيد الحجز',
      body: (court, when) => `تم حجزك في ${court} الساعة ${when}. نراك هناك!`,
    },
    booking_reminder: {
      title: 'مباراتك بعد ٣ ساعات',
      body: (court, when) => `${court} الساعة ${when}.`,
    },
    booking_cancelled: {
      title: 'تم إلغاء الحجز',
      body: (court, when) => `تم إلغاء حجزك في ${court} الساعة ${when}.`,
    },
    booking_no_show: {
      title: 'تم إغلاق الحجز',
      body: (court, when) => `تم إغلاق حجزك في ${court} الساعة ${when} لعدم الحضور. راجع الاستقبال إذا كان ذلك غير صحيح.`,
    },
    test: {
      title: 'إشعار تجريبي',
      body: () => 'الإشعارات تعمل على هذا الهاتف.',
    },
    deposit_refunded: {
      title: 'تمت إعادة العربون',
      body: (court, when) => `العربون الذي دفعته لحجز ${court} الساعة ${when} في طريقه إلى بطاقتك.`,
    },
  },
};

function formatWhen(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-IQ' : 'en-GB', {
    timeZone: 'Asia/Baghdad', // venue timezone (venue_settings.timezone)
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

interface OutboxRow {
  id: number;
  profile_id: string;
  kind:
    | 'booking_confirmed'
    | 'booking_reminder'
    | 'booking_cancelled'
    | 'booking_no_show'
    | 'test'
    | 'staff_task'
    | 'staff_decide'
    | 'staff_decided'
    | 'staff_info'
    | 'deposit_refunded'
    | 'match_update'
    | 'match_reminder'
    | 'match_message';
  /**
   * Reservation snapshot for the booking kinds; `{ source }` only for `test`;
   * `{ route, id, title_key, params, dedupe? }` for the staff and guest kinds.
   */
  payload: {
    reservation_id?: string;
    court_id?: string;
    start_at?: string;
    end_at?: string;
    price_iqd?: number | null;
    source?: string;
    route?: unknown;
    id?: unknown;
    title_key?: unknown;
    params?: unknown;
  };
  attempts: number;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  // Cron calls with the service-role key; nothing else may trigger sends.
  if (!isServiceRoleRequest(req)) return json({ error: 'forbidden' }, 403);

  const db = createServiceClient();

  const { data: claimed, error: claimErr } = await db
    .schema('app')
    .rpc('claim_due_notifications', { p_limit: CLAIM_LIMIT });
  if (claimErr) return json({ error: claimErr.message }, 500);

  const rows = (claimed ?? []) as OutboxRow[];
  if (rows.length === 0) return json({ claimed: 0, sent: 0, failed: 0 });

  // Resolve current tokens/langs and court names in two batch reads.
  const profileIds = [...new Set(rows.map((r) => r.profile_id))];
  const courtIds = [...new Set(rows.map((r) => r.payload.court_id).filter((id): id is string => !!id))];
  const [profilesRes, courtsRes] = await Promise.all([
    db.from('profiles').select('id, expo_push_token, preferred_lang').in('id', profileIds),
    db.from('courts').select('id, name_en, name_ar').in('id', courtIds),
  ]);
  if (profilesRes.error) return json({ error: profilesRes.error.message }, 500);
  if (courtsRes.error) return json({ error: courtsRes.error.message }, 500);
  const profiles = new Map(profilesRes.data.map((p) => [p.id, p]));
  const courts = new Map(courtsRes.data.map((c) => [c.id, c]));

  // Guest rows (open matches) also need the match (time, branch, category), the
  // branches, and the reader's gender for the one reader-gendered Arabic line.
  // Read only when a guest row was claimed: no guest row can be queued before
  // app.match_notify (0261), and this function ships before 0256 adds
  // profiles.gender and 0258 creates matches, so the booking and staff kinds
  // never depend on either.
  type MatchRow = { id: string; start_at: string; venue_id: string; category: string };
  type VenueRow = { id: string; name_en: string; name_ar: string; timezone: string; is_active: boolean };
  const guestRows = rows.filter((r) => GUEST_KINDS.has(r.kind));
  const matches = new Map<string, MatchRow>();
  const venues = new Map<string, VenueRow>();
  const genders = new Map<string, string | null>();
  let activeVenues = 0;
  if (guestRows.length > 0) {
    const matchIds = [
      ...new Set(
        guestRows
          .map((r) => (r.payload.route === 'match' ? r.payload.id : null))
          .filter((id): id is string => typeof id === 'string' && UUID.test(id)),
      ),
    ];
    const guestIds = [...new Set(guestRows.map((r) => r.profile_id))];
    const [matchesRes, venuesRes, gendersRes] = await Promise.all([
      matchIds.length > 0
        ? db.from('matches').select('id, start_at, venue_id, category').in('id', matchIds)
        : Promise.resolve({ data: [] as MatchRow[], error: null }),
      db.from('venues').select('id, name_en, name_ar, timezone, is_active'),
      db.from('profiles').select('id, gender').in('id', guestIds),
    ]);
    if (matchesRes.error) return json({ error: matchesRes.error.message }, 500);
    if (venuesRes.error) return json({ error: venuesRes.error.message }, 500);
    if (gendersRes.error) return json({ error: gendersRes.error.message }, 500);
    for (const m of (matchesRes.data ?? []) as MatchRow[]) matches.set(m.id, m);
    for (const v of (venuesRes.data ?? []) as VenueRow[]) venues.set(v.id, v);
    for (const g of (gendersRes.data ?? []) as Array<{ id: string; gender: string | null }>) {
      genders.set(g.id, g.gender);
    }
    activeVenues = [...venues.values()].filter((v) => v.is_active).length;
  }

  type Prepared = { row: OutboxRow; message: Record<string, unknown> };
  const prepared: Prepared[] = [];
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const profile = profiles.get(row.profile_id);
    const token = profile?.expo_push_token;
    if (!token) {
      // Terminal: no destination. Cap attempts so the row stops being claimed.
      failed++;
      await db
        .from('notification_outbox')
        .update({ last_error: 'NO_PUSH_TOKEN', attempts: RETRY_CAP })
        .eq('id', row.id);
      continue;
    }
    const lang: Lang = profile.preferred_lang === 'ar' ? 'ar' : 'en';
    if (STAFF_KINDS.has(row.kind)) {
      const m = staffMessage(lang, row.kind, row.payload, STAFF_ROUTES);
      if (m.ok === false) {
        // A title key this build does not know: terminal, never retried.
        failed++;
        await db
          .from('notification_outbox')
          .update({ last_error: m.error, attempts: RETRY_CAP })
          .eq('id', row.id);
        continue;
      }
      const message: Record<string, unknown> = {
        to: token,
        title: m.title,
        sound: 'default',
        priority: 'high', // as the booking kinds below
        channelId: ANDROID_CHANNEL_ID,
        data: m.data,
      };
      if (m.body) message.body = m.body;
      prepared.push({ row, message });
      continue;
    }
    if (GUEST_KINDS.has(row.kind)) {
      // A 'match' route names its match; one that no longer exists is terminal.
      const matchId = row.payload.route === 'match' && typeof row.payload.id === 'string'
        ? row.payload.id
        : null;
      const match = matchId ? matches.get(matchId) : undefined;
      if (matchId && !match) {
        failed++;
        await db
          .from('notification_outbox')
          .update({ last_error: 'MATCH_GONE', attempts: RETRY_CAP })
          .eq('id', row.id);
        continue;
      }
      const venue = match ? venues.get(match.venue_id) : undefined;
      const tz = venue?.timezone || DEFAULT_TZ;
      const g = guestMessage(
        lang,
        row.kind,
        row.payload,
        {
          keyKinds: GUEST_KEY_KINDS,
          category: match?.category ?? null,
          readerGender: genders.get(row.profile_id) ?? null,
          when: match ? guestWhen(match.start_at, lang, tz) : '',
          time: match ? guestTime(match.start_at, lang, tz) : '',
          branch: venue && activeVenues > 1 ? (lang === 'ar' ? venue.name_ar : venue.name_en) : '',
        },
        GUEST_ROUTES,
      );
      if (g.ok === false) {
        // A title key, kind pairing or route this build does not know: terminal.
        failed++;
        await db
          .from('notification_outbox')
          .update({ last_error: g.error, attempts: RETRY_CAP })
          .eq('id', row.id);
        continue;
      }
      const message: Record<string, unknown> = {
        to: token,
        title: g.title,
        sound: 'default',
        priority: 'high', // as the booking kinds below
        channelId: ANDROID_CHANNEL_ID,
        data: g.data,
      };
      if (g.body) message.body = g.body;
      prepared.push({ row, message });
      continue;
    }
    const s = STRINGS[lang][row.kind];
    if (!s) {
      // A kind this build does not know: terminal, never retried.
      failed++;
      await db
        .from('notification_outbox')
        .update({ last_error: `UNKNOWN_KIND:${row.kind}`, attempts: RETRY_CAP })
        .eq('id', row.id);
      continue;
    }
    // `test` carries no reservation: no court, no time, nothing to deep-link.
    const court = row.payload.court_id ? courts.get(row.payload.court_id) : undefined;
    const courtName = (lang === 'ar' ? court?.name_ar : court?.name_en) ?? 'Padel';
    const when = row.payload.start_at ? formatWhen(row.payload.start_at, lang) : '';
    const data: Record<string, string> = { kind: row.kind };
    if (row.payload.reservation_id) data.reservation_id = row.payload.reservation_id;
    prepared.push({
      row,
      message: {
        to: token,
        title: s.title,
        body: s.body(courtName, when),
        sound: 'default',
        // Expo's default is `normal` on Android (iOS already gets high), and
        // Android defers normal-priority messages while the phone dozes, then
        // releases them together when it wakes: the "10 minutes late" and "three
        // at once" reports of 2026-09-13. Every kind here shows a visible
        // notification, which is the condition Android sets for high priority.
        priority: 'high',
        channelId: ANDROID_CHANNEL_ID,
        data,
      },
    });
  }

  for (let i = 0; i < prepared.length; i += EXPO_BATCH_SIZE) {
    const chunk = prepared.slice(i, i + EXPO_BATCH_SIZE);
    let tickets: Array<{ status: string; message?: string; details?: { error?: string } }>;
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk.map((p) => p.message)),
        signal: AbortSignal.timeout(EXPO_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`expo push HTTP ${res.status}`);
      tickets = (await res.json()).data ?? [];
    } catch (e) {
      // Whole-batch transport failure (timeout included): rows stay unsent
      // (attempts already bumped by the claim) and are retried by the sweep
      // once their 60 s lease runs out, up to the cap.
      const msg = e instanceof Error ? e.message : String(e);
      failed += chunk.length;
      await db
        .from('notification_outbox')
        .update({ last_error: msg })
        .in('id', chunk.map((p) => p.row.id));
      continue;
    }

    for (let j = 0; j < chunk.length; j++) {
      const { row } = chunk[j];
      const ticket = tickets[j];
      if (ticket?.status === 'ok') {
        sent++;
        await db
          .from('notification_outbox')
          .update({ sent_at: new Date().toISOString(), last_error: null })
          .eq('id', row.id);
      } else {
        failed++;
        const detail = ticket?.details?.error ?? ticket?.message ?? 'unknown expo ticket error';
        await db.from('notification_outbox').update({ last_error: detail }).eq('id', row.id);
        if (ticket?.details?.error === 'DeviceNotRegistered') {
          // Dead token: stop enqueueing for this profile until the app re-registers.
          await db.from('profiles').update({ expo_push_token: null }).eq('id', row.profile_id);
        }
      }
    }
  }

  return json({ claimed: rows.length, sent, failed });
});

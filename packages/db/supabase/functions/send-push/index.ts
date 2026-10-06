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
 * Four families' worth of copy: booking, staff, open matches, coaching. The
 * booking kinds (and `test`) take their copy from STRINGS below, with the court
 * and time. The staff kinds, queued only by app.notify_staff, name their copy
 * by payload.title_key and read it from staffStrings.ts
 * (build-contracts-2026-09-23 §2.21); _shared/staff-push.json is the one list
 * of their kinds, title keys and routes. The guest kinds of open matches
 * (match_update, match_reminder, match_message), queued only by
 * app.match_notify (0261), do the same with guestStrings.ts and
 * _shared/guest-push.json (docs/design/open-matches/guest.md §4.7), with the
 * match's time and branch read from the match row. The coaching kinds
 * (lesson_update, lesson_reminder, coach_update; queued by app.lesson_notify,
 * lesson_booking) ride the same guest family (docs/design/coaching/guest.md §4.6), with
 * the lesson's time and branch read from the lesson row and a statement's
 * month from the statement row. This function must be deployed before the
 * migration that lets the outbox hold a staff or guest kind: a kind or title
 * key it does not know is terminal.
 */
import { createServiceClient, isServiceRoleRequest } from '../_shared/supabase.ts';
import { errorMessage, fetchWithTimeout, handle, isUuid, json, logError } from '../_shared/http.ts';
import staffPush from '../_shared/staff-push.json' with { type: 'json' };
import guestPush from '../_shared/guest-push.json' with { type: 'json' };
import { staffMessage } from './staffStrings.ts';
import { guestMessage, guestMonth, guestTime, guestWhen } from './guestStrings.ts';
import { reminderStale, type ReminderEnrolment } from './lessonReminder.ts';

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
/** The coaching routes (guest.md §4.6.3): only a row on one of these reads lessons or statements. */
const LESSON_ROUTES: ReadonlySet<string> = new Set(['lesson', 'coach_lesson', 'coach_statements']);
/** The tournament route (tournaments build contracts §1.10): only a row on it reads tournaments. */
const TOURNAMENT_ROUTE = 'tournament';
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
      title: 'أُكّد الحجز',
      body: (court, when) => `حجزك في ${court}، ${when}. نراك هناك.`,
    },
    booking_reminder: {
      title: 'مباراتك بعد 3 ساعات',
      body: (court, when) => `${court}، ${when}.`,
    },
    booking_cancelled: {
      title: 'أُلغي الحجز',
      body: (court, when) => `أُلغي حجزك في ${court}، ${when}.`,
    },
    booking_no_show: {
      title: 'أُغلق الحجز',
      body: (court, when) => `أُغلق حجزك في ${court}، ${when}، لعدم الحضور. راجع الاستقبال إذا كان ذلك غير صحيح.`,
    },
    test: {
      title: 'إشعار تجريبي',
      body: () => 'الإشعارات تعمل على هذا الهاتف.',
    },
    deposit_refunded: {
      title: 'استُرد العربون',
      body: (court, when) => `عربون حجز ${court}، ${when} في طريقه للعودة إلى بطاقتك.`,
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
    | 'match_message'
    | 'lesson_update'
    | 'lesson_reminder'
    | 'coach_update';
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
  /** When the row was due (claim_due_notifications returns the whole row); a lesson.reminder is checked against it. */
  scheduled_for: string;
}

Deno.serve(handle('send-push', async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  // Cron calls with the service-role key; nothing else may trigger sends.
  if (!isServiceRoleRequest(req)) return json({ error: 'forbidden' }, 403);

  const db = createServiceClient();
  /** A failed read: the caller (pg_net) gets the code, the log gets the text. */
  const readFailed = (what: string, error: unknown) => {
    logError('send-push', error, `${what} read failed`);
    return json({ error: 'INTERNAL' }, 500);
  };
  /** Stamp one outbox row; a failed stamp is logged with the row id (the row is then retried after its lease). */
  const stamp = async (id: number, patch: Record<string, unknown>) => {
    const { error } = await db.from('notification_outbox').update(patch).eq('id', id);
    if (error) logError('send-push', error, `outbox ${id} stamp ${JSON.stringify(Object.keys(patch))} failed`);
  };

  const { data: claimed, error: claimErr } = await db
    .schema('app')
    .rpc('claim_due_notifications', { p_limit: CLAIM_LIMIT });
  if (claimErr) return readFailed('claim_due_notifications', claimErr);

  const rows = (claimed ?? []) as OutboxRow[];
  if (rows.length === 0) return json({ claimed: 0, sent: 0, failed: 0 });

  // Resolve current tokens/langs and court names in two batch reads.
  const profileIds = [...new Set(rows.map((r) => r.profile_id))];
  const courtIds = [...new Set(rows.map((r) => r.payload.court_id).filter((id): id is string => !!id))];
  const [profilesRes, courtsRes] = await Promise.all([
    db.from('profiles').select('id, expo_push_token, preferred_lang').in('id', profileIds),
    db.from('courts').select('id, name_en, name_ar').in('id', courtIds),
  ]);
  if (profilesRes.error) return readFailed('profiles', profilesRes.error);
  if (courtsRes.error) return readFailed('courts', courtsRes.error);
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
  type LessonRow = { id: string; start_at: string; venue_id: string; status: string };
  type StatementRow = { id: string; month: string; venue_id: string };
  type TournamentRow = { id: string; venue_id: string; starts_at: string; status: string };
  const guestRows = rows.filter((r) => GUEST_KINDS.has(r.kind));
  const matches = new Map<string, MatchRow>();
  const venues = new Map<string, VenueRow>();
  const genders = new Map<string, string | null>();
  const lessons = new Map<string, LessonRow>();
  const statements = new Map<string, StatementRow>();
  const reminderEnrolments = new Map<string, ReminderEnrolment>();
  const tournaments = new Map<string, TournamentRow>();
  let activeVenues = 0;
  /** A lesson.reminder names its enrolment in payload.id (app.lesson_notify, 0283). */
  const isLessonReminder = (r: OutboxRow): boolean => r.payload.route === 'lesson' && r.payload.title_key === 'lesson.reminder';
  /** The lesson a coaching row is about: route lesson names it in params.lesson_id, coach_lesson in its id. */
  const lessonIdOf = (r: OutboxRow): string | null => {
    const raw =
      r.payload.route === 'lesson'
        ? (r.payload.params as { lesson_id?: unknown } | null | undefined)?.lesson_id
        : r.payload.route === 'coach_lesson'
          ? r.payload.id
          : null;
    return typeof raw === 'string' && raw ? raw : null;
  };
  /** The tournament a tournament row is about: its id (app.tournament_notify). */
  const tournamentIdOf = (r: OutboxRow): string | null =>
    r.payload.route === TOURNAMENT_ROUTE && typeof r.payload.id === 'string' && r.payload.id ? r.payload.id : null;
  const statementIdOf = (r: OutboxRow): string | null =>
    r.payload.route === 'coach_statements' && typeof r.payload.id === 'string' && r.payload.id
      ? r.payload.id
      : null;
  if (guestRows.length > 0) {
    const matchIds = [
      ...new Set(
        guestRows
          .map((r) => (r.payload.route === 'match' ? r.payload.id : null))
          // Only a uuid is looked up: a malformed id would fail the whole batch read.
          .filter((id): id is string => isUuid(id)),
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
    if (matchesRes.error) return readFailed('matches', matchesRes.error);
    if (venuesRes.error) return readFailed('venues', venuesRes.error);
    if (gendersRes.error) return readFailed('profiles.gender', gendersRes.error);
    for (const m of (matchesRes.data ?? []) as MatchRow[]) matches.set(m.id, m);
    for (const v of (venuesRes.data ?? []) as VenueRow[]) venues.set(v.id, v);
    for (const g of (gendersRes.data ?? []) as Array<{ id: string; gender: string | null }>) {
      genders.set(g.id, g.gender);
    }
    activeVenues = [...venues.values()].filter((v) => v.is_active).length;

    // Coaching rows (guest.md §4.6.3): one more batch read each for the lessons
    // and the statements they name, only when such a row was claimed (no
    // coaching row can be queued before app.lesson_notify, lesson_booking; the tables
    // exist from coaching_tables). Only uuids are looked up.
    const lessonRows = guestRows.filter((r) => typeof r.payload.route === 'string' && LESSON_ROUTES.has(r.payload.route));
    if (lessonRows.length > 0) {
      const lessonIds = [...new Set(lessonRows.map(lessonIdOf).filter((id): id is string => isUuid(id)))];
      const statementIds = [...new Set(lessonRows.map(statementIdOf).filter((id): id is string => isUuid(id)))];
      // A reminder's enrolment (EC-02): still booked, still this account's, a student's.
      const enrolmentIds = [
        ...new Set(lessonRows.filter(isLessonReminder).map((r) => r.payload.id).filter((id): id is string => isUuid(id))),
      ];
      const [lessonsRes, statementsRes, enrolmentsRes] = await Promise.all([
        lessonIds.length > 0
          ? db.from('lessons').select('id, start_at, venue_id, status').in('id', lessonIds)
          : Promise.resolve({ data: [] as LessonRow[], error: null }),
        statementIds.length > 0
          ? db.from('coach_statements').select('id, month, venue_id').in('id', statementIds)
          : Promise.resolve({ data: [] as StatementRow[], error: null }),
        enrolmentIds.length > 0
          ? db
              .from('lesson_enrolments')
              .select('id, guest_id, status, booked_by_kind, link_confirmed_at')
              .in('id', enrolmentIds)
          : Promise.resolve({ data: [] as ReminderEnrolment[], error: null }),
      ]);
      if (lessonsRes.error) return readFailed('lessons', lessonsRes.error);
      if (statementsRes.error) return readFailed('coach_statements', statementsRes.error);
      if (enrolmentsRes.error) return readFailed('lesson_enrolments', enrolmentsRes.error);
      for (const l of (lessonsRes.data ?? []) as LessonRow[]) lessons.set(l.id, l);
      for (const s of (statementsRes.data ?? []) as StatementRow[]) statements.set(s.id, s);
      for (const e of (enrolmentsRes.data ?? []) as ReminderEnrolment[]) reminderEnrolments.set(e.id, e);
    }

    // Tournament rows (§1.10): one more batch read, only when such a row was
    // claimed (no tournament row can be queued before app.tournament_notify,
    // tournaments_lifecycle; the table exists from tournaments_schema_money).
    const tournamentIds = [...new Set(guestRows.map(tournamentIdOf).filter((id): id is string => isUuid(id)))];
    if (tournamentIds.length > 0) {
      const tournamentsRes = await db
        .from('tournaments')
        .select('id, venue_id, starts_at, status')
        .in('id', tournamentIds);
      if (tournamentsRes.error) return readFailed('tournaments', tournamentsRes.error);
      for (const t of (tournamentsRes.data ?? []) as TournamentRow[]) tournaments.set(t.id, t);
    }
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
      await stamp(row.id, { last_error: 'NO_PUSH_TOKEN', attempts: RETRY_CAP });
      continue;
    }
    const lang: Lang = profile.preferred_lang === 'ar' ? 'ar' : 'en';
    if (STAFF_KINDS.has(row.kind)) {
      const m = staffMessage(lang, row.kind, row.payload, STAFF_ROUTES);
      if (m.ok === false) {
        // A title key this build does not know: terminal, never retried.
        failed++;
        await stamp(row.id, { last_error: m.error, attempts: RETRY_CAP });
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
        await stamp(row.id, { last_error: 'MATCH_GONE', attempts: RETRY_CAP });
        continue;
      }
      // A coaching row names its lesson or statement; one that no longer
      // exists is terminal, and so is a reminder whose lesson is no longer
      // scheduled, whose enrolment is no longer this student's booked place,
      // or whose lesson moved since it was queued (EC-02: the reminder sync
      // deletes only future rows, so one already due is caught here).
      const lessonId = lessonIdOf(row);
      const lesson = lessonId ? lessons.get(lessonId) : undefined;
      if (lessonId && !lesson) {
        failed++;
        await stamp(row.id, { last_error: 'LESSON_GONE', attempts: RETRY_CAP });
        continue;
      }
      if (
        row.payload.title_key === 'lesson.reminder' &&
        reminderStale(
          row,
          lesson,
          typeof row.payload.id === 'string' ? reminderEnrolments.get(row.payload.id) : undefined,
        )
      ) {
        failed++;
        await stamp(row.id, { last_error: 'REMINDER_STALE', attempts: RETRY_CAP });
        continue;
      }
      const statementId = statementIdOf(row);
      const statement = statementId ? statements.get(statementId) : undefined;
      if (statementId && !statement) {
        failed++;
        await stamp(row.id, { last_error: 'STATEMENT_GONE', attempts: RETRY_CAP });
        continue;
      }
      // A tournament row names its tournament; one that no longer exists is terminal.
      const tournamentId = tournamentIdOf(row);
      const tournament = tournamentId ? tournaments.get(tournamentId) : undefined;
      if (tournamentId && !tournament) {
        failed++;
        await stamp(row.id, { last_error: 'TOURNAMENT_GONE', attempts: RETRY_CAP });
        continue;
      }
      const startAt = match?.start_at ?? lesson?.start_at ?? tournament?.starts_at ?? null;
      const venueId =
        match?.venue_id ?? lesson?.venue_id ?? statement?.venue_id ?? tournament?.venue_id ?? null;
      const venue = venueId ? venues.get(venueId) : undefined;
      const tz = venue?.timezone || DEFAULT_TZ;
      const g = guestMessage(
        lang,
        row.kind,
        row.payload,
        {
          keyKinds: GUEST_KEY_KINDS,
          category: match?.category ?? null,
          readerGender: genders.get(row.profile_id) ?? null,
          when: startAt ? guestWhen(startAt, lang, tz) : '',
          time: startAt ? guestTime(startAt, lang, tz) : '',
          branch: venue && activeVenues > 1 ? (lang === 'ar' ? venue.name_ar : venue.name_en) : '',
          month: statement ? guestMonth(statement.month, lang) : '',
        },
        GUEST_ROUTES,
      );
      if (g.ok === false) {
        // A title key, kind pairing or route this build does not know: terminal.
        failed++;
        await stamp(row.id, { last_error: g.error, attempts: RETRY_CAP });
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
      await stamp(row.id, { last_error: `UNKNOWN_KIND:${row.kind}`, attempts: RETRY_CAP });
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
      const res = await fetchWithTimeout(
        EXPO_PUSH_URL,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(chunk.map((p) => p.message)),
        },
        EXPO_TIMEOUT_MS,
      );
      if (!res.ok) throw new Error(`expo push HTTP ${res.status}`);
      tickets = (await res.json()).data ?? [];
    } catch (e) {
      // Whole-batch transport failure (timeout included): rows stay unsent
      // (attempts already bumped by the claim) and are retried by the sweep
      // once their 60 s lease runs out, up to the cap.
      const msg = errorMessage(e);
      failed += chunk.length;
      const ids = chunk.map((p) => p.row.id);
      const { error } = await db.from('notification_outbox').update({ last_error: msg }).in('id', ids);
      if (error) logError('send-push', error, `transport-failure stamp failed for outbox ${ids.join(',')}`);
      continue;
    }

    for (let j = 0; j < chunk.length; j++) {
      const { row } = chunk[j]!;
      const ticket = tickets[j];
      if (ticket?.status === 'ok') {
        sent++;
        const { error } = await db
          .from('notification_outbox')
          .update({ sent_at: new Date().toISOString(), last_error: null })
          .eq('id', row.id);
        if (error) {
          // Expo accepted it, but the row still reads unsent: the next sweep after
          // its lease sends it AGAIN. Loud, with the id, so it can be stamped by hand.
          logError('send-push', error, `DUPLICATE RISK: outbox ${row.id} was accepted by Expo but its sent_at stamp failed`);
        }
      } else {
        failed++;
        const detail = ticket?.details?.error ?? ticket?.message ?? 'unknown expo ticket error';
        await stamp(row.id, { last_error: detail });
        if (ticket?.details?.error === 'DeviceNotRegistered') {
          // Dead token: stop enqueueing for this profile until the app re-registers.
          const { error } = await db.from('profiles').update({ expo_push_token: null }).eq('id', row.profile_id);
          if (error) logError('send-push', error, `dead token not cleared for profile ${row.profile_id} (outbox ${row.id})`);
        }
      }
    }
  }

  return json({ claimed: rows.length, sent, failed });
}));

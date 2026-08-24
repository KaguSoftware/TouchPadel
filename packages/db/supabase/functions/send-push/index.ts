/**
 * send-push — outbox sender for Expo push notifications.
 *
 * Invoked by Supabase cron every minute (service-role Authorization header; see
 * packages/db/README.md "Edge functions"). Flow:
 *   1. app.claim_due_notifications(limit) — due, unsent, attempts < 5,
 *      SKIP LOCKED; claiming increments `attempts` (migration 0024).
 *   2. Resolve each row's CURRENT expo_push_token + preferred_lang from
 *      profiles (tokens rot, language is a live preference) and court names.
 *   3. Batch to https://exp.host/--/api/v2/push/send (max 100/request).
 *   4. Per-ticket: ok -> sent_at; error -> last_error (row retries on the next
 *      cron run until the attempts cap of 5); DeviceNotRegistered also clears
 *      the profile's token so future bookings stop enqueueing.
 */
import { createServiceClient, isServiceRoleRequest } from '../_shared/supabase.ts';
import { json } from '../_shared/http.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100;
const CLAIM_LIMIT = 100;
const RETRY_CAP = 5; // mirrors the attempts < 5 filter in app.claim_due_notifications

type Lang = 'en' | 'ar';

// Notification copy, EN/AR. SOURCE OF TRUTH: packages/i18n (@touch/i18n) —
// edge functions bundle standalone, so the few push strings are duplicated
// here; keep in sync with the `push.*` keys there when they change.
const STRINGS: Record<Lang, Record<string, { title: string; body: (court: string, when: string) => string }>> = {
  en: {
    booking_confirmed: {
      title: 'Booking confirmed',
      body: (court, when) => `${court} — ${when}. See you on court!`,
    },
    booking_reminder: {
      title: 'Your game is in 3 hours',
      body: (court, when) => `${court} at ${when}.`,
    },
    booking_cancelled: {
      title: 'Booking cancelled',
      body: (court, when) => `${court} — ${when} was cancelled.`,
    },
  },
  ar: {
    booking_confirmed: {
      title: 'تم تأكيد الحجز',
      body: (court, when) => `${court} — ${when}. نراك في الملعب!`,
    },
    booking_reminder: {
      title: 'مباراتك بعد ٣ ساعات',
      body: (court, when) => `${court} الساعة ${when}.`,
    },
    booking_cancelled: {
      title: 'تم إلغاء الحجز',
      body: (court, when) => `${court} — ${when} تم إلغاؤه.`,
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
  kind: 'booking_confirmed' | 'booking_reminder' | 'booking_cancelled';
  payload: {
    reservation_id: string;
    court_id: string;
    start_at: string;
    end_at: string;
    price_iqd: number | null;
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
  const courtIds = [...new Set(rows.map((r) => r.payload.court_id).filter(Boolean))];
  const [profilesRes, courtsRes] = await Promise.all([
    db.from('profiles').select('id, expo_push_token, preferred_lang').in('id', profileIds),
    db.from('courts').select('id, name_en, name_ar').in('id', courtIds),
  ]);
  if (profilesRes.error) return json({ error: profilesRes.error.message }, 500);
  if (courtsRes.error) return json({ error: courtsRes.error.message }, 500);
  const profiles = new Map(profilesRes.data.map((p) => [p.id, p]));
  const courts = new Map(courtsRes.data.map((c) => [c.id, c]));

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
    const court = courts.get(row.payload.court_id);
    const courtName = (lang === 'ar' ? court?.name_ar : court?.name_en) ?? 'Padel';
    const s = STRINGS[lang][row.kind];
    prepared.push({
      row,
      message: {
        to: token,
        title: s.title,
        body: s.body(courtName, formatWhen(row.payload.start_at, lang)),
        sound: 'default',
        data: { kind: row.kind, reservation_id: row.payload.reservation_id },
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
      });
      if (!res.ok) throw new Error(`expo push HTTP ${res.status}`);
      tickets = (await res.json()).data ?? [];
    } catch (e) {
      // Whole-batch transport failure: rows stay unsent (attempts already
      // bumped by the claim) and retry next minute up to the cap.
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

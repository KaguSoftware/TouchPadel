/**
 * telegram-send — outbox sender for the Telegram staff group (migration 0032).
 *
 * Invoked by app.telegram_nudge (pg_net, right after an enqueue) and by the
 * pg_cron sweep `tp_telegram_sweep` — always with the service-role key. Flow:
 *   1. app.claim_due_telegram(50): queued, attempts < 8, due, SKIP LOCKED;
 *      the claim bumps `attempts` up front and pushes scheduled_for out by
 *      30 s × 2^attempts (0035), the lease an overlapping sweep respects.
 *   2. Render each row from its payload SNAPSHOT (never re-reads live rows) in
 *      the language from its branch's `cafe_settings.telegram_lang` (per branch
 *      since 0209; payload wins if it ever carries `lang`), then Bot API
 *      `sendMessage` (HTML + inline keyboard).
 *   3. Stamp the row:
 *        ok            -> status 'sent', sent_at, telegram_message_id, text,
 *                         reply_markup (the callback needs both for editMessageText)
 *        429           -> stay 'queued', scheduled_for = now + retry_after
 *        network / 5xx -> stay 'queued', last_error, backoff min(5s * 2^attempts, 5min)
 *        400 + migrate_to_chat_id -> the group became a supergroup: follow it once
 *                         (row chat_id, and the row's branch's cafe_settings.telegram_chat_id
 *                         when it still holds the old id, so taps keep passing 0039's
 *                         chat check),
 *                         then resend in the same pass
 *        other 4xx     -> 'failed' (bad token / chat not found / parse error: retrying
 *                         cannot help; the owner re-queues via app.retry_telegram_outbox)
 *        attempts >= 8 -> 'failed' whatever the error
 *      No TELEGRAM_BOT_TOKEN -> rows are claimed and marked 'skipped'
 *      (NOT_CONFIGURED) so the queue does not grow forever.
 * Sends are sequential (group limit ~20 msg/min; bursts are tiny). Each Bot API
 * call times out (_shared/telegramApi.ts) and the whole batch stops sending at
 * SEND_BUDGET_MS, well inside the first 30 s lease: rows not reached stay
 * queued and are claimed again once their lease runs out. The handler never
 * throws: any unexpected error answers 200 `{ ok: false, error: 'INTERNAL' }`
 * (the real message is logged) so the pg_net caller does not log noise.
 */
import { createServiceClient, isServiceRoleRequest } from '../_shared/supabase.ts';
import { errorMessage, handle, json, logError } from '../_shared/http.ts';
import { keyboardByKind, renderByKind, type Lang } from '../_shared/telegram.ts';
import { scrubToken, tg, TELEGRAM_TIMEOUT_MS } from '../_shared/telegramApi.ts';
import { migrateToChatId } from '../_shared/telegramDiagnose.ts';

const CLAIM_LIMIT = 50;
const RETRY_CAP = 8; // mirrors attempts < 8 in app.claim_due_telegram
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;
/**
 * No Bot API call starts after this much of the invocation, and none runs past
 * it: the first claim lease is 30 s (0035), and a send still in flight when an
 * overlapping sweep re-claims its row is a duplicate message in the group.
 */
const SEND_BUDGET_MS = 20_000;
/** Below this much budget left, a call is not started (it could not finish usefully). */
const MIN_CALL_MS = 1_000;

interface OutboxRow {
  id: number;
  kind: 'order_new' | 'waiter_call' | 'test';
  ref_id: string | null;
  chat_id: string;
  payload: Record<string, unknown>;
  attempts: number;
  /** 0126: the branch the alert belongs to; its group and language are per branch (0209, 0212). */
  venue_id: string;
}

type SendOutcome =
  | { kind: 'ok'; messageId: number | null }
  | { kind: 'migrated'; newChatId: string; description: string }
  | { kind: 'rate_limited'; retryAfterSec: number; description: string }
  | { kind: 'transient'; description: string }
  | { kind: 'permanent'; description: string };

async function sendMessage(token: string, body: Record<string, unknown>, timeoutMs: number): Promise<SendOutcome> {
  const r = await tg<{ message_id?: number }>(token, 'sendMessage', body, timeoutMs);
  if (r.transport) return { kind: 'transient', description: r.transport };
  if (r.ok) return { kind: 'ok', messageId: r.result?.message_id ?? null };
  const code = r.error_code ?? r.http_status ?? 0;
  const description = scrubToken(`HTTP ${code}: ${r.description ?? 'unknown'}`, token);
  const newChatId = migrateToChatId(r);
  if (newChatId) return { kind: 'migrated', newChatId, description };
  if (code === 429) {
    return { kind: 'rate_limited', retryAfterSec: r.parameters?.retry_after ?? 5, description };
  }
  if (code >= 500 || code === 0) return { kind: 'transient', description };
  return { kind: 'permanent', description };
}

function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts), BACKOFF_MAX_MS);
}

const failedRun = () => json({ ok: false, error: 'INTERNAL', claimed: 0, sent: 0, failed: 0, skipped: 0 });

Deno.serve(handle('telegram-send', async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!isServiceRoleRequest(req)) return json({ error: 'forbidden' }, 403);

  const started = Date.now();
  const db = createServiceClient();
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim() ?? '';

  const { data: claimed, error: claimErr } = await db
    .schema('app')
    .rpc('claim_due_telegram', { p_limit: CLAIM_LIMIT });
  if (claimErr) {
    logError('telegram-send', claimErr, 'claim_due_telegram failed');
    return failedRun();
  }
  const rows = (claimed ?? []) as OutboxRow[];

  if (!token) {
    if (rows.length) {
      const { error } = await db
        .from('telegram_outbox')
        .update({ status: 'skipped', last_error: 'NOT_CONFIGURED' })
        .in('id', rows.map((r) => r.id));
      if (error) logError('telegram-send', error, 'skip stamp failed for', rows.map((r) => r.id));
    }
    return json({ configured: false, claimed: rows.length, sent: 0, failed: 0, skipped: rows.length });
  }
  if (rows.length === 0) return json({ configured: true, claimed: 0, sent: 0, failed: 0, skipped: 0 });

  // Language: payload wins if present (not today, per 0032), else one settings read.
  // telegram_lang per branch (0209): one read for every branch in this batch.
  const langByVenue = new Map<string, Lang>();
  const needsSetting = rows.some((r) => !(r.payload?.lang === 'ar' || r.payload?.lang === 'en'));
  if (needsSetting) {
    const { data: s, error: langErr } = await db.from('cafe_settings').select('venue_id, value').eq('key', 'telegram_lang');
    // A failed read is not fatal: every row then renders in the default language.
    if (langErr) logError('telegram-send', langErr, 'telegram_lang read failed; rendering in ar');
    for (const r of (s ?? []) as { venue_id: string; value: unknown }[]) {
      langByVenue.set(r.venue_id, r.value === 'en' ? 'en' : 'ar');
    }
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  /** Budget left for the next Bot API call, or 0 when none may start. */
  const callBudget = () => {
    const left = SEND_BUDGET_MS - (Date.now() - started);
    return left < MIN_CALL_MS ? 0 : Math.min(TELEGRAM_TIMEOUT_MS, left);
  };

  for (const row of rows) {
    const lang: Lang = row.payload?.lang === 'en' ? 'en' : row.payload?.lang === 'ar' ? 'ar' : (langByVenue.get(row.venue_id) ?? 'ar');

    let text: string;
    let replyMarkup: unknown;
    try {
      text = renderByKind(row.kind, row.payload, lang);
      replyMarkup = keyboardByKind(row.kind, row.ref_id);
    } catch (e) {
      // A snapshot we cannot render will never render: fail it, keep the reason.
      failed++;
      const { error } = await db
        .from('telegram_outbox')
        .update({ status: 'failed', last_error: `RENDER: ${errorMessage(e)}` })
        .eq('id', row.id);
      if (error) logError('telegram-send', error, `RENDER stamp failed for outbox ${row.id}`);
      continue;
    }

    const budget = callBudget();
    if (!budget) {
      // Out of time under the lease: leave it queued; it is claimed again after its lease.
      skipped++;
      continue;
    }

    const body: Record<string, unknown> = {
      chat_id: row.chat_id,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (replyMarkup) body.reply_markup = replyMarkup;

    let outcome = await sendMessage(token, body, budget);
    if (outcome.kind === 'migrated') {
      const newChatId = outcome.newChatId;
      console.warn(`outbox ${row.id}: chat ${row.chat_id} migrated to ${newChatId}`);
      // Only move the setting if nobody has changed it since this row was enqueued.
      const { data: current, error: readErr } = await db
        .from('cafe_settings')
        .select('value')
        .eq('key', 'telegram_chat_id')
        .eq('venue_id', row.venue_id)
        .maybeSingle();
      if (readErr) logError('telegram-send', readErr, `telegram_chat_id read failed for outbox ${row.id}`);
      if (current?.value === row.chat_id) {
        const { error: settingErr } = await db
          .from('cafe_settings')
          .update({ value: newChatId, updated_at: new Date().toISOString() })
          .eq('key', 'telegram_chat_id')
          .eq('venue_id', row.venue_id);
        if (settingErr) logError('telegram-send', settingErr, 'telegram_chat_id follow failed');
      }
      const { error: chatErr } = await db.from('telegram_outbox').update({ chat_id: newChatId }).eq('id', row.id);
      if (chatErr) logError('telegram-send', chatErr, `chat_id follow failed for outbox ${row.id}`);
      body.chat_id = newChatId;
      const retryBudget = callBudget();
      outcome = retryBudget
        ? await sendMessage(token, body, retryBudget)
        : { kind: 'transient', description: 'migrated; resend left for the next sweep (send budget used up)' };
      // A second migration answer cannot be followed again in this pass.
      if (outcome.kind === 'migrated') outcome = { kind: 'permanent', description: outcome.description };
    }
    const exhausted = row.attempts >= RETRY_CAP; // attempts already bumped by the claim
    let patch: Record<string, unknown>;

    switch (outcome.kind) {
      case 'ok':
        sent++;
        patch = {
          status: 'sent',
          sent_at: new Date().toISOString(),
          telegram_message_id: outcome.messageId,
          text,
          reply_markup: replyMarkup ?? null,
          last_error: null,
        };
        break;
      case 'rate_limited':
        if (exhausted) {
          failed++;
          patch = { status: 'failed', last_error: outcome.description };
        } else {
          skipped++;
          patch = {
            last_error: outcome.description,
            scheduled_for: new Date(Date.now() + outcome.retryAfterSec * 1000).toISOString(),
          };
        }
        break;
      case 'transient':
        if (exhausted) {
          failed++;
          patch = { status: 'failed', last_error: outcome.description };
        } else {
          skipped++;
          patch = {
            last_error: outcome.description,
            scheduled_for: new Date(Date.now() + backoffMs(row.attempts)).toISOString(),
          };
        }
        break;
      case 'permanent':
      default:
        failed++;
        patch = { status: 'failed', last_error: outcome.description };
        break;
    }

    const { error: stampErr } = await db.from('telegram_outbox').update(patch).eq('id', row.id);
    if (stampErr) {
      if (outcome.kind === 'ok') {
        // The message IS in the group but the row still reads 'queued': the next
        // claim after its lease sends it again. Loud, with the id, so it can be stamped by hand.
        logError(
          'telegram-send',
          stampErr,
          `DUPLICATE RISK: outbox ${row.id} was delivered (telegram_message_id ${outcome.messageId ?? '?'}) but its 'sent' stamp failed`,
        );
      } else {
        logError('telegram-send', stampErr, `outbox stamp failed for ${row.id}`);
      }
    }
  }

  return json({ configured: true, claimed: rows.length, sent, failed, skipped });
}, failedRun));

/**
 * telegram-callback — Bot API webhook for inline-button taps (migration 0032).
 *
 * `verify_jwt = false` (config.toml): Telegram carries no Supabase JWT. Auth is
 * the `X-Telegram-Bot-Api-Secret-Token` header, which must equal
 * TELEGRAM_WEBHOOK_SECRET (unset secret => every request is 401: fail closed).
 *
 * Flow per update:
 *   - not a callback_query           -> 200 {ok:true} (ignored; allowed_updates
 *                                       is set to callback_query only anyway)
 *   - callback_data off-contract     -> answerCallbackQuery 'غير معروف', 200
 *   - app.telegram_apply_action(action, ref_id, {tg_user_id, first_name, username},
 *     chat_id) with the service client (idempotent: a double tap yields
 *     'duplicate'). Since 0039 the RPC refuses a tap from a chat other than the
 *     configured group, or from a tg_user_id absent from telegram_staff, and
 *     o:void additionally requires that row to carry can_void — those come back
 *     as result 'refused', not as an error.
 *   - answerCallbackQuery(toastFor(result))
 *   - keyboard !== 'unchanged'       -> editMessageText(original outbox text +
 *                                       "\n\n" + status footer, reduced keyboard);
 *                                       if that fails, editMessageReplyMarkup only
 *   - stamp cafe_settings.telegram_last_callback_at (direct write, service role)
 * ANY internal error still answers HTTP 200 {ok:false}: a non-2xx makes Telegram
 * redeliver the update forever.
 */
import { createServiceClient } from '../_shared/supabase.ts';
import { json } from '../_shared/http.ts';
import {
  fmtTime,
  keyboardAfter,
  parseCallbackData,
  statusFooter,
  toastFor,
  TOAST_UNKNOWN,
} from '../_shared/telegram.ts';

interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}
interface CallbackQuery {
  id: string;
  from: TgUser;
  message?: { message_id: number; chat: { id: number | string } };
  data?: string;
}
interface Update {
  update_id?: number;
  callback_query?: CallbackQuery;
}
interface ApplyResult {
  result: 'applied' | 'duplicate' | 'invalid' | 'not_found' | 'refused';
  status: string | null;
  keyboard: 'unchanged' | 'order_seen' | 'order_final' | 'call_acked' | 'call_final';
  actor_label: string | null;
}

async function tg(token: string, method: string, body: Record<string, unknown>): Promise<{ ok: boolean; description?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    return { ok: !!data.ok, description: data.description };
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : String(e) };
  }
}

function secretMatches(req: Request): boolean {
  const expected = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '';
  const got = req.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
  if (!expected || got.length !== expected.length) return false;
  // Constant-time compare (lengths already equal).
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!secretMatches(req)) return json({ error: 'unauthorized' }, 401);

  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim() ?? '';

  let update: Update;
  try {
    update = (await req.json()) as Update;
  } catch {
    return json({ ok: true, ignored: 'invalid JSON' });
  }
  const cq = update?.callback_query;
  if (!cq || typeof cq.id !== 'string') return json({ ok: true });

  const answer = (text: string) => (token ? tg(token, 'answerCallbackQuery', { callback_query_id: cq.id, text }) : Promise.resolve({ ok: false }));

  const parsed = parseCallbackData(cq.data);
  if (!parsed) {
    await answer(TOAST_UNKNOWN);
    return json({ ok: true, ignored: 'unknown callback_data' });
  }
  const kind = parsed.action.startsWith('o:') ? 'order_new' : 'waiter_call';

  try {
    const db = createServiceClient();

    const { data, error } = await db.schema('app').rpc('telegram_apply_action', {
      p_action: parsed.action,
      p_ref_id: parsed.refId,
      p_actor: {
        tg_user_id: cq.from?.id,
        first_name: cq.from?.first_name ?? null,
        username: cq.from?.username ?? null,
      },
      // 0039: the webhook secret authenticates TELEGRAM, not the person who
      // tapped. The chat the tap came from, plus the telegram_staff allowlist,
      // is what authorizes the action — and the DB check is the authority, so
      // we only forward the claim here.
      p_chat_id: cq.message?.chat?.id != null ? String(cq.message.chat.id) : null,
    });
    if (error) {
      console.error('telegram_apply_action failed:', error.message, error.details ?? '');
      await answer(toastFor('invalid'));
      return json({ ok: false, error: error.message });
    }
    const applied = data as ApplyResult;

    await answer(toastFor(applied.result));

    if (applied.keyboard !== 'unchanged' && cq.message) {
      const chatId = cq.message.chat.id;
      const messageId = cq.message.message_id;
      const keyboard = keyboardAfter(kind, applied.keyboard, parsed.refId);
      const replyMarkup = keyboard ?? { inline_keyboard: [] };
      const footer = statusFooter(parsed.action, applied.actor_label ?? cq.from?.first_name ?? 'Telegram', fmtTime(new Date()));

      const { data: row } = await db
        .from('telegram_outbox')
        .select('text')
        .eq('kind', kind)
        .eq('ref_id', parsed.refId)
        .maybeSingle();

      let edited = { ok: false as boolean, description: 'no stored text' as string | undefined };
      if (row?.text) {
        edited = await tg(token, 'editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: `${row.text}\n\n${footer}`,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: replyMarkup,
        });
      }
      if (!edited.ok) {
        // "message is not modified" or missing text: at least reduce the buttons.
        const fallback = await tg(token, 'editMessageReplyMarkup', {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: replyMarkup,
        });
        if (!fallback.ok) console.error('edit failed:', edited.description, '/', fallback.description);
      }
    }

    const { error: stampErr } = await db.from('cafe_settings').upsert(
      { key: 'telegram_last_callback_at', value: new Date().toISOString(), is_public: false, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
    if (stampErr) console.error('telegram_last_callback_at stamp failed:', stampErr.message);

    return json({ ok: true, result: applied.result, keyboard: applied.keyboard });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('telegram-callback:', msg);
    return json({ ok: false, error: msg });
  }
});

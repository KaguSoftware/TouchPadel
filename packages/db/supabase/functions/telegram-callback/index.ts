/**
 * telegram-callback — Bot API webhook for inline-button taps (migration 0032).
 *
 * `verify_jwt = false` (config.toml): Telegram carries no Supabase JWT. Auth is
 * the `X-Telegram-Bot-Api-Secret-Token` header, which must equal
 * TELEGRAM_WEBHOOK_SECRET (unset secret => every request is 401: fail closed).
 *
 * Flow per update:
 *   - my_chat_member (0091)          -> upsert telegram_chats {chat_id, title, type,
 *                                       bot_status} for groups/supergroups, 200. This
 *                                       is how the operator's "Detected groups" list
 *                                       learns the group id (getUpdates is dead once a
 *                                       webhook exists). Needs allowed_updates to carry
 *                                       my_chat_member — telegram-diagnose registers it.
 *   - message.migrate_to_chat_id     -> the group became a supergroup: move the
 *                                       telegram_chats row and, if it still holds the
 *                                       old id, cafe_settings.telegram_chat_id, 200
 *   - anything else not a callback_query -> 200 {ok:true} (ignored)
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
interface TgChat {
  id: number | string;
  title?: string;
  type?: string;
}
interface ChatMemberUpdated {
  chat: TgChat;
  new_chat_member?: { status?: string };
}
interface Update {
  update_id?: number;
  callback_query?: CallbackQuery;
  my_chat_member?: ChatMemberUpdated;
  message?: { chat: TgChat; migrate_to_chat_id?: number | string };
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

const GROUP_TYPES = new Set(['group', 'supergroup']);

/** my_chat_member → telegram_chats (0091). Groups only: a private chat with the bot is not a staff group. */
async function recordChatMember(m: ChatMemberUpdated): Promise<Response> {
  if (!m.chat || !GROUP_TYPES.has(m.chat.type ?? '')) return json({ ok: true, ignored: 'not a group' });
  try {
    const db = createServiceClient();
    const { error } = await db.from('telegram_chats').upsert(
      {
        chat_id: String(m.chat.id),
        title: m.chat.title ?? null,
        type: m.chat.type,
        bot_status: m.new_chat_member?.status ?? 'unknown',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'chat_id' },
    );
    if (error) console.error('telegram_chats upsert failed:', error.message);
    return json({ ok: !error });
  } catch (e) {
    console.error('telegram-callback my_chat_member:', e instanceof Error ? e.message : String(e));
    return json({ ok: false });
  }
}

/** A basic group upgraded to a supergroup: its id changed. Follow it. */
async function recordMigration(oldId: string, newId: string): Promise<Response> {
  try {
    const db = createServiceClient();
    const { data: prev } = await db.from('telegram_chats').select('title, bot_status').eq('chat_id', oldId).maybeSingle();
    await db.from('telegram_chats').upsert(
      {
        chat_id: newId,
        title: prev?.title ?? null,
        type: 'supergroup',
        bot_status: prev?.bot_status ?? 'member',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'chat_id' },
    );
    await db.from('telegram_chats').delete().eq('chat_id', oldId);
    const { data: current } = await db.from('cafe_settings').select('value').eq('key', 'telegram_chat_id').maybeSingle();
    if (current?.value === oldId) {
      const { error } = await db
        .from('cafe_settings')
        .update({ value: newId, updated_at: new Date().toISOString() })
        .eq('key', 'telegram_chat_id');
      if (error) console.error('telegram_chat_id follow failed:', error.message);
    }
    return json({ ok: true, migrated: newId });
  } catch (e) {
    console.error('telegram-callback migrate:', e instanceof Error ? e.message : String(e));
    return json({ ok: false });
  }
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
  if (update?.my_chat_member) return recordChatMember(update.my_chat_member);
  const migratedTo = update?.message?.migrate_to_chat_id;
  if (migratedTo !== undefined && migratedTo !== null && update.message) {
    return recordMigration(String(update.message.chat.id), String(migratedTo));
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

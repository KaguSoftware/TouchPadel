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
 *                                       telegram_chats row and every branch's
 *                                       cafe_settings.telegram_chat_id that still holds
 *                                       the old id (per branch since 0209), 200
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
 *   - stamp cafe_settings.telegram_last_callback_at on every branch whose group
 *     this chat is (direct write, service role; per branch since 0209)
 * ANY internal error still answers HTTP 200 {ok:false, error:'INTERNAL'} (the
 * real message is logged): a non-2xx makes Telegram redeliver the update forever.
 * Bodies over 64 KB are ignored the same way (an update is a few KB at most).
 */
import { createServiceClient } from '../_shared/supabase.ts';
import { constantTimeEqual, handle, json, KB, logError, readJsonBody } from '../_shared/http.ts';
import {
  fmtTime,
  keyboardAfter,
  parseCallbackData,
  statusFooter,
  toastFor,
  TOAST_UNKNOWN,
} from '../_shared/telegram.ts';
import { tg } from '../_shared/telegramApi.ts';

const MAX_BODY = 64 * KB;

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

/** Every branch whose Telegram group (cafe_settings.telegram_chat_id, per branch since 0209) is this chat. */
async function venuesWithChat(db: ReturnType<typeof createServiceClient>, chatId: string): Promise<string[]> {
  if (!chatId) return [];
  const { data, error } = await db.from('cafe_settings').select('venue_id, value').eq('key', 'telegram_chat_id');
  if (error) logError('telegram-callback', error, 'telegram_chat_id read failed');
  return ((data ?? []) as { venue_id: string; value: unknown }[])
    .filter((r) => r.value === chatId)
    .map((r) => r.venue_id);
}

function secretMatches(req: Request): boolean {
  const expected = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '';
  const got = req.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
  return expected !== '' && constantTimeEqual(expected, got);
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
    if (error) logError('telegram-callback', error, 'telegram_chats upsert failed');
    return json({ ok: !error });
  } catch (e) {
    logError('telegram-callback', e, 'my_chat_member');
    return json({ ok: false });
  }
}

/** A basic group upgraded to a supergroup: its id changed. Follow it. */
async function recordMigration(oldId: string, newId: string): Promise<Response> {
  try {
    const db = createServiceClient();
    const { data: prev, error: prevErr } = await db.from('telegram_chats').select('title, bot_status').eq('chat_id', oldId).maybeSingle();
    if (prevErr) logError('telegram-callback', prevErr, `telegram_chats read failed for ${oldId}`);
    const up = await db.from('telegram_chats').upsert(
      {
        chat_id: newId,
        title: prev?.title ?? null,
        type: 'supergroup',
        bot_status: prev?.bot_status ?? 'member',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'chat_id' },
    );
    if (up.error) logError('telegram-callback', up.error, `telegram_chats upsert failed for ${newId}`);
    // Drop the old row only once the new one is in, so the group never vanishes from the list.
    if (!up.error) {
      const del = await db.from('telegram_chats').delete().eq('chat_id', oldId);
      if (del.error) logError('telegram-callback', del.error, `telegram_chats delete failed for ${oldId}`);
    }
    let ok = !up.error;
    for (const venueId of await venuesWithChat(db, oldId)) {
      const { error } = await db
        .from('cafe_settings')
        .update({ value: newId, updated_at: new Date().toISOString() })
        .eq('key', 'telegram_chat_id')
        .eq('venue_id', venueId);
      if (error) {
        ok = false;
        logError('telegram-callback', error, 'telegram_chat_id follow failed');
      }
    }
    return json(ok ? { ok: true, migrated: newId } : { ok: false, migrated: newId });
  } catch (e) {
    logError('telegram-callback', e, 'migrate');
    return json({ ok: false });
  }
}

Deno.serve(handle('telegram-callback', async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!secretMatches(req)) return json({ error: 'unauthorized' }, 401);

  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim() ?? '';

  const read = await readJsonBody<Update>(req, {
    maxBytes: MAX_BODY,
    badJson: () => json({ ok: true, ignored: 'invalid JSON' }),
    tooLarge: () => json({ ok: true, ignored: 'too large' }),
  });
  if (!read.ok) return read.response;
  const update = read.value;
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
    logError('telegram-callback', error, 'telegram_apply_action failed');
    await answer(toastFor('invalid'));
    return json({ ok: false, error: 'INTERNAL' });
  }
  const applied = data as ApplyResult;

  await answer(toastFor(applied.result));

  if (applied.keyboard !== 'unchanged' && cq.message) {
    const chatId = cq.message.chat.id;
    const messageId = cq.message.message_id;
    const keyboard = keyboardAfter(kind, applied.keyboard, parsed.refId);
    const replyMarkup = keyboard ?? { inline_keyboard: [] };
    const footer = statusFooter(parsed.action, applied.actor_label ?? cq.from?.first_name ?? 'Telegram', fmtTime(new Date()));

    const { data: row, error: rowErr } = await db
      .from('telegram_outbox')
      .select('text')
      .eq('kind', kind)
      .eq('ref_id', parsed.refId)
      .maybeSingle();
    if (rowErr) logError('telegram-callback', rowErr, `outbox text read failed for ${kind} ${parsed.refId}`);

    let edited: { ok: boolean; description?: string; transport?: string } = { ok: false, description: 'no stored text' };
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
      if (!fallback.ok) {
        console.error('edit failed:', edited.transport ?? edited.description, '/', fallback.transport ?? fallback.description);
      }
    }
  }

  const stampedAt = new Date().toISOString();
  const stampVenues = await venuesWithChat(db, String(cq.message?.chat?.id ?? ''));
  if (stampVenues.length > 0) {
    const { error: stampErr } = await db.from('cafe_settings').upsert(
      stampVenues.map((venue_id) => ({
        venue_id,
        key: 'telegram_last_callback_at',
        value: stampedAt,
        is_public: false,
        updated_at: stampedAt,
      })),
      { onConflict: 'venue_id,key' },
    );
    if (stampErr) logError('telegram-callback', stampErr, 'telegram_last_callback_at stamp failed');
  }

  return json({ ok: true, result: applied.result, keyboard: applied.keyboard });
}, () => json({ ok: false, error: 'INTERNAL' })));

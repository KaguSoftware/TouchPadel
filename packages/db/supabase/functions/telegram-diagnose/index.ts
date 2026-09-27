/**
 * telegram-diagnose — owner-only health check for the Telegram staff group.
 *
 * The bot token lives only in this project's function secrets, so the Bot API
 * questions ("is this token a bot?", "can it see this chat?", "is the webhook
 * ours?") can only be asked from here. The operator's Settings → Telegram
 * screen calls it; the interpretation is pure (`_shared/telegramDiagnose.ts`).
 *
 *   POST {action:'diagnose'}
 *     200 {checks: DiagnoseCheck[], bot: {username}|null, webhookUrl}
 *     Ordered: token, bot, settings, chat, membership, webhook, outbox,
 *     allowlist. A check that cannot run after an earlier failure is 'skip'.
 *     The token and the webhook secret are never echoed.
 *   POST {action:'register_webhook'}
 *     200 {ok:true, url} | 502 {error:'UPSTREAM', message}
 *     setWebhook → .../functions/v1/telegram-callback with
 *     TELEGRAM_WEBHOOK_SECRET and allowed_updates [callback_query, my_chat_member]
 *     (the second lets telegram-callback record the groups the bot is in).
 *
 * Missing TELEGRAM_BOT_TOKEN: diagnose still answers 200 (the token check says
 * so); register_webhook answers 503 {error:'NOT_CONFIGURED'} (edge.ts contract).
 * verify_jwt = true (config.toml); the body re-checks the owner staff row.
 */
import { createServiceClient } from '../_shared/supabase.ts';
import { json } from '../_shared/http.ts';
import { requireStaffRole } from '../_shared/auth.ts';
import {
  checkAllowlist,
  checkBot,
  checkChat,
  checkMembership,
  checkOutbox,
  checkSettings,
  checkToken,
  checkWebhook,
  skipped,
  webhookUrl,
  WEBHOOK_ALLOWED_UPDATES,
  type DiagnoseCheck,
  type TgBot,
  type TgChat,
  type TgChatMember,
  type TgResult,
  type TgWebhookInfo,
} from '../_shared/telegramDiagnose.ts';

async function tg<T>(token: string, method: string, body: Record<string, unknown> = {}): Promise<TgResult<T>> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => null)) as TgResult<T> | null;
    if (!data) return { ok: false, error_code: res.status, description: res.statusText };
    return data;
  } catch (e) {
    return { ok: false, transport: `fetch: ${e instanceof Error ? e.message : String(e)}` };
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const service = createServiceClient();
  const caller = await requireStaffRole(req, service, ['owner']);
  if (caller instanceof Response) return caller;

  let body: { action?: unknown; venue_id?: unknown } = {};
  try {
    body = (await req.json()) as { action?: unknown; venue_id?: unknown };
  } catch {
    // An empty body is a plain diagnose.
  }

  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim() ?? '';
  const callbackUrl = webhookUrl(Deno.env.get('SUPABASE_URL') ?? '');

  if (body.action === 'register_webhook') {
    const secret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')?.trim() ?? '';
    if (!token || !secret) {
      return json({ error: 'NOT_CONFIGURED', code: 'NOT_CONFIGURED', message: 'TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET not set' }, 503);
    }
    const res = await tg<boolean>(token, 'setWebhook', {
      url: callbackUrl,
      secret_token: secret,
      allowed_updates: WEBHOOK_ALLOWED_UPDATES,
    });
    if (!res.ok) {
      return json({ error: 'UPSTREAM', message: res.transport ?? `HTTP ${res.error_code}: ${res.description}` }, 502);
    }
    return json({ ok: true, url: callbackUrl });
  }

  if (body.action !== undefined && body.action !== 'diagnose') {
    return json({ error: 'BAD_REQUEST', message: "action must be 'diagnose' or 'register_webhook'" }, 400);
  }

  const checks: DiagnoseCheck[] = [];

  // The branch to diagnose (0212, MV3: one Telegram group per branch): the body's
  // venue_id, else the oldest active branch.
  if (
    body.venue_id != null &&
    (typeof body.venue_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.venue_id))
  ) {
    return json({ error: 'BAD_REQUEST', message: 'venue_id must be a uuid' }, 400);
  }
  let venueId = typeof body.venue_id === 'string' && body.venue_id ? body.venue_id : null;
  if (!venueId) {
    const { data: v } = await service
      .from('venues')
      .select('id')
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    venueId = (v as { id?: string } | null)?.id ?? null;
  }

  // DB facts first — they do not depend on the token.
  const [settingsQ, outboxQ, allowQ] = await Promise.all([
    service
      .from('cafe_settings')
      .select('key, value')
      .eq('venue_id', venueId ?? '00000000-0000-0000-0000-000000000000')
      .in('key', ['telegram_enabled', 'telegram_chat_id']),
    service
      .from('telegram_outbox')
      .select('chat_id, status, last_error')
      .eq('venue_id', venueId ?? '00000000-0000-0000-0000-000000000000')
      .order('id', { ascending: false })
      .limit(20),
    service.from('telegram_staff').select('is_active, staff:staff_id(is_active)'),
  ]);
  if (settingsQ.error || outboxQ.error || allowQ.error) {
    const msg = settingsQ.error?.message ?? outboxQ.error?.message ?? allowQ.error?.message;
    console.error('telegram-diagnose read failed:', msg);
    return json({ error: 'INTERNAL', message: msg }, 500);
  }
  const settings = new Map((settingsQ.data ?? []).map((r) => [r.key as string, r.value as unknown]));
  const enabled = settings.get('telegram_enabled') === true;
  const rawChat = settings.get('telegram_chat_id');
  const chatId = typeof rawChat === 'string' && rawChat.trim() ? rawChat.trim() : null;

  const tokenCheck = checkToken(token);
  checks.push(tokenCheck);

  let bot: TgBot | null = null;
  if (tokenCheck.status === 'ok') {
    const me = await tg<TgBot>(token, 'getMe');
    const botCheck = checkBot(me);
    checks.push(botCheck);
    if (botCheck.status === 'ok' && me.result) bot = me.result;
  } else {
    checks.push(skipped('bot'));
  }

  const settingsCheck = checkSettings(enabled, chatId);
  checks.push(settingsCheck);

  // A placeholder id is still asked about: Telegram's answer is the proof.
  if (bot && chatId) {
    const chat = await tg<TgChat>(token, 'getChat', { chat_id: chatId });
    const chatCheck = checkChat(chat);
    checks.push(chatCheck);
    if (chatCheck.status === 'ok') {
      checks.push(checkMembership(await tg<TgChatMember>(token, 'getChatMember', { chat_id: chatId, user_id: bot.id })));
    } else {
      checks.push(skipped('membership'));
    }
  } else {
    checks.push(skipped('chat'), skipped('membership'));
  }

  checks.push(bot ? checkWebhook(await tg<TgWebhookInfo>(token, 'getWebhookInfo'), callbackUrl) : skipped('webhook'));

  checks.push(checkOutbox(outboxQ.data ?? [], chatId));
  checks.push(
    checkAllowlist(
      (allowQ.data ?? []).map((r) => {
        const s = (r as { staff?: { is_active?: boolean } | { is_active?: boolean }[] | null }).staff;
        const staffRow = Array.isArray(s) ? s[0] : s;
        return { is_active: (r as { is_active: boolean }).is_active, staff_active: staffRow?.is_active ?? null };
      }),
    ),
  );

  return json({ checks, bot: bot ? { username: bot.username ?? null } : null, webhookUrl: callbackUrl });
});

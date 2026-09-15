/**
 * telegramDiagnose — PURE interpretation for the `telegram-diagnose` edge
 * function (and the sender's supergroup-migration follow). Raw Bot API answers
 * and DB rows in, ordered checks out. No `Deno.*`, no fetch, no supabase-js, so
 * tests/telegram-diagnose.test.ts runs it under vitest.
 *
 * Checks carry a machine `code` plus flat `params`; the operator renders the
 * sentence (op.telegram.diag.<code>) in the staff locale. `code` values are a
 * contract with the i18n catalogs — change both together.
 *
 * Why this exists (2026-09-13): no notification ever reached the staff group.
 * The hosted `telegram_chat_id` held the UI placeholder `-1001234567890` (an
 * e2e run reached hosted and saved it), Telegram answered `chat not found`, and
 * nothing in the app could say which of token / chat / membership / webhook was
 * wrong. Every one of those is a check below.
 */

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';
export type CheckId = 'token' | 'bot' | 'settings' | 'chat' | 'membership' | 'webhook' | 'outbox' | 'allowlist';

export interface DiagnoseCheck {
  id: CheckId;
  status: CheckStatus;
  code: string;
  params?: Record<string, string | number>;
  /** Present when Telegram told us the group moved (basic group → supergroup). */
  newChatId?: string;
}

/** A Bot API envelope; `transport` is set when the request never got an answer. */
export interface TgResult<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { migrate_to_chat_id?: number | string; retry_after?: number };
  transport?: string;
}

export interface TgBot {
  id: number;
  username?: string;
}
export interface TgChat {
  id: number | string;
  title?: string;
  type?: string;
}
export interface TgChatMember {
  status?: string;
}
export interface TgWebhookInfo {
  url?: string;
  pending_update_count?: number;
  last_error_message?: string;
  last_error_date?: number;
  allowed_updates?: string[];
}

/** The example id printed in the operator placeholder, the hint copy and SETUP-telegram.md. */
export const PLACEHOLDER_CHAT_ID = '-1001234567890';

/** What the webhook must be registered with: taps, plus the bot joining / leaving groups. */
export const WEBHOOK_ALLOWED_UPDATES = ['callback_query', 'my_chat_member'] as const;

/** Statuses in which the bot can post to a group. */
const MEMBER_STATUSES = new Set(['creator', 'administrator', 'member']);

const PENDING_WARN_AT = 10;

export function webhookUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/telegram-callback`;
}

/** `migrate_to_chat_id` from a failed Bot API answer, as a string, or null. */
export function migrateToChatId(res: Pick<TgResult<unknown>, 'ok' | 'parameters'> | null | undefined): string | null {
  if (!res || res.ok) return null;
  const v = res.parameters?.migrate_to_chat_id;
  if (v === undefined || v === null || v === '') return null;
  return String(v);
}

function errorText(res: TgResult<unknown>): string {
  if (res.transport) return res.transport;
  return `HTTP ${res.error_code ?? '?'}: ${res.description ?? 'unknown'}`;
}

export function checkToken(token: string | null | undefined): DiagnoseCheck {
  return token && token.trim()
    ? { id: 'token', status: 'ok', code: 'TOKEN_SET' }
    : { id: 'token', status: 'fail', code: 'TOKEN_MISSING' };
}

export function checkBot(res: TgResult<TgBot>): DiagnoseCheck {
  if (res.ok && res.result) {
    return { id: 'bot', status: 'ok', code: 'BOT_OK', params: { username: res.result.username ?? String(res.result.id) } };
  }
  if (res.error_code === 401 || res.error_code === 404) {
    // 404 is what the Bot API answers for a malformed token path.
    return { id: 'bot', status: 'fail', code: 'BOT_UNAUTHORIZED' };
  }
  return { id: 'bot', status: 'fail', code: 'BOT_ERROR', params: { error: errorText(res) } };
}

export function checkSettings(enabled: boolean, chatId: string | null): DiagnoseCheck {
  if (!chatId) return { id: 'settings', status: 'fail', code: 'CHAT_ID_MISSING' };
  if (chatId === PLACEHOLDER_CHAT_ID) {
    return { id: 'settings', status: 'fail', code: 'CHAT_ID_PLACEHOLDER', params: { chatId } };
  }
  if (!enabled) return { id: 'settings', status: 'warn', code: 'DISABLED', params: { chatId } };
  return { id: 'settings', status: 'ok', code: 'SETTINGS_OK', params: { chatId } };
}

export function checkChat(res: TgResult<TgChat>): DiagnoseCheck {
  if (res.ok && res.result) {
    return {
      id: 'chat',
      status: 'ok',
      code: 'CHAT_OK',
      params: { title: res.result.title ?? String(res.result.id), type: res.result.type ?? 'unknown' },
    };
  }
  const moved = migrateToChatId(res);
  if (moved) return { id: 'chat', status: 'fail', code: 'CHAT_MIGRATED', newChatId: moved, params: { newChatId: moved } };
  if (res.error_code === 400 && /chat not found/i.test(res.description ?? '')) {
    return { id: 'chat', status: 'fail', code: 'CHAT_NOT_FOUND' };
  }
  if (res.error_code === 403) return { id: 'chat', status: 'fail', code: 'CHAT_FORBIDDEN', params: { error: errorText(res) } };
  return { id: 'chat', status: 'fail', code: 'CHAT_ERROR', params: { error: errorText(res) } };
}

export function checkMembership(res: TgResult<TgChatMember>): DiagnoseCheck {
  if (res.ok && res.result) {
    const status = res.result.status ?? 'unknown';
    return MEMBER_STATUSES.has(status)
      ? { id: 'membership', status: 'ok', code: 'MEMBER', params: { status } }
      : { id: 'membership', status: 'fail', code: 'NOT_MEMBER', params: { status } };
  }
  return { id: 'membership', status: 'fail', code: 'MEMBER_ERROR', params: { error: errorText(res) } };
}

export function checkWebhook(res: TgResult<TgWebhookInfo>, expectedUrl: string): DiagnoseCheck {
  if (!res.ok || !res.result) {
    return { id: 'webhook', status: 'fail', code: 'WEBHOOK_ERROR', params: { error: errorText(res) } };
  }
  const info = res.result;
  if (!info.url) return { id: 'webhook', status: 'fail', code: 'WEBHOOK_MISSING' };
  if (info.url !== expectedUrl) return { id: 'webhook', status: 'fail', code: 'WEBHOOK_WRONG_URL', params: { url: info.url } };
  if (info.last_error_message) {
    return { id: 'webhook', status: 'fail', code: 'WEBHOOK_DELIVERY_ERROR', params: { error: info.last_error_message } };
  }
  // Telegram omits allowed_updates when every type is allowed (the default).
  const allowed = info.allowed_updates;
  if (allowed && allowed.length > 0 && !WEBHOOK_ALLOWED_UPDATES.every((u) => allowed.includes(u))) {
    return { id: 'webhook', status: 'warn', code: 'WEBHOOK_UPDATES', params: { allowed: allowed.join(', ') } };
  }
  const pending = info.pending_update_count ?? 0;
  if (pending >= PENDING_WARN_AT) return { id: 'webhook', status: 'warn', code: 'WEBHOOK_PENDING', params: { pending } };
  return { id: 'webhook', status: 'ok', code: 'WEBHOOK_OK' };
}

export interface OutboxProbeRow {
  chat_id: string;
  status: string;
  last_error: string | null;
}

/** `rows` newest first. */
export function checkOutbox(rows: OutboxProbeRow[], currentChatId: string | null): DiagnoseCheck {
  const latest = rows[0];
  if (!latest) return { id: 'outbox', status: 'ok', code: 'OUTBOX_EMPTY' };
  if (latest.status === 'sent') return { id: 'outbox', status: 'ok', code: 'OUTBOX_OK' };
  if (latest.status === 'failed' || latest.status === 'skipped') {
    if (currentChatId && latest.chat_id !== currentChatId) {
      const stale = rows.filter((r) => r.status !== 'sent' && r.chat_id !== currentChatId).length;
      return { id: 'outbox', status: 'warn', code: 'OUTBOX_STALE', params: { count: stale, chatId: latest.chat_id } };
    }
    return { id: 'outbox', status: 'fail', code: 'OUTBOX_FAILING', params: { error: latest.last_error ?? latest.status } };
  }
  return { id: 'outbox', status: 'ok', code: 'OUTBOX_QUEUED' };
}

export interface AllowlistProbeRow {
  is_active: boolean;
  staff_active: boolean | null;
}

export function checkAllowlist(rows: AllowlistProbeRow[]): DiagnoseCheck {
  const active = rows.filter((r) => r.is_active);
  if (active.length === 0) return { id: 'allowlist', status: 'warn', code: 'ALLOWLIST_EMPTY' };
  const orphaned = active.filter((r) => r.staff_active !== true).length;
  if (orphaned > 0) return { id: 'allowlist', status: 'warn', code: 'ALLOWLIST_INACTIVE_STAFF', params: { count: orphaned } };
  return { id: 'allowlist', status: 'ok', code: 'ALLOWLIST_OK', params: { count: active.length } };
}

/** A check that could not run because an earlier one failed. */
export function skipped(id: CheckId): DiagnoseCheck {
  return { id, status: 'skip', code: 'SKIPPED' };
}

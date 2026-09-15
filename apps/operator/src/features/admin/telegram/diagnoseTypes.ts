/**
 * Response shape of the `telegram-diagnose` edge function. Mirrors
 * packages/db/supabase/functions/_shared/telegramDiagnose.ts — the `code`
 * values are rendered through ws.manager.settings.telegram.diagnose.codes.*.
 */
import type { MessageKey, TParams } from '@touch/i18n';
import { isolate, isolateLtr } from '@touch/i18n';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';
export type CheckId = 'token' | 'bot' | 'settings' | 'chat' | 'membership' | 'webhook' | 'outbox' | 'allowlist';

export interface DiagnoseCheck {
  id: CheckId;
  status: CheckStatus;
  code: string;
  params?: Record<string, string | number>;
  newChatId?: string;
}

export interface DiagnoseResponse {
  checks: DiagnoseCheck[];
  bot: { username: string | null } | null;
  webhookUrl: string;
}

export const DIAGNOSE_CODES = [
  'TOKEN_SET', 'TOKEN_MISSING',
  'BOT_OK', 'BOT_UNAUTHORIZED', 'BOT_ERROR',
  'SETTINGS_OK', 'DISABLED', 'CHAT_ID_MISSING', 'CHAT_ID_PLACEHOLDER',
  'CHAT_OK', 'CHAT_MIGRATED', 'CHAT_NOT_FOUND', 'CHAT_FORBIDDEN', 'CHAT_ERROR',
  'MEMBER', 'NOT_MEMBER', 'MEMBER_ERROR',
  'WEBHOOK_OK', 'WEBHOOK_MISSING', 'WEBHOOK_WRONG_URL', 'WEBHOOK_DELIVERY_ERROR', 'WEBHOOK_UPDATES', 'WEBHOOK_PENDING',
  'OUTBOX_EMPTY', 'OUTBOX_OK', 'OUTBOX_QUEUED', 'OUTBOX_STALE', 'OUTBOX_FAILING',
  'ALLOWLIST_OK', 'ALLOWLIST_EMPTY', 'ALLOWLIST_INACTIVE_STAFF',
  'SKIPPED',
] as const;

type DiagnoseCode = (typeof DIAGNOSE_CODES)[number];

function isKnownCode(code: string): code is DiagnoseCode {
  return (DIAGNOSE_CODES as readonly string[]).includes(code);
}

/** Webhook states the Re-register button fixes. */
export const WEBHOOK_FIXABLE = new Set(['WEBHOOK_MISSING', 'WEBHOOK_WRONG_URL', 'WEBHOOK_UPDATES', 'WEBHOOK_DELIVERY_ERROR']);

/**
 * The sentence for a check, or null for a code this build does not know (a
 * newer function against an older operator) — the caller shows the raw code.
 * Params are ids, usernames, URLs and raw Bot API errors (LTR-isolated), except
 * the group `title`, which is natural language in either script.
 */
export function checkMessage(
  tr: (key: MessageKey, params?: TParams) => string,
  check: DiagnoseCheck,
): string | null {
  if (!isKnownCode(check.code)) return null;
  const params: TParams = {};
  for (const [k, v] of Object.entries(check.params ?? {})) {
    params[k] = typeof v === 'number' ? v : k === 'title' ? isolate(v) : isolateLtr(v);
  }
  return tr(`ws.manager.settings.telegram.diagnose.codes.${check.code}` as MessageKey, params);
}

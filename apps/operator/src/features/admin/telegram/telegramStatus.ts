/**
 * The one question the Telegram screen answers first: are staff actually being
 * told about new orders? Read from what the screen already loads — the saved
 * settings and the newest outbox row — so the answer costs no extra query and
 * no call to Telegram (Diagnose is the deep check, on request).
 */

/** The example id the setup docs and the old placeholder used (diagnose: CHAT_ID_PLACEHOLDER). */
export const PLACEHOLDER_CHAT_ID = '-1001234567890';

/** A queued message older than this is stuck, not on its way. */
export const STUCK_AFTER_MS = 2 * 60_000;

export type TelegramHealth =
  /** Switched off: nothing is sent or queued. */
  | 'off'
  /** On, but no group — or the example number — is saved. */
  | 'noGroup'
  /** On with a group, and nothing has been sent since. */
  | 'untested'
  /** The newest message failed. */
  | 'failing'
  /** The newest message has sat in the queue past STUCK_AFTER_MS. */
  | 'stuck'
  /** The newest message is on its way. */
  | 'sending'
  /** The newest message was delivered. */
  | 'working';

export interface OutboxLike {
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  created_at: string;
}

export function telegramHealth(
  settings: { enabled: boolean; chatId: string | null },
  latest: OutboxLike | null,
  now: number,
): TelegramHealth {
  if (!settings.enabled) return 'off';
  const chat = settings.chatId?.trim() ?? '';
  if (chat === '' || chat === PLACEHOLDER_CHAT_ID) return 'noGroup';
  if (!latest || latest.status === 'skipped') return 'untested';
  if (latest.status === 'failed') return 'failing';
  if (latest.status === 'queued') return now - new Date(latest.created_at).getTime() > STUCK_AFTER_MS ? 'stuck' : 'sending';
  return 'working';
}

/** Tone of the headline: only a state that stops messages is a problem colour. */
export const HEALTH_TONE: Record<TelegramHealth, 'success' | 'warn' | 'danger' | 'neutral'> = {
  off: 'neutral',
  noGroup: 'warn',
  untested: 'warn',
  failing: 'danger',
  stuck: 'danger',
  sending: 'neutral',
  working: 'success',
};

export type OutboxKind = 'order_new' | 'waiter_call' | 'test';

export function isKnownKind(kind: string): kind is OutboxKind {
  return kind === 'order_new' || kind === 'waiter_call' || kind === 'test';
}

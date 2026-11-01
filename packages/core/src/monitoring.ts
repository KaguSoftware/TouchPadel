/**
 * Dev monitoring (F-15, F-26): the one shape every app sends to
 * `app.report_event` (migration 0393), and the scrubbing every client applies
 * before anything leaves the device.
 *
 * Pure: no network, no platform import, so the operator, the phone, the web
 * site and the edge functions share it (the edge copy mirrors it in Deno).
 *
 * What may never leave: a PIN, a token or password, a phone number, an email
 * address, a card number. Keys that name one are dropped, values that look
 * like one are masked. The server scrubs again (`app.monitor_scrub`), so this
 * is the first of two walls, not the only one.
 */

export type MonitorSource = 'operator' | 'mobile' | 'web' | 'edge' | 'db' | 'cron';
export type MonitorLevel = 'error' | 'warn' | 'info';

export const MONITOR_SOURCES: readonly MonitorSource[] = ['operator', 'mobile', 'web', 'edge', 'db', 'cron'];
export const MONITOR_LEVELS: readonly MonitorLevel[] = ['error', 'warn', 'info'];

/** Well-known kinds. Any `[a-z][a-z0-9_.]{0,47}` is accepted; these are the ones the panel names. */
export const MONITOR_KINDS = [
  'crash',
  'error',
  'unhandled',
  'print_failed',
  'setup_failed',
  'web_error',
  'rpc_error',
  'edge_error',
  'cron_failed',
  'auth_failed',
] as const;
export type MonitorKind = (typeof MONITOR_KINDS)[number] | (string & {});

/** The caller's shape (every client helper's `reportEvent` argument). */
export interface MonitorEventInput {
  level: MonitorLevel;
  kind: MonitorKind;
  message: string;
  detail?: Record<string, unknown> | null;
  /** True when a person pressed "Report crash". */
  userReported?: boolean;
}

/** What `app.report_event` takes, named as its parameters. */
export interface ReportEventArgs {
  p_source: MonitorSource;
  p_level: MonitorLevel;
  p_kind: string;
  p_message: string;
  p_detail: Record<string, unknown>;
  p_app_version: string | null;
  p_user_reported: boolean;
}

/** What a client helper answers: delivered now, kept to send later, or given up on. */
export type ReportOutcome = 'sent' | 'queued' | 'failed';

/** Same caps as the server (0393): the server truncates, the client avoids sending more. */
export const MONITOR_MESSAGE_MAX = 1000;
export const MONITOR_DETAIL_MAX_BYTES = 8000;
const STRING_MAX = 500;
const ARRAY_MAX = 20;
const DEPTH_MAX = 4;
const KIND_RE = /^[a-z][a-z0-9_.]{0,47}$/;

/**
 * Words that make a key secret. A key is split into words (camelCase, snake,
 * kebab, dots), so `managerPin` and `p_phone` are dropped while `shipping`,
 * `spinner` and `mapping` are kept.
 */
const SECRET_WORDS = new Set([
  'pin', 'pins', 'pass', 'passwd', 'password', 'passcode', 'secret', 'secrets', 'token', 'tokens',
  'jwt', 'bearer', 'authorization', 'authorisation', 'apikey', 'cookie', 'cookies', 'session',
  'otp', 'phone', 'phones', 'msisdn', 'email', 'emails', 'mail', 'cvv', 'iban', 'pan', 'card',
]);
const SECRET_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['api', 'key'],
  ['access', 'key'],
  ['private', 'key'],
  ['service', 'role'],
  ['mobile', 'number'],
  ['refresh', 'key'],
];

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER_RE = /\b(Bearer|bearer)\s+[A-Za-z0-9._~+/=-]{8,}/g;
const SECRET_KEY_VALUE_RE = /\b(sb_secret_|sb_publishable_|sk-|sk_live_|pk_live_)[A-Za-z0-9_-]{6,}/g;
/** Eight or more digits, optionally led by + and broken by spaces or dashes: a phone or card number. */
const LONG_DIGITS_RE = /\+?\d(?:[\s-]?\d){7,}/g;

function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** True when a detail key names a secret or a person's contact. */
export function keyIsSecret(key: string): boolean {
  const words = keyWords(key);
  if (words.some((w) => SECRET_WORDS.has(w))) return true;
  return SECRET_PAIRS.some(([a, b]) => {
    const i = words.indexOf(a);
    return i >= 0 && words[i + 1] === b;
  });
}

/**
 * A canonical UUID (8-4-4-4-12 hex) is an id and an ISO date (with an optional
 * time) a date, never a phone or card number: both are set aside before the
 * digit-run mask and put back after, or a digit-heavy id
 * (c0000000-0000-4000-8000-000000000001) came out as c[number]. The same
 * pattern as app.monitor_scrub_text (0393), so client and server agree.
 */
const KEEP_RE =
  /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}|[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?)?/g;
const HOLD = '\u0001';

/** Mask emails, phone or card numbers, JWTs and API keys inside free text; ids and dates stay. Never throws. */
export function scrubText(text: string): string {
  try {
    const kept: string[] = [];
    let i = 0;
    return text
      .split(HOLD)
      .join('')
      .replace(KEEP_RE, (m) => {
        kept.push(m);
        return HOLD;
      })
      .replace(JWT_RE, '[token]')
      .replace(BEARER_RE, 'Bearer [token]')
      .replace(SECRET_KEY_VALUE_RE, '[key]')
      .replace(EMAIL_RE, '[email]')
      .replace(LONG_DIGITS_RE, '[number]')
      .replace(/\u0001/g, () => kept[i++] ?? '');
  } catch {
    return '';
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function scrubValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return clip(scrubText(value), STRING_MAX);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Error) return errorDetail(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  if (depth >= DEPTH_MAX) return '[deep]';
  seen.add(value);
  if (Array.isArray(value)) {
    const out = value.slice(0, ARRAY_MAX).map((v) => scrubValue(v, depth + 1, seen));
    if (value.length > ARRAY_MAX) out.push(`[+${value.length - ARRAY_MAX}]`);
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (keyIsSecret(k)) continue;
    const next = scrubValue(v, depth + 1, seen);
    if (next !== undefined) out[k] = next;
  }
  return out;
}

/**
 * The detail object made safe to send: secret keys dropped, secret-looking
 * values masked, depth, arrays and strings capped, and the whole thing under
 * MONITOR_DETAIL_MAX_BYTES (a bigger one is cut down to its key names).
 * Never throws; anything unreadable becomes `{}`.
 */
export function scrubDetail(detail: unknown): Record<string, unknown> {
  try {
    if (detail === null || detail === undefined || typeof detail !== 'object' || Array.isArray(detail)) {
      return detail === null || detail === undefined ? {} : { value: scrubValue(detail, 1, new WeakSet()) };
    }
    const out = scrubValue(detail, 0, new WeakSet()) as Record<string, unknown>;
    const size = JSON.stringify(out).length;
    if (size <= MONITOR_DETAIL_MAX_BYTES) return out;
    return { truncated: true, bytes: size, keys: Object.keys(out).slice(0, 40) };
  } catch {
    return {};
  }
}

/** An error's name, message and the top of its stack, scrubbed. Never throws. */
export function errorDetail(error: unknown): Record<string, unknown> {
  try {
    if (error instanceof Error) {
      const stack = typeof error.stack === 'string' ? error.stack.split('\n').slice(0, 12).join('\n') : null;
      const out: Record<string, unknown> = {
        name: error.name,
        message: clip(scrubText(error.message), STRING_MAX),
      };
      if (stack) out.stack = clip(scrubText(stack), 2000);
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string' || typeof code === 'number') out.code = code;
      return out;
    }
    if (typeof error === 'string') return { message: clip(scrubText(error), STRING_MAX) };
    return { message: clip(scrubText(String(error)), STRING_MAX) };
  } catch {
    return {};
  }
}

/** One readable line for an error. Never throws. */
export function errorMessage(error: unknown): string {
  try {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    if (typeof error === 'string') return error;
    return JSON.stringify(error) ?? String(error);
  } catch {
    return 'Unknown error';
  }
}

/**
 * The RPC arguments for one event: level and kind forced into range, message
 * and detail scrubbed and capped. Never throws.
 */
export function toReportArgs(
  source: MonitorSource,
  input: MonitorEventInput,
  appVersion: string | null,
  context?: Record<string, unknown>,
): ReportEventArgs {
  const level: MonitorLevel = MONITOR_LEVELS.includes(input?.level) ? input.level : 'error';
  const rawKind = typeof input?.kind === 'string' ? input.kind.trim().toLowerCase() : '';
  const kind = KIND_RE.test(rawKind) ? rawKind : 'unknown';
  const rawMessage = typeof input?.message === 'string' ? input.message : errorMessage(input?.message);
  const message = clip(scrubText(rawMessage).trim() || kind, MONITOR_MESSAGE_MAX);
  const detail = scrubDetail({ ...(context ?? {}), ...(input?.detail ?? {}) });
  return {
    p_source: source,
    p_level: level,
    p_kind: kind,
    p_message: message,
    p_detail: detail,
    p_app_version: typeof appVersion === 'string' && appVersion ? clip(appVersion, 40) : null,
    p_user_reported: input?.userReported === true,
  };
}

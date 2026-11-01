/**
 * Dev monitoring from the edge functions (F-15, F-26; migration 0393).
 *
 * `reportEvent` writes one event (source `edge`) through `app.report_event`
 * with the service-role key, so the dev role's Monitoring page on the
 * operator lists it. It NEVER throws and never takes longer than
 * REPORT_TIMEOUT_MS: a function that failed must not fail again, or hang,
 * while saying so.
 *
 * `handle()` (./http.ts) calls `reportUnhandled` for every throw that escapes
 * a handler, so every function that goes through `handle()` reports its
 * unhandled errors with no code of its own. A function that catches an error
 * it still wants the developer to see calls `reportEvent` itself.
 *
 * PURE enough for the Node suite: plain `fetch`, and `Deno.env` read only
 * through `globalThis` (absent under Node, where nothing is sent). The detail
 * is scrubbed here (a mirror of @touch/core/monitoring's word list) and again
 * by the server (`app.monitor_scrub`).
 */

export type EdgeMonitorLevel = 'error' | 'warn' | 'info';

export interface EdgeMonitorEvent {
  level: EdgeMonitorLevel;
  kind: string;
  message: string;
  detail?: Record<string, unknown> | null;
}

export const REPORT_TIMEOUT_MS = 2_500;
const MESSAGE_MAX = 1000;
const STRING_MAX = 500;
const DETAIL_MAX_BYTES = 8000;

const SECRET_WORDS = new Set([
  'pin', 'pins', 'pass', 'passwd', 'password', 'passcode', 'secret', 'secrets', 'token', 'tokens',
  'jwt', 'bearer', 'authorization', 'authorisation', 'apikey', 'cookie', 'cookies', 'session',
  'otp', 'phone', 'phones', 'msisdn', 'email', 'emails', 'mail', 'cvv', 'iban', 'pan', 'card',
]);

function keyIsSecret(key: string): boolean {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some((w) => SECRET_WORDS.has(w))) return true;
  const joined = words.join('_');
  return /(^|_)(api|access|private|refresh)_key(_|$)|(^|_)service_role(_|$)/.test(joined);
}

/** Ids (UUIDs) and ISO dates survive the digit-run mask: the same rule as app.monitor_scrub_text (0393). */
const KEEP_RE =
  /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}|[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?)?/g;

export function scrubText(text: string): string {
  const kept: string[] = [];
  let i = 0;
  return text
    .split('\u0001')
    .join('')
    .replace(KEEP_RE, (m) => {
      kept.push(m);
      return '\u0001';
    })
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[token]')
    .replace(/\b(Bearer|bearer)\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer [token]')
    .replace(/\b(sb_secret_|sb_publishable_|sk-|sk_live_|pk_live_)[A-Za-z0-9_-]{6,}/g, '[key]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\+?\d(?:[\s-]?\d){7,}/g, '[number]')
    .replace(/\u0001/g, () => kept[i++] ?? '');
}

function scrub(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return scrubText(value).slice(0, STRING_MAX);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) return { name: value.name, message: scrubText(value.message).slice(0, STRING_MAX) };
  if (typeof value !== 'object') return String(value);
  if (depth >= 4) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!keyIsSecret(k)) out[k] = scrub(v, depth + 1);
  }
  return out;
}

/** The detail made safe to store. Never throws. */
export function scrubDetail(detail: unknown): Record<string, unknown> {
  try {
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return {};
    const out = scrub(detail, 0) as Record<string, unknown>;
    const size = JSON.stringify(out).length;
    return size <= DETAIL_MAX_BYTES ? out : { truncated: true, bytes: size, keys: Object.keys(out).slice(0, 40) };
  } catch {
    return {};
  }
}

function env(name: string): string | undefined {
  try {
    const deno = (globalThis as { Deno?: { env?: { get(n: string): string | undefined } } }).Deno;
    return deno?.env?.get(name) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The RPC body for one event. Exported for tests. */
export function reportBody(event: EdgeMonitorEvent): Record<string, unknown> {
  const level: EdgeMonitorLevel = event?.level === 'warn' || event?.level === 'info' ? event.level : 'error';
  const kind = typeof event?.kind === 'string' && /^[a-z][a-z0-9_.]{0,47}$/.test(event.kind) ? event.kind : 'edge_error';
  const message = scrubText(String(event?.message ?? kind)).slice(0, MESSAGE_MAX) || kind;
  return {
    p_source: 'edge',
    p_level: level,
    p_kind: kind,
    p_message: message,
    p_detail: scrubDetail(event?.detail ?? {}),
    p_app_version: null,
    p_user_reported: false,
  };
}

/**
 * Store one event in dev monitoring (service-role insert through
 * `app.report_event`). Never throws; answers whether it landed.
 */
export async function reportEvent(event: EdgeMonitorEvent): Promise<boolean> {
  try {
    const url = env('SUPABASE_URL');
    const key = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return false;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), REPORT_TIMEOUT_MS);
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/report_event`, {
        method: 'POST',
        headers: {
          apikey: key,
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          'content-profile': 'app',
        },
        body: JSON.stringify(reportBody(event)),
        signal: ctl.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/** What handle() calls for a throw that escaped a handler. Never throws. */
export function reportUnhandled(fn: string, err: unknown, req?: Request): Promise<boolean> {
  try {
    const e = err instanceof Error ? err : null;
    let path: string | null = null;
    try {
      path = req ? new URL(req.url).pathname : null;
    } catch {
      path = null;
    }
    return reportEvent({
      level: 'error',
      kind: 'edge_error',
      message: `${fn}: ${e ? `${e.name}: ${e.message}` : String(err)}`,
      detail: {
        function: fn,
        method: req?.method ?? null,
        path,
        name: e?.name ?? null,
        stack: e?.stack ? e.stack.split('\n').slice(0, 10).join('\n') : null,
      },
    });
  } catch {
    return Promise.resolve(false);
  }
}

/**
 * TODO(email provider): send `event` to contact@kagusoftware.com.
 *
 * The one seam for the email alert (DECISIONS.md, F-15: "email LATER"). No
 * provider is chosen yet, so this sends nothing and nothing calls it. When one
 * is picked: read its key from `supabase secrets set`, send only the kind,
 * level, source, time and message (never `detail`), and call this from the
 * place that decides which events deserve an email (a cron over
 * app.monitoring_events, not every insert).
 */
export const MONITORING_EMAIL_TO = 'contact@kagusoftware.com';

export function notifyByEmail(event: EdgeMonitorEvent & { source?: string; at?: string }): Promise<false> {
  void event;
  return Promise.resolve(false);
}

/**
 * redact — strip secrets from a queued mutation payload before it is stored or
 * echoed anywhere (sync_replays.conflict_detail, manager_alerts.payload, the
 * replay response body).
 *
 * Why this exists (PHASE-2 criticals, S2): adjustment payloads carry the
 * manager's `pin` by design, and the replay function used to record the WHOLE
 * payload into sync_replays on every failed attempt and hand it back over HTTP
 * to whichever till replayed the same key. A raw six-digit PIN in a
 * manager-readable table, and on a colleague's screen, is a credential leak.
 *
 * The key list is deliberately exact-match and short: a payload never
 * legitimately carries any of these past the RPC boundary, so dropping them
 * can never remove information a reviewer needs to understand a conflict.
 */
const SECRET_KEYS = new Set(['pin', 'password', 'secret', 'token', 'accesstoken', 'otp']);

export const REDACTED = '[redacted]';

/** Deep copy with every secret-named key replaced by REDACTED. Arrays and scalars pass through. */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.has(k.toLowerCase()) ? REDACTED : redactSecrets(v);
    }
    return out as T;
  }
  return value;
}

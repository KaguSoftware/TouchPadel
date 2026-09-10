/**
 * send-sms-otp — Standard Webhooks signature verification, PURE (Web Crypto
 * only: no `Deno.*`, no fetch), so it runs under Deno and under vitest on
 * Node 22 (packages/db/tests/phone-otp.test.ts).
 *
 * GoTrue signs every auth-hook request the Standard Webhooks way
 * (https://www.standardwebhooks.com/):
 *   webhook-id         opaque message id
 *   webhook-timestamp  unix seconds
 *   webhook-signature  space-separated list of "v1,<base64 HMAC-SHA256>"
 *   signed content     `${id}.${timestamp}.${rawBody}`
 *   secret             "v1,whsec_<base64 key>" — the dashboard / config.toml
 *                      value; strip "v1," and "whsec_", base64-decode the rest.
 *
 * A request that fails ANY of these is not from our GoTrue: an unknown caller
 * could otherwise make the venue pay for SMS to any number.
 */

export interface StandardWebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export const DEFAULT_TOLERANCE_S = 5 * 60;

export type VerifyOutcome =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'NO_SECRET'
        | 'BAD_SECRET'
        | 'MISSING_HEADERS'
        | 'BAD_TIMESTAMP'
        | 'STALE_TIMESTAMP'
        | 'BAD_SIGNATURE';
    };

export function headersOf(h: Headers): StandardWebhookHeaders {
  return {
    id: h.get('webhook-id'),
    timestamp: h.get('webhook-timestamp'),
    signature: h.get('webhook-signature'),
  };
}

/** Raw key bytes from "v1,whsec_<b64>" (also accepts "whsec_<b64>" and a bare base64). */
export function secretKeyBytes(secret: string): Uint8Array | null {
  let s = secret.trim();
  if (!s) return null;
  if (s.startsWith('v1,')) s = s.slice(3);
  if (s.startsWith('whsec_')) s = s.slice(6);
  try {
    return base64Decode(s);
  } catch {
    return null;
  }
}

export async function hmacSha256Base64(key: Uint8Array, message: string): Promise<string> {
  // A fresh ArrayBuffer copy: typed identically under Deno's lib.dom and
  // @types/node (no BufferSource name in the ES2022 lib the db package uses).
  const raw = key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return base64Encode(new Uint8Array(sig));
}

/**
 * Verify a request. `nowS` is injectable for tests. Fail closed on an unset or
 * malformed secret — a hook that "works" because nobody configured a secret is
 * an open SMS relay.
 */
export async function verifyStandardWebhook(args: {
  secret: string | null | undefined;
  headers: StandardWebhookHeaders;
  body: string;
  nowS?: number;
  toleranceS?: number;
}): Promise<VerifyOutcome> {
  if (!args.secret) return { ok: false, reason: 'NO_SECRET' };
  const key = secretKeyBytes(args.secret);
  if (!key || key.length === 0) return { ok: false, reason: 'BAD_SECRET' };

  const { id, timestamp, signature } = args.headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: 'MISSING_HEADERS' };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || !/^\d+$/.test(timestamp))
    return { ok: false, reason: 'BAD_TIMESTAMP' };
  const now = args.nowS ?? Math.floor(Date.now() / 1000);
  const tolerance = args.toleranceS ?? DEFAULT_TOLERANCE_S;
  if (Math.abs(now - ts) > tolerance) return { ok: false, reason: 'STALE_TIMESTAMP' };

  const expected = await hmacSha256Base64(key, `${id}.${timestamp}.${args.body}`);
  const candidates = signature
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .map((part) => part.slice(3));
  for (const candidate of candidates) {
    if (constantTimeEqual(candidate, expected)) return { ok: true };
  }
  return { ok: false, reason: 'BAD_SIGNATURE' };
}

/** Build the three headers for a body — used by tests and by the local smoke script. */
export async function signStandardWebhook(
  secret: string,
  body: string,
  opts: { id?: string; timestampS?: number } = {},
): Promise<Record<string, string>> {
  const key = secretKeyBytes(secret);
  if (!key) throw new Error('bad secret');
  const id = opts.id ?? `msg_${Math.random().toString(36).slice(2, 12)}`;
  const timestamp = String(opts.timestampS ?? Math.floor(Date.now() / 1000));
  const sig = await hmacSha256Base64(key, `${id}.${timestamp}.${body}`);
  return { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${sig}` };
}

/** Constant-time compare (lengths must already be equal, else false). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// atob / btoa exist as globals on Deno and Node 18+; byte-safe wrappers.
export function base64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64Encode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  return btoa(bin);
}

/**
 * Qi Card signatures, in Web Crypto only (runs under Deno and under vitest).
 *
 * 1. Webhooks. Qi signs every notification with its RSA private key: header
 *    `X-Signature` = base64 RSA-SHA256 (PKCS#1 v1.5) over
 *        paymentId|amount.000|currency|creationDate|status
 *    with '-' for a missing value (developers-gate.qi.iq, "Webhook
 *    Verification", checked 2026-09-27). The string is rebuilt from the
 *    PARSED payload exactly as Qi's reference code does (Node: `amount ?
 *    amount.toString() + '.000' : '-'`), and, for safety, also with the amount
 *    at three decimals; either verifying is a pass. Nothing is reformatted:
 *    creationDate and status are used as received.
 *
 * 2. Requests (optional). A terminal set up for "Signature-Based
 *    Authentication" also wants an X-Signature on our calls, made with OUR
 *    private key over the operation's fields (terminalId|requestId|…). Only
 *    used when a signing key is configured (./qi.ts).
 */

const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

/** Web Crypto's key type, named without the DOM lib (the Node typecheck has none). */
type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

/** Secrets pasted through a CLI often carry literal "\n". */
function normalisePem(pem: string): string {
  return pem.replace(/\\n/g, '\n').trim();
}

function pemBody(pem: string): { label: string; der: Uint8Array } {
  const m = normalisePem(pem).match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
  if (!m) throw new Error('not a PEM block');
  const b64 = (m[2] ?? '').replace(/[^A-Za-z0-9+/=]/g, '');
  return { label: m[1] ?? '', der: base64ToBytes(b64) };
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// ── minimal DER, to accept PKCS#1 keys as well as SPKI / PKCS#8 ─────────────
function derLength(n: number): Uint8Array {
  if (n < 0x80) return Uint8Array.of(n);
  const bytes: number[] = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}
function der(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(...parts);
  return concat(Uint8Array.of(tag), derLength(body.length), body);
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
// AlgorithmIdentifier { rsaEncryption, NULL }
const RSA_ALG_ID = Uint8Array.of(0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00);

function spkiFromPkcs1(pkcs1: Uint8Array): Uint8Array {
  return der(0x30, RSA_ALG_ID, der(0x03, Uint8Array.of(0x00), pkcs1));
}
function pkcs8FromPkcs1(pkcs1: Uint8Array): Uint8Array {
  return der(0x30, Uint8Array.of(0x02, 0x01, 0x00), RSA_ALG_ID, der(0x04, pkcs1));
}

/** A standalone ArrayBuffer copy: what Web Crypto's BufferSource wants on every TS lib. */
function ab(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const keyCache = new Map<string, Promise<Key>>();

export function importPublicKey(pem: string): Promise<Key> {
  const hit = keyCache.get(`pub:${pem}`);
  if (hit) return hit;
  const p = (async () => {
    const { label, der: bytes } = pemBody(pem);
    const spki = label === 'RSA PUBLIC KEY' ? spkiFromPkcs1(bytes) : bytes;
    return crypto.subtle.importKey('spki', ab(spki), RSA, false, ['verify']);
  })();
  keyCache.set(`pub:${pem}`, p);
  return p;
}

export function importPrivateKey(pem: string): Promise<Key> {
  const hit = keyCache.get(`priv:${pem}`);
  if (hit) return hit;
  const p = (async () => {
    const { label, der: bytes } = pemBody(pem);
    const pkcs8 = label === 'RSA PRIVATE KEY' ? pkcs8FromPkcs1(bytes) : bytes;
    return crypto.subtle.importKey('pkcs8', ab(pkcs8), RSA, false, ['sign']);
  })();
  keyCache.set(`priv:${pem}`, p);
  return p;
}

// ── 1. webhooks ─────────────────────────────────────────────────────────────

type Payload = Record<string, unknown>;

const field = (v: unknown): string =>
  v === null || v === undefined || v === '' ? '-' : String(v);

/** The strings Qi may have signed, most likely first. */
export function webhookSignedStrings(payload: Payload): string[] {
  const amount = payload.amount;
  const tail = [field(payload.currency), field(payload.creationDate), field(payload.status)];
  const reference = [
    field(payload.paymentId),
    // Qi's reference implementation, verbatim semantics (0 reads as missing).
    amount ? `${String(amount)}.000` : '-',
    ...tail,
  ].join('|');
  const out = [reference];
  if (typeof amount === 'number' && Number.isFinite(amount) && !Number.isInteger(amount)) {
    out.push([field(payload.paymentId), amount.toFixed(3), ...tail].join('|'));
  }
  return out;
}

export type WebhookVerdict =
  | { ok: true }
  | { ok: false; reason: 'no_key' | 'no_signature' | 'bad_key' | 'mismatch' };

export async function verifyQiWebhook(args: {
  publicKeyPem: string | undefined | null;
  signature: string | null;
  payload: Payload;
}): Promise<WebhookVerdict> {
  if (!args.publicKeyPem || !args.publicKeyPem.trim()) return { ok: false, reason: 'no_key' };
  if (!args.signature || !args.signature.trim()) return { ok: false, reason: 'no_signature' };
  let key: Key;
  try {
    key = await importPublicKey(args.publicKeyPem);
  } catch {
    return { ok: false, reason: 'bad_key' };
  }
  let sig: Uint8Array;
  try {
    sig = base64ToBytes(args.signature.trim());
  } catch {
    return { ok: false, reason: 'mismatch' };
  }
  for (const s of webhookSignedStrings(args.payload)) {
    if (await crypto.subtle.verify(RSA, key, ab(sig), ab(new TextEncoder().encode(s)))) return { ok: true };
  }
  return { ok: false, reason: 'mismatch' };
}

// ── 2. requests (optional signature-based authentication) ───────────────────

/** '-' for missing, amounts at three decimals (IQD), joined with '|'. */
export function requestSignedString(values: Array<string | number | boolean | null | undefined>): string {
  return values
    .map((v) => (typeof v === 'number' ? v.toFixed(3) : field(v)))
    .join('|');
}

export async function signQiRequest(privateKeyPem: string, data: string): Promise<string> {
  const key = await importPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign(RSA, key, ab(new TextEncoder().encode(data)));
  return bytesToBase64(new Uint8Array(sig));
}

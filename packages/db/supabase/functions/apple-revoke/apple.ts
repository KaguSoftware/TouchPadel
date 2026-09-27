/**
 * apple-revoke — the PURE half: Sign in with Apple client-secret signing and the
 * /auth/token -> /auth/revoke exchange. Web Crypto + an injected fetch only (no
 * `Deno.*`), so it runs under Deno and under vitest on Node 22
 * (packages/db/tests/apple-revoke.test.ts). index.ts is the thin HTTP shell.
 *
 * Apple's contract (developer.apple.com "Generate and validate tokens",
 * "Revoke tokens"):
 *
 *   client_secret  a JWT, ES256, header { alg: 'ES256', kid: <Key ID> },
 *                  claims { iss: <Team ID>, iat, exp (<= iat + 15777000),
 *                           aud: 'https://appleid.apple.com', sub: <client id> }
 *                  signed with the Sign in with Apple .p8 key (PKCS#8 P-256).
 *
 *   POST https://appleid.apple.com/auth/token     (form-encoded)
 *        client_id, client_secret, code, grant_type=authorization_code
 *     -> 200 { access_token, refresh_token?, id_token, expires_in, token_type }
 *     -> 400 { error: 'invalid_grant' | 'invalid_client' | ... }
 *
 *   POST https://appleid.apple.com/auth/revoke    (form-encoded)
 *        client_id, client_secret, token, token_type_hint
 *     -> 200 (empty body) revoked
 *     -> 400 { error: ... }
 *
 * ES256 SIGNATURE FORMAT. Web Crypto's ECDSA sign returns the raw r||s
 * concatenation (IEEE P1363, 64 bytes for P-256), which is exactly the JWS
 * ES256 encoding. It is NOT DER — do not wrap it, and do not convert it.
 */

export const APPLE_AUDIENCE = 'https://appleid.apple.com';
export const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
export const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
/** Apple allows up to 15777000 s (6 months). The secret is minted per request, so minutes is plenty. */
export const CLIENT_SECRET_TTL_S = 5 * 60;

/** Every secret the exchange needs. Absent = not configured. */
export const REQUIRED_SECRETS = [
  'APPLE_TEAM_ID',
  'APPLE_KEY_ID',
  'APPLE_CLIENT_ID',
  'APPLE_PRIVATE_KEY_P8',
] as const;

export interface EnvLike {
  get(k: string): string | undefined;
}

export interface AppleConfig {
  teamId: string;
  keyId: string;
  /** The bundle id for the native flow (com.kagu.touchpadel) — the `aud` of the user's Apple tokens. */
  clientId: string;
  /** PEM text of the .p8 (normalised by normalizeP8). */
  privateKeyP8: string;
}

export function missingSecrets(env: EnvLike): string[] {
  return REQUIRED_SECRETS.filter((k) => !(env.get(k) ?? '').trim());
}

/** The config, or null when any secret is missing (see missingSecrets for which). */
export function appleConfigFromEnv(env: EnvLike): AppleConfig | null {
  if (missingSecrets(env).length > 0) return null;
  return {
    teamId: env.get('APPLE_TEAM_ID')!.trim(),
    keyId: env.get('APPLE_KEY_ID')!.trim(),
    clientId: env.get('APPLE_CLIENT_ID')!.trim(),
    privateKeyP8: normalizeP8(env.get('APPLE_PRIVATE_KEY_P8')!),
  };
}

/**
 * Accept the .p8 however it survived being pasted into a secret store: real
 * newlines, literal `\n` sequences (the usual one-line `secrets set` form),
 * CRLF, or wrapped in quotes.
 */
export function normalizeP8(raw: string): string {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s.replace(/\\r\\n|\\n|\\r/g, '\n').replace(/\r\n?/g, '\n').trim();
}

/** DER bytes of a PKCS#8 PEM (or of bare base64 with the armour already removed). */
export function pkcs8FromPem(pem: string): Uint8Array {
  const body = normalizeP8(pem)
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  if (!body) throw new Error('empty private key');
  return base64Decode(body);
}

async function importSigningKey(pem: string) {
  const der = pkcs8FromPem(pem);
  // A fresh ArrayBuffer copy: typed identically under Deno's lib.dom and
  // @types/node (same reason as send-sms-otp/verify.ts).
  const raw = der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer;
  return crypto.subtle.importKey('pkcs8', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** Sign the Apple client-secret JWT. `nowS` is injectable for tests. */
export async function signClientSecret(config: AppleConfig, nowS = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = { alg: 'ES256', kid: config.keyId };
  const claims = {
    iss: config.teamId,
    iat: nowS,
    exp: nowS + CLIENT_SECRET_TTL_S,
    aud: APPLE_AUDIENCE,
    sub: config.clientId,
  };
  const signingInput = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(claims)}`;
  const key = await importSigningKey(config.privateKeyP8);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput));
  // Raw r||s (P1363) — already the JWS form.
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;
}

/** The `sub` of an Apple id_token, or null. No signature check: it came straight from Apple over TLS. */
export function idTokenSub(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1]!))) as { sub?: unknown };
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>;

export type AppleFailureCode = 'APPLE_TOKEN_EXCHANGE_FAILED' | 'APPLE_REVOKE_FAILED';

export type AppleRevokeResult =
  | {
      ok: true;
      /** Which token was revoked — refresh_token unless Apple returned none. */
      tokenTypeHint: 'refresh_token' | 'access_token';
      /** The Apple user id the code belonged to (from the id_token), when present. */
      sub: string | null;
    }
  | {
      ok: false;
      code: AppleFailureCode;
      /** Apple's HTTP status, or null when Apple was unreachable. */
      status: number | null;
      /** Apple's `error` field (e.g. invalid_grant). Never the secret, never the code. */
      appleError: string | null;
    };

/**
 * Exchange a fresh authorizationCode for a token and revoke it.
 *
 * The client secret is signed ONCE and used for both calls. Nothing thrown
 * escapes except a key that will not import/sign (a configuration error the
 * caller maps to 500) — every Apple-side failure is a returned result.
 */
export async function revokeWithAuthorizationCode(args: {
  config: AppleConfig;
  authorizationCode: string;
  fetch: FetchLike;
  nowS?: number;
}): Promise<AppleRevokeResult> {
  const { config, fetch } = args;
  const clientSecret = await signClientSecret(config, args.nowS);

  // 1. code -> tokens
  let tokenRes: Response;
  try {
    tokenRes = await fetch(APPLE_TOKEN_URL, formPost({
      client_id: config.clientId,
      client_secret: clientSecret,
      code: args.authorizationCode,
      grant_type: 'authorization_code',
    }));
  } catch {
    return { ok: false, code: 'APPLE_TOKEN_EXCHANGE_FAILED', status: null, appleError: null };
  }
  const tokenBody = (await readJson(tokenRes)) as {
    refresh_token?: unknown;
    access_token?: unknown;
    id_token?: unknown;
    error?: unknown;
  };
  if (tokenRes.status !== 200) {
    return {
      ok: false,
      code: 'APPLE_TOKEN_EXCHANGE_FAILED',
      status: tokenRes.status,
      appleError: safeAppleError(tokenBody.error),
    };
  }

  let token: string;
  let tokenTypeHint: 'refresh_token' | 'access_token';
  if (typeof tokenBody.refresh_token === 'string' && tokenBody.refresh_token) {
    token = tokenBody.refresh_token;
    tokenTypeHint = 'refresh_token';
  } else if (typeof tokenBody.access_token === 'string' && tokenBody.access_token) {
    token = tokenBody.access_token;
    tokenTypeHint = 'access_token';
  } else {
    return { ok: false, code: 'APPLE_TOKEN_EXCHANGE_FAILED', status: 200, appleError: 'no_token_returned' };
  }

  // 2. revoke
  let revokeRes: Response;
  try {
    revokeRes = await fetch(APPLE_REVOKE_URL, formPost({
      client_id: config.clientId,
      client_secret: clientSecret,
      token,
      token_type_hint: tokenTypeHint,
    }));
  } catch {
    return { ok: false, code: 'APPLE_REVOKE_FAILED', status: null, appleError: null };
  }
  if (revokeRes.status !== 200) {
    const body = (await readJson(revokeRes)) as { error?: unknown };
    return { ok: false, code: 'APPLE_REVOKE_FAILED', status: revokeRes.status, appleError: safeAppleError(body.error) };
  }

  return { ok: true, tokenTypeHint, sub: idTokenSub(tokenBody.id_token) };
}

function formPost(fields: Record<string, string>) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(fields).toString(),
  };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const text = await res.text();
    const parsed: unknown = text ? JSON.parse(text) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Apple's error codes are short snake_case tokens; anything else is not echoed. */
function safeAppleError(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z_]{1,64}$/.test(value) ? value : null;
}

// --- base64 / base64url (atob / btoa exist on Deno and Node 18+) ------------

export function base64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return base64Decode(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

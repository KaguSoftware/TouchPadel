/**
 * Apple's /auth/revoke — Sign in with Apple token revocation on account
 * deletion (App Store Review Guideline 5.1.1(v)).
 *
 * The exchange lives in supabase/functions/apple-revoke/apple.ts, pure (Web
 * Crypto + an injected fetch), so it is tested here on Node 22 without Deno,
 * without the stack and without Apple:
 *
 *   - the client-secret JWT is signed with a THROWAWAY P-256 key generated per
 *     run, then verified with its public key as raw r||s (IEEE P1363) — the JWS
 *     ES256 form. A DER-encoded signature would fail that verify;
 *   - the token -> revoke sequence runs against a fake fetch for success, a
 *     code exchange with no refresh token, a token-exchange error and a revoke
 *     error, and the requests are inspected field by field.
 *
 * The last block needs the local stack (skipped without Docker, like every other
 * stack suite): delete_my_account still reports apple_revoke_pending.
 */
import { generateKeyPairSync, verify as nodeVerify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stackAvailable, serviceClient, guestClient, appRpc } from './helpers';
import {
  APPLE_AUDIENCE,
  APPLE_REVOKE_URL,
  APPLE_TOKEN_URL,
  CLIENT_SECRET_TTL_S,
  appleConfigFromEnv,
  base64UrlDecode,
  base64UrlEncode,
  idTokenSub,
  missingSecrets,
  normalizeP8,
  revokeWithAuthorizationCode,
  signClientSecret,
  type AppleConfig,
  type FetchLike,
} from '../supabase/functions/apple-revoke/apple.ts';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const CONFIG: AppleConfig = {
  teamId: 'BR42V976FS',
  keyId: 'ABC123DEFG',
  clientId: 'com.kagu.touchpadel',
  privateKeyP8: PEM,
};

const NOW = 1_789_000_000;

function decodeJson(segment: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment))) as Record<string, unknown>;
}

function verifyEs256(jwt: string): boolean {
  const [h, p, s] = jwt.split('.') as [string, string, string];
  return nodeVerify(
    'sha256',
    Buffer.from(`${h}.${p}`),
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(base64UrlDecode(s)),
  );
}

function fakeIdToken(sub: string): string {
  const enc = (v: unknown) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(v)));
  return `${enc({ alg: 'RS256' })}.${enc({ sub, aud: CONFIG.clientId })}.sig`;
}

interface Call {
  url: string;
  headers: Record<string, string>;
  form: URLSearchParams;
}

function fakeFetch(responses: Array<Response | Error>): FetchLike & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (url, init) => {
    calls.push({ url, headers: init.headers, form: new URLSearchParams(init.body) });
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    if (next instanceof Error) throw next;
    return next;
  }) as FetchLike & { calls: Call[] };
  fn.calls = calls;
  return fn;
}

const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('apple-revoke — client secret JWT (ES256)', () => {
  it('signs a JWT Apple accepts: header, claims, and a P1363 signature that verifies', async () => {
    const jwt = await signClientSecret(CONFIG, NOW);
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);

    expect(decodeJson(parts[0]!)).toEqual({ alg: 'ES256', kid: 'ABC123DEFG' });
    expect(decodeJson(parts[1]!)).toEqual({
      iss: 'BR42V976FS',
      iat: NOW,
      exp: NOW + CLIENT_SECRET_TTL_S,
      aud: APPLE_AUDIENCE,
      sub: 'com.kagu.touchpadel',
    });
    expect(APPLE_AUDIENCE).toBe('https://appleid.apple.com');
    // Apple's ceiling is 15777000 s; ours is minutes.
    expect(CLIENT_SECRET_TTL_S).toBeGreaterThan(0);
    expect(CLIENT_SECRET_TTL_S).toBeLessThanOrEqual(15_777_000);

    // 64 raw bytes (r||s), no base64 padding, and it verifies as P1363.
    expect(base64UrlDecode(parts[2]!)).toHaveLength(64);
    expect(jwt).not.toMatch(/[=+/]/);
    expect(verifyEs256(jwt)).toBe(true);
  });

  it('a signature does not verify against a different key or a tampered payload', async () => {
    const jwt = await signClientSecret(CONFIG, NOW);
    const [h, , s] = jwt.split('.');
    const forged = `${h}.${base64UrlEncode(new TextEncoder().encode('{"iss":"x"}'))}.${s}`;
    expect(verifyEs256(forged)).toBe(false);

    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const [hh, pp, ss] = jwt.split('.') as [string, string, string];
    expect(
      nodeVerify('sha256', Buffer.from(`${hh}.${pp}`), { key: other.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(base64UrlDecode(ss))),
    ).toBe(false);
  });

  it('accepts the .p8 with literal \\n sequences, CRLF, or wrapped in quotes', async () => {
    const oneLine = PEM.trim().replace(/\n/g, '\\n');
    expect(oneLine).not.toContain('\n');
    for (const variant of [oneLine, PEM.replace(/\n/g, '\r\n'), `"${oneLine}"`, `  ${PEM}  `]) {
      expect(normalizeP8(variant)).toBe(PEM.trim());
      const jwt = await signClientSecret({ ...CONFIG, privateKeyP8: variant }, NOW);
      expect(verifyEs256(jwt)).toBe(true);
    }
  });

  it('refuses a key that is not a PKCS#8 P-256 key', async () => {
    await expect(signClientSecret({ ...CONFIG, privateKeyP8: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----' }, NOW)).rejects.toThrow();
  });
});

describe('apple-revoke — configuration', () => {
  const envOf = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] });
  const FULL = {
    APPLE_TEAM_ID: ' BR42V976FS ',
    APPLE_KEY_ID: 'ABC123DEFG',
    APPLE_CLIENT_ID: 'com.kagu.touchpadel',
    // The trailing newline too, as `secrets set` of a pasted file would carry it.
    APPLE_PRIVATE_KEY_P8: PEM.replace(/\n/g, '\\n'),
  };

  it('names every missing secret, treating blank as missing', () => {
    expect(missingSecrets(envOf({}))).toEqual(['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_CLIENT_ID', 'APPLE_PRIVATE_KEY_P8']);
    expect(missingSecrets(envOf({ ...FULL, APPLE_KEY_ID: '   ' }))).toEqual(['APPLE_KEY_ID']);
    expect(appleConfigFromEnv(envOf({ ...FULL, APPLE_KEY_ID: '' }))).toBeNull();
  });

  it('builds a trimmed config with a normalised key', () => {
    const cfg = appleConfigFromEnv(envOf(FULL))!;
    expect(cfg.teamId).toBe('BR42V976FS');
    expect(cfg.clientId).toBe('com.kagu.touchpadel');
    expect(cfg.privateKeyP8).toBe(PEM.trim());
  });
});

describe('apple-revoke — token exchange then revoke', () => {
  const CODE = 'c0de.one-time.authorization';

  it('exchanges the code, revokes the REFRESH token, and reports the Apple sub', async () => {
    const fetch = fakeFetch([
      jsonRes(200, { access_token: 'at-1', refresh_token: 'rt-1', id_token: fakeIdToken('001234.abcd.0999'), token_type: 'Bearer' }),
      new Response('', { status: 200 }),
    ]);
    const result = await revokeWithAuthorizationCode({ config: CONFIG, authorizationCode: CODE, fetch, nowS: NOW });
    expect(result).toEqual({ ok: true, tokenTypeHint: 'refresh_token', sub: '001234.abcd.0999' });

    expect(fetch.calls.map((c) => c.url)).toEqual([APPLE_TOKEN_URL, APPLE_REVOKE_URL]);
    const [tokenCall, revokeCall] = fetch.calls as [Call, Call];
    expect(tokenCall.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(tokenCall.form)).toMatchObject({
      client_id: 'com.kagu.touchpadel',
      code: CODE,
      grant_type: 'authorization_code',
    });
    expect(Object.fromEntries(revokeCall.form)).toMatchObject({
      client_id: 'com.kagu.touchpadel',
      token: 'rt-1',
      token_type_hint: 'refresh_token',
    });
    // One client secret, valid, used for both calls; the code never reaches /revoke.
    const secret = tokenCall.form.get('client_secret')!;
    expect(verifyEs256(secret)).toBe(true);
    expect(revokeCall.form.get('client_secret')).toBe(secret);
    expect(revokeCall.form.get('code')).toBeNull();
  });

  it('falls back to revoking the ACCESS token when Apple returns no refresh token', async () => {
    const fetch = fakeFetch([jsonRes(200, { access_token: 'at-only' }), new Response('', { status: 200 })]);
    const result = await revokeWithAuthorizationCode({ config: CONFIG, authorizationCode: CODE, fetch, nowS: NOW });
    expect(result).toEqual({ ok: true, tokenTypeHint: 'access_token', sub: null });
    expect(fetch.calls[1]!.form.get('token')).toBe('at-only');
    expect(fetch.calls[1]!.form.get('token_type_hint')).toBe('access_token');
  });

  it('a token exchange error stops before /revoke and surfaces Apple’s error code only', async () => {
    const fetch = fakeFetch([jsonRes(400, { error: 'invalid_grant', error_description: 'code expired' })]);
    const result = await revokeWithAuthorizationCode({ config: CONFIG, authorizationCode: CODE, fetch, nowS: NOW });
    expect(result).toEqual({ ok: false, code: 'APPLE_TOKEN_EXCHANGE_FAILED', status: 400, appleError: 'invalid_grant' });
    expect(fetch.calls).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(CODE);
  });

  it('a 200 exchange with no token at all is a failure, not a silent success', async () => {
    const fetch = fakeFetch([jsonRes(200, { id_token: fakeIdToken('x') })]);
    const result = await revokeWithAuthorizationCode({ config: CONFIG, authorizationCode: CODE, fetch, nowS: NOW });
    expect(result).toMatchObject({ ok: false, code: 'APPLE_TOKEN_EXCHANGE_FAILED' });
    expect(fetch.calls).toHaveLength(1);
  });

  it('a revoke error is reported as APPLE_REVOKE_FAILED with Apple’s status', async () => {
    const fetch = fakeFetch([jsonRes(200, { refresh_token: 'rt-1' }), jsonRes(400, { error: 'invalid_client' })]);
    const result = await revokeWithAuthorizationCode({ config: CONFIG, authorizationCode: CODE, fetch, nowS: NOW });
    expect(result).toEqual({ ok: false, code: 'APPLE_REVOKE_FAILED', status: 400, appleError: 'invalid_client' });
  });

  it('an unreachable Apple is a result, never a throw', async () => {
    const down = fakeFetch([new TypeError('fetch failed')]);
    expect(await revokeWithAuthorizationCode({ config: CONFIG, authorizationCode: CODE, fetch: down, nowS: NOW })).toEqual({
      ok: false,
      code: 'APPLE_TOKEN_EXCHANGE_FAILED',
      status: null,
      appleError: null,
    });
    const revokeDown = fakeFetch([jsonRes(200, { refresh_token: 'rt' }), new TypeError('fetch failed')]);
    expect(await revokeWithAuthorizationCode({ config: CONFIG, authorizationCode: CODE, fetch: revokeDown, nowS: NOW })).toMatchObject({
      ok: false,
      code: 'APPLE_REVOKE_FAILED',
      status: null,
    });
  });

  it('never echoes an Apple error that is not a short error token', async () => {
    const fetch = fakeFetch([jsonRes(400, { error: `leaked ${CODE}` })]);
    const result = await revokeWithAuthorizationCode({ config: CONFIG, authorizationCode: CODE, fetch, nowS: NOW });
    expect(result).toMatchObject({ ok: false, appleError: null });
  });

  it('reads the sub from an id_token and tolerates junk', () => {
    expect(idTokenSub(fakeIdToken('abc'))).toBe('abc');
    expect(idTokenSub('nope')).toBeNull();
    expect(idTokenSub(undefined)).toBeNull();
    expect(idTokenSub('a.!!!.c')).toBeNull();
  });
});

describe('apple-revoke — the function shell', () => {
  const read = (rel: string) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  it('is registered with verify_jwt = true, next to an enabled Apple provider', async () => {
    const config = await read('../supabase/config.toml');
    expect(config).toMatch(/\[functions\.apple-revoke\]\s*\nverify_jwt\s*=\s*true/);
    expect(/\[auth\.external\.apple\][^[]*enabled\s*=\s*true/.test(config)).toBe(true);
  });

  it('index.ts is implemented: auth first, 501 when unconfigured, the exchange wired in', async () => {
    const src = await read('../supabase/functions/apple-revoke/index.ts');
    expect(src).not.toContain("error: 'NOT_IMPLEMENTED'");
    expect(src).toContain('getCallerUserId');
    expect(src).toContain("'NOT_CONFIGURED'");
    expect(src).toContain('revokeWithAuthorizationCode');
    expect(src.indexOf('getCallerUserId(req')).toBeLessThan(src.indexOf('revokeWithAuthorizationCode({'));
  });
});

const up = await stackAvailable();

describe.skipIf(!up)('apple-revoke — delete_my_account audit (needs the local stack)', () => {
  let svc: SupabaseClient;

  beforeAll(() => {
    svc = serviceClient();
  });

  it('delete_my_account records whether the account carried an Apple identity', async () => {
    const guest = await guestClient(svc, 'applerevoke');
    const uid = (await guest.auth.getUser()).data.user!.id;

    const del = await appRpc(guest, 'delete_my_account', { p_confirm: 'DELETE' });
    expect(del.error).toBeNull();
    // An email/password guest has no Apple identity, so nothing is owed for them.
    expect((del.data as { apple_revoke_pending: boolean }).apple_revoke_pending).toBe(false);

    const { data } = await svc
      .from('audit_log')
      .select('after')
      .eq('action', 'account.delete')
      .eq('entity_id', uid)
      .single();
    const after = (data as { after: Record<string, unknown> }).after;
    expect(after).toHaveProperty('apple_revoke_pending');
  });
});

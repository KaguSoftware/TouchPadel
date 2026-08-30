/**
 * Auth deep-link parsing. PURE (no RN / expo / supabase imports) so it is unit
 * tested under plain node, like booking/errors.ts.
 *
 * After GoTrue has processed the token embedded in an auth email it redirects
 * the browser to our custom scheme. Three shapes can arrive:
 *
 *   touchpadel://verify-email?code=<auth_code>                  PKCE (flowType: 'pkce')
 *   touchpadel://reset-password#access_token=…&refresh_token=…&type=recovery
 *   touchpadel://verify-email?error=access_denied&error_code=otp_expired&…
 *
 * Which of query / fragment carries the params depends on the flow, so both are
 * read. A link with no recognisable auth payload parses to null: an ordinary
 * `touchpadel://bookings` share link must never be mistaken for a callback.
 */

export type AuthLink =
  | { kind: 'pkce'; path: string; code: string }
  | { kind: 'tokens'; path: string; accessToken: string; refreshToken: string; type: string | null }
  | { kind: 'error'; path: string; code: string; description: string | null };

/** A malformed %-escape must not throw the whole link away. */
function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/** Read an `a=1&b=2` blob into `into`. */
function readParams(blob: string, into: Map<string, string>): void {
  for (const pair of blob.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = decode(eq === -1 ? pair : pair.slice(0, eq));
    if (key) into.set(key, eq === -1 ? '' : decode(pair.slice(eq + 1)));
  }
}

/** Parse an incoming deep link, or null when it carries no auth payload. */
export function parseAuthLink(url: string | null | undefined): AuthLink | null {
  if (!url) return null;
  const schemeEnd = url.indexOf('://');
  if (schemeEnd === -1) return null;
  let rest = url.slice(schemeEnd + 3);

  const params = new Map<string, string>();
  // Fragment first: it may itself contain '?', which would otherwise be taken
  // for the start of the query string.
  const hash = rest.indexOf('#');
  if (hash !== -1) {
    readParams(rest.slice(hash + 1), params);
    rest = rest.slice(0, hash);
  }
  const query = rest.indexOf('?');
  if (query !== -1) {
    readParams(rest.slice(query + 1), params);
    rest = rest.slice(0, query);
  }
  // Expo Go serves the app from exp://<lan-ip>:8081/--/verify-email, so the
  // route is what follows the '/--/' separator rather than the whole authority.
  // A built app has no separator and no host: touchpadel://verify-email.
  const separator = rest.indexOf('/--/');
  const path = (separator === -1 ? rest : rest.slice(separator + 4)).replace(/^\/+|\/+$/g, '');

  // Errors win over everything: GoTrue can send `code` alongside a refusal.
  const error = params.get('error_code') || params.get('error');
  if (error) {
    return {
      kind: 'error',
      path,
      code: error,
      description: params.get('error_description') ?? null,
    };
  }

  const code = params.get('code');
  if (code) return { kind: 'pkce', path, code };

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) {
    return { kind: 'tokens', path, accessToken, refreshToken, type: params.get('type') ?? null };
  }

  return null;
}

/**
 * Recovery links land on a screen OUTSIDE the (auth) group, and a failed one
 * has to be sent somewhere different from a failed sign-up link — so the two
 * have to be told apart. `type` is authoritative when present; otherwise the
 * path we asked GoTrue to redirect to (RESET_REDIRECT) is.
 */
export function isRecoveryLink(link: AuthLink): boolean {
  if (link.kind === 'tokens' && link.type) return link.type === 'recovery';
  return link.path === 'reset-password';
}

export type AuthLinkErrorKey = 'auth.linkExpired' | 'auth.linkInvalid';

/**
 * Map a GoTrue error code (`otp_expired`, `access_denied`, …) or a failed
 * exchange's message onto a message key. Expiry is worth separating: it is the
 * one case where "request a new link" is exactly the right advice.
 */
export function authLinkErrorKey(code: string | null | undefined): AuthLinkErrorKey {
  return code && /expired/i.test(code) ? 'auth.linkExpired' : 'auth.linkInvalid';
}

/**
 * Narrow an untrusted `authError` route param back to a key. Route params are
 * strings from anywhere (including a hand-typed deep link), so the value is
 * checked rather than cast — an unknown one renders nothing at all.
 */
export function linkErrorParam(value: unknown): AuthLinkErrorKey | null {
  return value === 'auth.linkExpired' || value === 'auth.linkInvalid' ? value : null;
}

/**
 * Production security headers for the guest cafe app — Security Layer 1,
 * Block 4 · Web (SEC-25).
 *
 * This is the least-defended surface in the system and the only one with no
 * login: anyone who can see a table sticker can reach it. Until now it shipped
 * ZERO security headers.
 *
 * Split by where each header can physically be set:
 *
 *   STATIC_SECURITY_HEADERS  fixed values, set in next.config.ts `headers()`
 *                            so they cover every response including static
 *                            assets and 404s.
 *   buildCsp()               per-request, because a nonce must be unguessable
 *                            and single-use — so it is set in proxy.ts.
 */

/** Headers whose value never changes. Applied to every route. */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  {
    // Two years, subdomains included, preload-eligible. Once a browser has seen
    // this it will not issue a plaintext request to the domain at all — which
    // is what stops a hostile hotspot in the venue's own cafe from serving a
    // fake menu over http and harvesting table tokens.
    // NOTE: only meaningful over https, and `includeSubDomains` commits EVERY
    // subdomain to https. Confirm before the domain is delegated (Block 0).
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    // Stops the browser second-guessing Content-Type. Without it, a file the
    // guest can influence that is served as text/plain can be sniffed as
    // script and executed.
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    // Clickjacking. `frame-ancestors 'none'` in the CSP is the modern control
    // and is set below; this is the legacy header for older browsers.
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    // Cross-origin requests send only the origin, never the path. The path is
    // where the table token used to live — and still lives in any QR card
    // printed before the cookie exchange landed.
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    // The menu needs none of these. Denying them means a compromised script
    // cannot silently reach for the camera or the guest's location.
    key: 'Permissions-Policy',
    value: [
      'accelerometer=()',
      'autoplay=(self)',
      'camera=()',
      'display-capture=()',
      'encrypted-media=()',
      'fullscreen=(self)',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'payment=()',
      'usb=()',
      'interest-cohort=()',
    ].join(', '),
  },
  {
    // Isolates this origin's browsing context group from popups it opens.
    key: 'Cross-Origin-Opener-Policy',
    value: 'same-origin',
  },
];

/**
 * `/t/*` is stricter than the rest of the site.
 *
 * Even after the cookie exchange strips the token from the address bar, a QR
 * card printed earlier still puts it in the first request's URL. `no-referrer`
 * guarantees that URL is never handed to Google Fonts, to the image CDN, or to
 * PostHog in a `Referer` header.
 */
export const TABLE_ROUTE_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: 'Referrer-Policy', value: 'no-referrer' },
  {
    // A table page is one guest's session. It must never be held in a shared
    // cache, and never restored from bfcache after the session is closed.
    key: 'Cache-Control',
    value: 'no-store, no-cache, must-revalidate, private',
  },
];

/**
 * Build the Content-Security-Policy for one request.
 *
 * `script-src 'nonce-…' 'strict-dynamic'` is the important line. Next's App
 * Router emits inline bootstrap scripts (the RSC flight payload), so
 * `script-src 'self'` alone would break the app — the usual "fix" for that is
 * `'unsafe-inline'`, which disables script CSP entirely and is exactly what
 * this box forbids. A per-request nonce is the only way to allow Next's own
 * inline scripts without allowing an injected one.
 *
 * `'strict-dynamic'` lets a nonced script load its own dependencies (the lazily
 * imported PostHog SDK) without maintaining a host allowlist that browsers
 * would ignore anyway once strict-dynamic is present.
 *
 * KNOWN LOOSENESS, deliberate and documented:
 *  - `style-src 'unsafe-inline'`. The layout inlines the theme + cafe
 *    stylesheets via dangerouslySetInnerHTML, and Google Fonts injects its own
 *    styles. The box requires "no unsafe-inline FOR SCRIPTS", which this
 *    honours; inline CSS is not a script-execution vector here.
 *  - dev adds 'unsafe-eval' because React Refresh needs it. It is branch-gated
 *    on NODE_ENV so it can never reach a production response.
 */
export function buildCsp(nonce: string, opts: { isDev: boolean; supabaseUrl?: string | undefined }): string {
  const { isDev, supabaseUrl } = opts;

  // The app talks to exactly one Supabase project. Naming it — rather than
  // allowing *.supabase.co — means a compromised script cannot exfiltrate to
  // an attacker's own Supabase project, which is otherwise a free, TLS-backed,
  // allowlisted drop box.
  const supabaseOrigin = (() => {
    try {
      return supabaseUrl ? new URL(supabaseUrl).origin : null;
    } catch {
      return null;
    }
  })();

  const connect = [
    "'self'",
    supabaseOrigin,
    // Supabase Realtime rides a WebSocket on the same host.
    supabaseOrigin?.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:'),
    'https://eu.i.posthog.com',
    'https://eu-assets.i.posthog.com',
    isDev ? 'ws:' : null,
  ].filter(Boolean);

  const directives: Record<string, (string | null | undefined)[]> = {
    'default-src': ["'self'"],
    'script-src': [
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      // Ignored by browsers that understand strict-dynamic; present so older
      // ones do not fall back to blocking everything.
      "'self'",
      isDev ? "'unsafe-eval'" : null,
    ],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
    // blob: is Next's image optimizer; data: is the blurred placeholder layers.
    'img-src': ["'self'", 'data:', 'blob:', supabaseOrigin],
    'connect-src': connect,
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    // Belt and braces with HSTS: refuse any subresource that is not https.
    ...(isDev ? {} : { 'upgrade-insecure-requests': [] }),
  };

  return Object.entries(directives)
    .map(([name, values]) => {
      const v = values.filter(Boolean).join(' ');
      return v ? `${name} ${v}` : name;
    })
    .join('; ');
}

/**
 * Cookie carrying the table session, replacing the token in the URL.
 *
 * HttpOnly    script cannot read it, so an XSS cannot exfiltrate the table
 *             identity even though the page still uses it.
 * SameSite    Lax, not Strict: a guest following the QR from a messaging app
 *             arrives cross-site, and Strict would drop the cookie on that
 *             first navigation — which is the only navigation that matters.
 * Secure      omitted in dev only, because http://localhost would otherwise
 *             never receive it.
 */
export const TABLE_COOKIE = 'tp-table';

export function tableCookieOptions(isDev: boolean) {
  return {
    httpOnly: true,
    secure: !isDev,
    sameSite: 'lax' as const,
    path: '/',
    // Matches the server-side table-session inactivity TTL closely enough that
    // a stale cookie is refused by app.open_table_session rather than trusted.
    maxAge: 60 * 60 * 12,
  };
}

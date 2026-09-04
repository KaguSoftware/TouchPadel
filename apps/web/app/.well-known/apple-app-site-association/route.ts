import { NextResponse } from 'next/server';
import { APPLE_APP_ID, LINK_PATHS } from '@/lib/security/applinks';

/**
 * Apple App Site Association — Security Layer 1, Block 4 · Mobile (SEC-18).
 *
 * This file is the PROOF that the iOS app may claim https links on this domain.
 * Without it, auth redirects fall back to the custom `touchpadel://` scheme,
 * which iOS hands to whichever app registered it — with no arbitration. A
 * malicious app installed alongside this one can register the same scheme and
 * receive the OAuth redirect, authorization code included.
 *
 * Served from a route handler rather than public/ for two reasons that both
 * matter: Apple requires `application/json` with NO extension on the path (a
 * static file would be served as `/apple-app-site-association` only by
 * coincidence of the host's MIME config), and this way the app id comes from
 * one place shared with the Android file.
 */
export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json(
    {
      applinks: {
        // `apps: []` is required by the format and must be empty.
        apps: [],
        details: [
          {
            appID: APPLE_APP_ID,
            // Only the auth paths. Scoping this narrowly means the app cannot
            // be handed arbitrary links to the guest site — notably NOT /t/*,
            // the table-session route, which must stay in the browser.
            paths: LINK_PATHS,
          },
        ],
      },
    },
    {
      headers: {
        'content-type': 'application/json',
        // Apple caches this aggressively; a short TTL keeps a fix reachable.
        'cache-control': 'public, max-age=3600',
      },
    },
  );
}

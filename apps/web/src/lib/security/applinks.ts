/**
 * App-link association constants — Security Layer 1, Block 4 · Mobile (SEC-18).
 *
 * Shared by the two /.well-known/ route handlers so the identifiers cannot
 * drift apart, and kept next to the other security config rather than in the
 * route files, where a copy-paste between the iOS and Android versions is the
 * obvious mistake.
 */

/**
 * Apple `appID` is TEAMID.BUNDLEID.
 *
 * The team is `BR42V976FS` (`appleTeamId` in apps/mobile/eas.json). It comes from
 * the Vercel env var `APPLE_TEAM_ID`, which the owner sets; both /.well-known/
 * routes are `force-static`, so the value is read at build time and a change
 * needs a redeploy. Unset, the placeholder cannot accidentally match a real
 * team — Apple team ids are exactly 10 alphanumeric characters — and iOS simply
 * never opens the app on a link.
 */
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID ?? 'TEAMID-UNSET';
const IOS_BUNDLE_ID = 'com.kagu.touchpadel';

export const APPLE_APP_ID = `${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`;

export const ANDROID_PACKAGE = 'com.kagu.touchpadel';

/**
 * SHA-256 fingerprints of the signing certificate(s).
 *
 * EMPTY ON PURPOSE until the real value is known. An empty list fails
 * verification closed — links open in the browser — which is safe. A WRONG
 * fingerprint would also fail, but silently and confusingly, and a copied-from-
 * a-tutorial one would be worse still.
 *
 * Comma-separated so a key rotation can list both old and new during handover.
 */
export const ANDROID_SHA256_FINGERPRINTS = (process.env.ANDROID_SHA256_FINGERPRINTS ?? '')
  .split(',')
  .map((f) => f.trim().toUpperCase())
  .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));

/**
 * The paths the mobile app may claim: the auth links, the open-match invite
 * `/m/<token>` a player shares (docs/design/open-matches/guest.md §4.19, OM-32),
 * and the coach link `/c/<coachId>` the website's "Book in the app" and the
 * app's share sheet hand out (docs/design/coaching/guest.md §4.12), each bare
 * and under both locales, because the proxy's locale hop is a web thing and a
 * link can arrive in any of the three spellings. Where the app does not claim a
 * link (no app, or Android before the Play fingerprints above are published),
 * `/{locale}/m/<token>` renders the web invite page and `/{locale}/c/<id>` the
 * coach's "Open in the app" page instead.
 *
 * Deliberately NOT `/*`. The table-session route `/t/*` must stay in the
 * browser: it is the guest cafe surface, it has no mobile equivalent, and
 * handing those URLs to the app would send the table token through an
 * additional hop for no benefit.
 */
export const LINK_PATHS = [
  '/auth/*',
  '/en/auth/*',
  '/ar/auth/*',
  '/m/*',
  '/en/m/*',
  '/ar/m/*',
  '/c/*',
  '/en/c/*',
  '/ar/c/*',
];

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
 * The team id is unknown: there is no Apple Developer team yet
 * (docs/design/social-signin-2026-09-01.md). `APPLE_TEAM_ID` must be set when
 * one exists. The placeholder cannot accidentally match a real team — Apple
 * team ids are exactly 10 alphanumeric characters.
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
 * The paths the mobile app may claim.
 *
 * Deliberately NOT `/*`. The table-session route `/t/*` must stay in the
 * browser: it is the guest cafe surface, it has no mobile equivalent, and
 * handing those URLs to the app would send the table token through an
 * additional hop for no benefit.
 */
export const LINK_PATHS = ['/auth/*', '/en/auth/*', '/ar/auth/*'];

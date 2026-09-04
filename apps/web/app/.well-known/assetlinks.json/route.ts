import { NextResponse } from 'next/server';
import { ANDROID_PACKAGE, ANDROID_SHA256_FINGERPRINTS } from '@/lib/security/applinks';

/**
 * Android Digital Asset Links — Security Layer 1, Block 4 · Mobile (SEC-18).
 *
 * The Android half of the same proof. `autoVerify: true` in app.config.ts makes
 * the OS fetch this file and refuse to let any other app claim these links; with
 * no file, Android falls back to a disambiguation dialog that any installed app
 * can appear in — which is the hijack this prevents.
 *
 * ⚠ INCOMPLETE UNTIL THE SIGNING FINGERPRINT IS FILLED IN.
 * `sha256_cert_fingerprints` must list the SHA-256 of the certificate that
 * actually signs the shipped APK/AAB. With EAS managed credentials that is the
 * Google Play App Signing key, readable from
 *   Play Console → Setup → App integrity → App signing key certificate
 * or `eas credentials`. An empty list means verification FAILS CLOSED — links
 * open in the browser — which is the correct behaviour while unknown, and far
 * better than listing a wrong fingerprint and claiming a verification that is
 * not real.
 */
export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: ANDROID_PACKAGE,
          sha256_cert_fingerprints: ANDROID_SHA256_FINGERPRINTS,
        },
      },
    ],
    {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=3600',
      },
    },
  );
}

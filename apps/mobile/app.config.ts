import type { ConfigContext, ExpoConfig } from 'expo/config';

// Env comes from EXPO_PUBLIC_* per EAS profile (design-arch.md §7 env table).
// Local: .env (see .env.example). Staging/production: eas.json profile env blocks.

/**
 * Google Sign-In (vendor addition 2026-09-01). The URL scheme the Google iOS SDK
 * needs to return to the app is the iOS OAuth client id REVERSED — derived here
 * so the client id stays the single source of truth (no third env var).
 */
// = src/features/auth/social.ts isGoogleClientId (repeated: this file stays import-free).
// A REPLACE_* placeholder is non-empty but NOT a client id — treated as unset, so an
// EAS build with the committed eas.json placeholders fails HERE, not on the device.
const GOOGLE_CLIENT_ID_RE = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
const rawGoogleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const googleIosClientId =
  rawGoogleIosClientId && GOOGLE_CLIENT_ID_RE.test(rawGoogleIosClientId)
    ? rawGoogleIosClientId
    : undefined;
const googleIosUrlScheme = googleIosClientId
  ? 'com.googleusercontent.apps.' + googleIosClientId.replace(/\.apps\.googleusercontent\.com$/, '')
  : undefined;
/**
 * The domain that proves this app owns its auth links — Security Layer 1,
 * Block 4 · Mobile (SEC-18).
 *
 * It does not exist yet: the domain is a Block 0 item still waiting on the
 * client (SEC-06), and it blocks the privacy URL, HSTS and the printed QR cards
 * as well as this. The placeholder is deliberately a `.invalid` host — reserved
 * by RFC 2606 and guaranteed never to resolve — so an unconfigured build fails
 * the association cleanly instead of pointing at somebody else's domain.
 *
 * Set EXPO_PUBLIC_LINK_DOMAIN (and the matching NEXT_PUBLIC_SITE_URL on the web
 * app, which serves the two association files) the day DNS is delegated.
 */
const LINK_DOMAIN = process.env.EXPO_PUBLIC_LINK_DOMAIN ?? 'touchpadel.invalid';

// EAS sets EAS_BUILD=true in every build job. A binary without the scheme has a
// Google button that never returns to the app, so an EAS build with the env
// unset fails LOUDLY here, at config time — never at app runtime (see
// src/lib/supabase.ts configError for why runtime throws are banned).
if (process.env.EAS_BUILD === 'true' && !googleIosUrlScheme) {
  throw new Error(
    'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is unset or still a placeholder for this EAS profile — put the real ' +
      'iOS OAuth client id (<project-number>-<hash>.apps.googleusercontent.com) in the eas.json env block',
  );
}
if (!googleIosUrlScheme) {
  // Expo Go / CI bundle / local without Google credentials: the plugin is
  // skipped and the app hides the Google button (features/auth/providers/google.ts).
  console.warn(
    '[app.config] EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID unset or a placeholder — Google sign-in unavailable in this build',
  );
}

const plugins: NonNullable<ExpoConfig['plugins']> = [
  'expo-router',
  'expo-secure-store',
  // THE NATIVE RTL FLAG IS PINNED LEFT-TO-RIGHT, ON EVERY LAUNCH, BEFORE REACT.
  //
  // Layout direction in this app is application state: src/i18n/direction.tsx
  // puts the chosen language's direction on the root view and Fabric mirrors
  // the whole tree live, no reload. React Native's own flag (RCTI18nUtil /
  // I18nUtil) is a boot-time constant the running bundle cannot observe, and
  // when RTL it makes Fabric rewrite every physical `left`/`right` into
  // start/end for the whole surface — a second render model for the same
  // language. So it stays LTR:
  //
  // `supportsRTL: false` makes expo-localization's OnCreate write
  // RCTI18nUtil_allowRTL=false before React loads, on every launch — and on
  // iOS RCTI18nUtil_forceRTL=false as well (LocalizationModule.swift), which
  // retires the forceRTL(true) older builds persisted. Android's module
  // (LocalizationModule.kt) writes forceRTL only from a `forcesRTL` option,
  // which must NEVER be passed: on iOS that branch sets allowRTL=true and
  // derives forceRTL from the DEVICE language. So on Android the retired
  // forceRTL(true) of an old install is cleared by index.js's JS pin instead,
  // and that install's first launch after the update may sample an RTL root
  // once — harmless: the root view carries its own direction, the only
  // physical props live in an LtrIsland, and the flag is never read in JS.
  // Expo Go carries no Info.plist keys, so there the JS pin does all of it.
  //
  // With only `supportsRTL: true`, forceRTL would follow the device language
  // and overwrite the in-app choice at every start — the original bug.
  ['expo-localization', { supportsRTL: false }],
  ['expo-splash-screen', { backgroundColor: '#FFFFFF', resizeMode: 'contain' }],
  // Sign in with Apple entitlement (com.apple.developer.applesignin). EAS Build
  // syncs the capability to the App ID on every build (EXPO_NO_CAPABILITY_SYNC opts out).
  'expo-apple-authentication',
];
if (googleIosUrlScheme) {
  plugins.push(['react-native-nitro-google-signin', { iosUrlScheme: googleIosUrlScheme }]);
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'TouchPadel',
  slug: 'touchpadel',
  scheme: 'touchpadel',
  version: '0.1.0',
  // EAS project @parsa-mansouri/touchpadel, created by `eas init` on 2026-09-01 on
  // Parsa's PERSONAL Expo account (the org question came before this line was set).
  // Handover item: transfer the project to a Kagu org in expo.dev, then change this.
  owner: 'parsa-mansouri',
  // Native only — no web target. Declared so 'expo export' does not demand
  // react-native-web, and so nothing accidentally ships a browser bundle.
  platforms: ['ios', 'android'],
  orientation: 'portrait',
  // The app has its own Light/Dark toggle (design). 'automatic' lets the
  // theme drive the native scheme (Appearance.setColorScheme in ThemeProvider)
  // so keyboards, alerts and share sheets follow it instead of staying light.
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  // EAS Update (expo-updates, added eba8353 for the eas.json channels): store
  // binaries poll this URL on their profile's channel. 'appVersion' pins each
  // store version (0.1.0) to its own update runtime, so an OTA can never land
  // on incompatible natives. The development profile has no channel — the dev
  // client ignores this block.
  updates: {
    url: 'https://u.expo.dev/d9597f8e-79bb-4bc2-882e-c44c3a013045',
    // ── EAS Update code signing — Security Layer 1, Block 4 · Mobile (SEC-23) ──
    //
    // An OTA channel pushes JavaScript to every guest phone with NO store
    // review in between. That makes it the highest-leverage credential in the
    // mobile lane: whoever can publish an update owns the app on every device
    // that has installed it. Until now the only thing standing there was one
    // Expo account password.
    //
    // With this certificate embedded in the BINARY, expo-updates verifies the
    // signature on every manifest before applying it and REJECTS anything not
    // signed by the matching private key. Compromising the Expo account is then
    // no longer sufficient — the attacker also needs a key that was never on
    // Expo's servers.
    //
    // The private key is NOT in this repository and must never be. It lives in
    // the password manager and in EAS as a secret; `eas update` is given it with
    // --private-key-path at publish time. See docs/security/eas-update-signing.md.
    //
    // NOTE: signing takes effect for clients running a build that CONTAINS this
    // certificate. Binaries already installed without it keep accepting unsigned
    // manifests, so this must ship in a store release before it protects anyone.
    codeSigningCertificate: './certs/certificate.pem',
    codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
  },
  runtimeVersion: { policy: 'appVersion' },
  backgroundColor: '#FFFFFF',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.kagu.touchpadel',
    // Universal Links — Security Layer 1, Block 4 · Mobile (SEC-18).
    //
    // A custom scheme (touchpadel://) is claimed by whichever app registered it
    // and iOS does NOT arbitrate: a malicious app installed alongside this one
    // can register the same scheme and receive the auth redirect, code included.
    // Universal Links cannot be hijacked that way — the association is proved by
    // a file served over https from a domain the attacker does not control.
    //
    // `applinks:` only. No `webcredentials:` — this app does not use the iOS
    // shared-credential API, and listing it would invite a password autofill
    // surface that nothing here handles.
    //
    // Domain comes from the environment because it does not exist yet (Block 0,
    // SEC-06 — waiting on the client). Until it is delegated, the entry resolves
    // to the placeholder and Apple simply fails the association: the app falls
    // back to the custom scheme, which is exactly today's behaviour. Nothing
    // breaks by landing this early, and the day DNS lands it starts working.
    associatedDomains: [`applinks:${LINK_DOMAIN}`],
    // Sign in with Apple (owner decision D2, 2026-09-01: iOS only, native).
    usesAppleSignIn: true,
    infoPlist: {
      // Without this every App Store Connect upload stalls on the manual
      // export-compliance question. The app uses only standard HTTPS.
      ITSAppUsesNonExemptEncryption: false,
      // Arabic is a shipped locale, not a runtime accident — iOS needs to be
      // told, and App Store Connect gates AR listing metadata on it.
      CFBundleLocalizations: ['en', 'ar'],
    },
  },
  android: {
    package: 'com.kagu.touchpadel',
    // App Links — the Android half of the same argument (SEC-18).
    //
    // `autoVerify: true` is the part that matters: without it this is an
    // ordinary intent filter and Android shows a disambiguation dialog that any
    // other app can appear in. With it, Android fetches
    // /.well-known/assetlinks.json from the domain and refuses to let any other
    // app claim these links.
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: LINK_DOMAIN, pathPrefix: '/auth' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  plugins,
  extra: {
    // NOTE: `supabaseUrl` / `supabaseAnonKey` used to be mirrored here and read
    // by nothing (expo-constants is imported in zero files). The live path is
    // process.env.EXPO_PUBLIC_* inlined at build time — see src/lib/supabase.ts.
    // Two sources of truth, one of them dead, is how the wrong one gets edited.
    // Social sign-in reads EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID / _IOS_CLIENT_ID the
    // same way; Apple needs no env at all.
    //
    // From `eas init` (2026-09-01): https://expo.dev/accounts/parsa-mansouri/projects/touchpadel
    eas: { projectId: 'd9597f8e-79bb-4bc2-882e-c44c3a013045' },
  },
});

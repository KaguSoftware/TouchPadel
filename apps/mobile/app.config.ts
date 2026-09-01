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
  rawGoogleIosClientId && GOOGLE_CLIENT_ID_RE.test(rawGoogleIosClientId) ? rawGoogleIosClientId : undefined;
const googleIosUrlScheme = googleIosClientId
  ? 'com.googleusercontent.apps.' + googleIosClientId.replace(/\.apps\.googleusercontent\.com$/, '')
  : undefined;
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
  // THE RTL FIX. `extra.supportsRTL` (which this file used to set) has not
  // been read from `extra` since ~SDK 44 — it was inert, so the natively
  // configured half of the app's central bilingual requirement was simply
  // absent. This is where it actually lives.
  ['expo-localization', { supportsRTL: true }],
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
  // TODO(eas init): `owner: '<kagu expo org slug>'` BEFORE the first `eas init`,
  // or the project binds to whoever runs it (mobile audit §2.2).
  // Native only — no web target. Declared so 'expo export' does not demand
  // react-native-web, and so nothing accidentally ships a browser bundle.
  platforms: ['ios', 'android'],
  orientation: 'portrait',
  // The app has its own Light/Dark toggle (design). 'automatic' lets the
  // theme drive the native scheme (Appearance.setColorScheme in ThemeProvider)
  // so keyboards, alerts and share sheets follow it instead of staying light.
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  backgroundColor: '#FFFFFF',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.kagu.touchpadel',
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
    // TODO: eas.projectId once the EAS project is created (design-delivery.md W1).
  },
});

import type { ConfigContext, ExpoConfig } from 'expo/config';

// Env comes from EXPO_PUBLIC_* per EAS profile (design-arch.md §7 env table).
// Local: .env (see .env.example). Staging/production: eas.json profile env blocks.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'TouchPadel',
  slug: 'touchpadel',
  scheme: 'touchpadel',
  version: '0.1.0',
  // Native only — no web target. Declared so 'expo export' does not demand
  // react-native-web, and so nothing accidentally ships a browser bundle.
  platforms: ['ios', 'android'],
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  backgroundColor: '#FFFFFF',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.kagu.touchpadel',
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
  plugins: [
    'expo-router',
    'expo-secure-store',
    // THE RTL FIX. `extra.supportsRTL` (which this file used to set) has not
    // been read from `extra` since ~SDK 44 — it was inert, so the natively
    // configured half of the app's central bilingual requirement was simply
    // absent. This is where it actually lives.
    ['expo-localization', { supportsRTL: true }],
    ['expo-splash-screen', { backgroundColor: '#FFFFFF', resizeMode: 'contain' }],
  ],
  extra: {
    // NOTE: `supabaseUrl` / `supabaseAnonKey` used to be mirrored here and read
    // by nothing (expo-constants is imported in zero files). The live path is
    // process.env.EXPO_PUBLIC_* inlined at build time — see src/lib/supabase.ts.
    // Two sources of truth, one of them dead, is how the wrong one gets edited.
    //
    // TODO: eas.projectId once the EAS project is created (design-delivery.md W1).
  },
});

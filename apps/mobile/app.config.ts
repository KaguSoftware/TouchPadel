import type { ConfigContext, ExpoConfig } from 'expo/config';

// Env comes from EXPO_PUBLIC_* per EAS profile (design-arch.md §7 env table).
// Local: .env (see .env.example). Staging/production: eas.json profile env blocks.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'TouchPadel',
  slug: 'touchpadel',
  scheme: 'touchpadel',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.kagu.touchpadel',
  },
  android: {
    package: 'com.kagu.touchpadel',
  },
  plugins: ['expo-router', 'expo-secure-store'],
  extra: {
    // RTL: Arabic is a first-class locale (HANDOFF: bilingual EN/AR, full RTL).
    // supportsRTL is read by Expo tooling; runtime side is I18nManager.allowRTL(true)
    // in app/_layout.tsx. Every demo runs once in Arabic (HANDOFF conventions).
    supportsRTL: true,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    // TODO: eas.projectId once the EAS project is created (design-delivery.md W1, mobile-eas.yml).
  },
});

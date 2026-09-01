import { useEffect, useState } from 'react';
import { I18nManager, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import type { ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import * as SplashScreen from 'expo-splash-screen';
import * as Font from 'expo-font';
import { useFonts } from 'expo-font';
import {
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  Archivo_900Black,
} from '@expo-google-fonts/archivo';
import {
  Mulish_400Regular,
  Mulish_600SemiBold,
  Mulish_700Bold,
  Mulish_800ExtraBold,
} from '@expo-google-fonts/mulish';
import {
  Cairo_400Regular,
  Cairo_600SemiBold,
  Cairo_700Bold,
  Cairo_800ExtraBold,
  Cairo_900Black,
} from '@expo-google-fonts/cairo';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { onlineManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { makeT } from '@touch/i18n';
import { queryClient, persistOptions, startFocusLifecycle } from '../src/lib/queryClient';
import { configError, startAuthRefreshLifecycle } from '../src/lib/supabase';
import { loadBootPrefs, reconcileRtl, reloadForRtl, type BootPrefs } from '../src/lib/bootPrefs';
import { addBreadcrumb, captureException } from '../src/lib/telemetry';
import { LocaleProvider, useLocale } from '../src/i18n/LocaleProvider';
import { AuthProvider } from '../src/features/auth/context';
import { useAuthDeepLink } from '../src/features/auth/useAuthDeepLink';
import { ErrorState, OfflineBanner } from '../src/components/states';
import { ToastProvider } from '../src/components/overlays';
import { palettes, ThemeProvider, useTheme } from '../src/theme';

/**
 * `/` is owned by (tabs)/index.tsx. A separate app/index.tsx used to redirect
 * there, which made `/` ambiguous and cost a mount → redirect → mount flash on
 * every cold start. Deep links into (auth)/(gated) get the tabs beneath them.
 */
export const unstable_settings = { initialRouteName: '(tabs)' };

// Arabic is a first-class locale (bilingual EN/AR, full RTL). The direction
// itself is reconciled with the stored language in src/lib/bootPrefs.ts.
I18nManager.allowRTL(true);
// Splash stays up until boot prefs + the brand fonts are in (no flash of
// fallback type, no light→dark flash, no en→ar flash).
void SplashScreen.preventAutoHideAsync().catch(() => {});

const LATIN_FONTS = {
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  Archivo_900Black,
  Mulish_400Regular,
  Mulish_600SemiBold,
  Mulish_700Bold,
  Mulish_800ExtraBold,
};
const ARABIC_FONTS = {
  Cairo_400Regular,
  Cairo_600SemiBold,
  Cairo_700Bold,
  Cairo_800ExtraBold,
  Cairo_900Black,
};

/**
 * Reveal a screen that renders INSTEAD of AppRoot.
 *
 * `SplashScreen.hideAsync()` is only reached from AppRoot's font effect, so every
 * path that returns before AppRoot mounts — a config failure, a render crash —
 * left the splash (`backgroundColor: '#FFFFFF'`, app.config.ts) covering its own
 * error message forever. That is precisely the "hard white screen with no
 * message" the configError note in src/lib/supabase.ts exists to prevent, put
 * back by the boot gate. Guarded by src/lib/__tests__/reliability.test.ts.
 */
function useRevealSplash() {
  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => {});
  }, []);
}

/**
 * expo-router renders this INSTEAD of the layout when a render throws anywhere
 * beneath it. It renders OUTSIDE the providers, so it builds its own translator
 * and a fonts-aware theme (an unregistered family here would red-box on iOS).
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const t = makeT(I18nManager.isRTL ? 'ar' : 'en');
  useRevealSplash();
  useEffect(() => {
    captureException(error, { scope: 'render', fatal: true });
  }, [error]);
  return (
    <ThemeProvider fontsReady={Font.isLoaded('Archivo_900Black') || Font.isLoaded('Cairo_900Black')}>
      <View style={styles.fill}>
        <ErrorState
          title={t('errors.crashTitle')}
          message={t('errors.crashBody')}
          retryLabel={t('common.retry')}
          onRetry={() => void retry()}
        />
        {__DEV__ ? <Text style={styles.devDetail}>{String(error?.message ?? error)}</Text> : null}
      </View>
    </ThemeProvider>
  );
}

/** Missing build-time env: a configuration failure, rendered rather than crashed. */
function ConfigErrorScreen() {
  const t = makeT(I18nManager.isRTL ? 'ar' : 'en');
  useRevealSplash();
  return (
    <ThemeProvider fontsReady={false}>
      <View style={styles.fill}>
        <ErrorState title={t('errors.configTitle')} message={t('errors.configBody')} retryLabel="" />
        {__DEV__ ? <Text style={styles.devDetail}>{configError}</Text> : null}
      </View>
    </ThemeProvider>
  );
}

function RootStack() {
  // Inside the navigator, so the emailed verification / recovery link can be
  // exchanged for a session and a dead link can route somewhere it is explained.
  useAuthDeepLink();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(gated)" />
      <Stack.Screen name="availability" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="reset-password" />
    </Stack>
  );
}

/** Offline bar, driven by the same onlineManager the query layer uses. */
function ConnectivityBanner() {
  const { t } = useLocale();
  const [online, setOnline] = useState(() => onlineManager.isOnline());
  useEffect(() => onlineManager.subscribe(setOnline), []);
  if (online) return null;
  return <OfflineBanner message={t('errors.offline')} />;
}

/** Status bar + native root background follow the active theme. */
function ThemedChrome() {
  const { appearance, colors } = useTheme();
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
  }, [colors.bg]);
  return <StatusBar style={appearance === 'dark' ? 'light' : 'dark'} />;
}

/**
 * Boot gate: resolve the stored language + appearance BEFORE the first frame,
 * and make sure the native layout direction matches the language (reloading
 * once in development if it does not). Nothing paints until this is known.
 */
export default function RootLayout() {
  const [prefs, setPrefs] = useState<BootPrefs | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadBootPrefs()
      .then((p) => {
        if (cancelled) return;
        if (reconcileRtl(p.locale) && reloadForRtl()) return; // reloading into the right direction
        setPrefs(p);
      })
      .catch((error) => {
        captureException(error, { scope: 'boot.prefs' });
        if (!cancelled) setPrefs({ appearance: 'light', locale: 'en', localeFromStore: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (configError) return <ConfigErrorScreen />;
  if (!prefs) return null; // splash is still covering us
  return <AppRoot prefs={prefs} />;
}

function AppRoot({ prefs }: { prefs: BootPrefs }) {
  // Only the active script blocks first paint (8 Latin faces or 5 Cairo); the
  // other loads in the background so a language switch has its faces ready.
  const primary = prefs.locale === 'ar' ? ARABIC_FONTS : LATIN_FONTS;
  const secondary = prefs.locale === 'ar' ? LATIN_FONTS : ARABIC_FONTS;
  const [fontsLoaded, fontsError] = useFonts(primary);

  // Token refresh follows the foreground lifecycle; query focus follows it too.
  useEffect(() => {
    addBreadcrumb('app.start', { locale: prefs.locale, appearance: prefs.appearance });
    const stopAuth = startAuthRefreshLifecycle();
    const stopFocus = startFocusLifecycle();
    return () => {
      stopAuth();
      stopFocus();
    };
  }, [prefs.locale, prefs.appearance]);

  useEffect(() => {
    if (fontsLoaded || fontsError) {
      // A failed font download must not hold the splash forever — the theme
      // falls back to system faces and the app still works.
      if (fontsError) captureException(fontsError, { scope: 'fonts.load' });
      void SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontsError]);

  useEffect(() => {
    if (!fontsLoaded) return;
    Font.loadAsync(secondary).catch((error) => captureException(error, { scope: 'fonts.secondary' }));
  }, [fontsLoaded, secondary]);

  if (!fontsLoaded && !fontsError) return null; // splash is still covering us

  return (
    // Rehydrates the query cache from disk before first paint, so a cold start
    // shows real courts/bookings instead of spinners — and still works with no
    // network at all.
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <SafeAreaProvider>
        <LocaleProvider initialLocale={prefs.locale}>
          <ThemeProvider initialAppearance={prefs.appearance} fontsReady={fontsLoaded && !fontsError}>
            <AuthProvider>
              <ToastProvider>
                <ThemedChrome />
                <RootStack />
                <ConnectivityBanner />
              </ToastProvider>
            </AuthProvider>
          </ThemeProvider>
        </LocaleProvider>
      </SafeAreaProvider>
    </PersistQueryClientProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palettes.light.bg },
  devDetail: {
    fontSize: 11,
    color: palettes.light.mut,
    paddingStart: 16,
    paddingEnd: 16,
    paddingBottom: 24,
    textAlign: 'center',
  },
});

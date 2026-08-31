import { useEffect, useState } from 'react';
import { I18nManager, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import type { ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import * as SplashScreen from 'expo-splash-screen';
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
import { addBreadcrumb, captureException } from '../src/lib/telemetry';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { AuthProvider } from '../src/features/auth/context';
import { useAuthDeepLink } from '../src/features/auth/useAuthDeepLink';
import { ErrorState, OfflineBanner } from '../src/components/states';
import { ToastProvider } from '../src/components/overlays';
import { palettes, ThemeProvider, useTheme } from '../src/theme';

// Arabic is a first-class locale (bilingual EN/AR, full RTL).
I18nManager.allowRTL(true);
// Splash stays up until the brand fonts are in (no flash of fallback type).
void SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * expo-router renders this INSTEAD of the layout when a render throws anywhere
 * beneath it. It renders OUTSIDE the providers, so it cannot use useLocale or
 * useTheme; it builds its own translator and uses the static light palette.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const t = makeT(I18nManager.isRTL ? 'ar' : 'en');
  useEffect(() => {
    captureException(error, { scope: 'render', fatal: true });
  }, [error]);
  return (
    <View style={styles.fill}>
      <ErrorState
        title={t('errors.crashTitle')}
        message={t('errors.crashBody')}
        retryLabel={t('common.retry')}
        onRetry={() => void retry()}
      />
      {__DEV__ ? <Text style={styles.devDetail}>{String(error?.message ?? error)}</Text> : null}
    </View>
  );
}

/** Missing build-time env: a configuration failure, rendered rather than crashed. */
function ConfigErrorScreen() {
  const t = makeT(I18nManager.isRTL ? 'ar' : 'en');
  return (
    <View style={styles.fill}>
      <ErrorState title={t('errors.configTitle')} message={t('errors.configBody')} retryLabel="" />
      {__DEV__ ? <Text style={styles.devDetail}>{configError}</Text> : null}
    </View>
  );
}

function RootStack() {
  // Inside the navigator, so the emailed verification / recovery link can be
  // exchanged for a session and a dead link can route somewhere it is explained.
  useAuthDeepLink();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(gated)" />
    </Stack>
  );
}

/** Offline bar, driven by the same onlineManager the query layer uses. */
function ConnectivityBanner() {
  const t = makeT(I18nManager.isRTL ? 'ar' : 'en');
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

export default function RootLayout() {
  const [fontsLoaded, fontsError] = useFonts({
    Archivo_600SemiBold,
    Archivo_700Bold,
    Archivo_800ExtraBold,
    Archivo_900Black,
    Mulish_400Regular,
    Mulish_600SemiBold,
    Mulish_700Bold,
    Mulish_800ExtraBold,
    Cairo_400Regular,
    Cairo_600SemiBold,
    Cairo_700Bold,
    Cairo_800ExtraBold,
    Cairo_900Black,
  });

  // Token refresh follows the foreground lifecycle; query focus follows it too.
  useEffect(() => {
    addBreadcrumb('app.start');
    const stopAuth = startAuthRefreshLifecycle();
    const stopFocus = startFocusLifecycle();
    return () => {
      stopAuth();
      stopFocus();
    };
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontsError) {
      // A failed font download must not hold the splash forever — the stacks
      // fall back to system faces and the app still works.
      if (fontsError) captureException(fontsError, { scope: 'fonts.load' });
      void SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontsError]);

  if (configError) return <ConfigErrorScreen />;
  if (!fontsLoaded && !fontsError) return null; // splash is still covering us

  return (
    // Rehydrates the query cache from disk before first paint, so a cold start
    // shows real courts/bookings instead of spinners — and still works with no
    // network at all.
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <SafeAreaProvider>
        <LocaleProvider>
          <ThemeProvider>
            <AuthProvider>
              <ToastProvider>
                <ThemedChrome />
                <ConnectivityBanner />
                <RootStack />
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

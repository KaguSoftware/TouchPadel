import { useEffect, useState } from 'react';
import { I18nManager, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import type { ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { onlineManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { makeT } from '@touch/i18n';
import { queryClient, persistOptions, startFocusLifecycle } from '../src/lib/queryClient';
import { configError, startAuthRefreshLifecycle } from '../src/lib/supabase';
import { addBreadcrumb, captureException } from '../src/lib/telemetry';
import { LocaleProvider, useLocale } from '../src/i18n/LocaleProvider';
import { AuthProvider } from '../src/features/auth/context';
import { ErrorState, OfflineBanner } from '../src/components/states';
import { theme } from '../src/theme';

// Arabic is a first-class locale (bilingual EN/AR, full RTL).
I18nManager.allowRTL(true);
// Paint the root the app's own colour so the area behind the Android system
// bars is not black under SDK 54's always-on edge-to-edge.
void SystemUI.setBackgroundColorAsync(theme.bg).catch(() => {});

/**
 * expo-router renders this INSTEAD of the layout when a render throws anywhere
 * beneath it. Previously there was no error boundary anywhere in the app, so
 * any render throw — a non-integer price reaching formatIQD, a malformed
 * opening-hours row reaching buildSlotGrid, an Intl failure on Hermes — was an
 * unrecoverable blank screen with nothing logged.
 *
 * It renders OUTSIDE the providers, so it cannot use useLocale; it builds its
 * own translator instead.
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
      <ErrorState
        title={t('errors.configTitle')}
        message={t('errors.configBody')}
        retryLabel=""
      />
      {__DEV__ ? <Text style={styles.devDetail}>{configError}</Text> : null}
    </View>
  );
}

function RootStack() {
  const { t } = useLocale();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(app)" options={{ headerShown: false }} />
      <Stack.Screen name="reset-password" options={{ title: t('auth.resetPasswordTitle') }} />
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

export default function RootLayout() {
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

  if (configError) return <ConfigErrorScreen />;

  return (
    // Rehydrates the query cache from disk before first paint, so a cold start
    // shows real courts/bookings instead of spinners — and still works with no
    // network at all.
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <SafeAreaProvider>
        <LocaleProvider>
          <AuthProvider>
            {/* The app is pinned to a light palette, so `auto` (which reads the
                SYSTEM scheme) painted light glyphs onto a white background —
                an invisible status bar on every dark-mode device. */}
            <StatusBar style="dark" />
            <ConnectivityBanner />
            <RootStack />
          </AuthProvider>
        </LocaleProvider>
      </SafeAreaProvider>
    </PersistQueryClientProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: theme.bg },
  devDetail: {
    fontSize: 11,
    color: theme.mutedFg,
    paddingStart: 16,
    paddingEnd: 16,
    paddingBottom: 24,
    textAlign: 'center',
  },
});

import { useCallback, useEffect, useState } from 'react';
import { I18nManager, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useRootNavigationState } from 'expo-router';
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
import { LocaleDirContext } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { onlineManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { makeT } from '@touch/i18n';
import { queryClient, persistOptions, startFocusLifecycle } from '../src/lib/queryClient';
import { configError, startAuthRefreshLifecycle } from '../src/lib/supabase';
import {
  clearResumeRoute,
  loadBootPrefs,
  readResumeRoute,
  reconcileRtl,
  reloadForRtl,
  type BootPrefs,
  type ResumeRoute,
} from '../src/lib/bootPrefs';
import { addBreadcrumb, captureException } from '../src/lib/telemetry';
import { LocaleProvider, useLocale } from '../src/i18n/LocaleProvider';
import { useNativeHeaderOptions } from '../src/navigation/headerOptions';
import { AuthProvider } from '../src/features/auth/context';
import { useAuthDeepLink } from '../src/features/auth/useAuthDeepLink';
import { ErrorState, OfflineBanner } from '../src/components/states';
import { LocaleSwitchOverlay, ToastProvider } from '../src/components/overlays';
import { palettes, ThemeProvider, useTheme } from '../src/theme';

/**
 * `/` is owned by (tabs)/index.tsx. A separate app/index.tsx used to redirect
 * there, which made `/` ambiguous and cost a mount → redirect → mount flash on
 * every cold start. Deep links into the pushed screens get the tabs beneath them.
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
    <ThemeProvider
      fontsReady={Font.isLoaded('Archivo_900Black') || Font.isLoaded('Cairo_900Black')}
    >
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
        <ErrorState
          title={t('errors.configTitle')}
          message={t('errors.configBody')}
          retryLabel=""
        />
        {__DEV__ ? <Text style={styles.devDetail}>{configError}</Text> : null}
      </View>
    </ThemeProvider>
  );
}

function RootStack({ resume }: { resume: ResumeRoute | null }) {
  // Inside the navigator, so the emailed verification / recovery link can be
  // exchanged for a session and a dead link can route somewhere it is explained.
  useAuthDeepLink();
  // True only for the frames between mount and the restored screen landing.
  const [restoring, setRestoring] = useState(resume !== null);
  // Stable identity: it sits in the resume effect's deps, and a fresh arrow
  // each render would re-run that effect on every re-render.
  const endRestore = useCallback(() => setRestoring(false), []);
  const { dir } = useLocale();
  // Real native bars on every pushed screen. The tabs draw the native tab bar
  // instead, and (auth) is a nested stack that configures its own.
  const header = useNativeHeaderOptions();
  return (
    /**
     * THE ARABIC BACK CHEVRON.
     *
     * react-navigation reads the bar's direction from `LocaleDirContext`, which
     * `NavigationContainer` fills from `I18nManager.getConstants().isRTL`.
     * expo-router does not expose that container's `direction` prop, and the
     * native flag is a BOOT-TIME constant: it only flips on the JS load after
     * `forceRTL` (see `reconcileRtl`). So the container samples it while the
     * container is still mounting, the bar is told `ltr`, and UIKit lays the
     * back item out against the wrong edge — the chevron ends up off-frame
     * while the label, which is centred in the item, still shows.
     *
     * Driving it from OUR locale removes the boot-order dependency entirely:
     * `dir` comes from the chosen language, not from a native flag that lags a
     * launch behind it.
     */
    <LocaleDirContext.Provider value={dir}>
      <ResumeAfterLocaleSwitch resume={resume} onDone={endRestore} />
      {/* A restored screen must not slide in: it is where the user already was,
          not somewhere they just navigated. Suppressed for the restore itself
          and re-enabled the moment it lands, so the user's own navigation on
          this launch still animates. */}
      <Stack screenOptions={restoring ? { ...header, animation: 'none' } : header}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* Formerly the (auth) group. Flattened for the same reason as (gated):
          a screen pushed from the tabs was the first entry of a nested stack,
          so UIKit drew no back item and a JS stand-in had to fill in. Each
          screen carries `RequireNoSession` in place of the layout's redirect. */}
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="verify-email" options={{ headerShown: false }} />
        <Stack.Screen name="verify-result" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="availability" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="profile-edit" />
        <Stack.Screen name="change-password" />
        {/* Formerly the (gated) group, flattened onto the root stack so that
          every push leaves real history behind it and UIKit draws its OWN back
          item — the same one, animated, on every screen. Each carries its own
          `RequireSession` in place of the group layout's guard. */}
        <Stack.Screen name="review" />
        <Stack.Screen name="booking/[id]" />
        <Stack.Screen name="success" options={{ headerShown: false }} />
        <Stack.Screen name="reset-password" />
      </Stack>
    </LocaleDirContext.Provider>
  );
}

/**
 * Puts the user back where they were before a language switch reloaded the
 * bundle, with no visible detour through the tabs.
 *
 * `path` is already resolved (read during boot, before the first frame), so the
 * only job here is to dispatch it the instant the router can accept it.
 *
 * That instant is NOT mount. `router.push` from a layout effect during the
 * navigator's own mount commit dispatches into a root navigation state that
 * does not exist yet, and the app hangs on a splash that never lifts. So we
 * wait for `useRootNavigationState().key`, which is undefined until the root
 * navigator is mounted AND ready — the same guard expo-router's own docs use
 * for redirect-on-boot. It resolves on the very next commit, still behind the
 * splash (AppRoot's font effect lifts that afterwards), so the restored screen
 * is up before anything is visible.
 *
 * `navigate`, not `push`. A push appends to whatever stack happens to exist,
 * and the double mount above leaves a second, EMPTY root — the push landed
 * there and produced a stack of exactly one screen, with no tabs beneath it
 * and a back chevron that had nothing to pop to. `navigate` resolves the href
 * against the route tree instead, so the restored screen arrives with its
 * proper hierarchy underneath and back behaves as it did before the switch.
 *
 * The TAB is restored first, and separately, because `navigate` rebuilds the
 * tabs at their default (Book): restoring only the destination left the user
 * backing out of Settings into a tab they had never been on.
 *
 * It takes TWO COMMITS, which is why this is a small state machine rather than
 * two calls in a row. Measured on device: firing `navigate(tab)` and
 * `push(path)` back to back leaves the tab at Book, because at restore time the
 * tabs navigator is not mounted yet and the selection has nothing to apply to.
 * So step one selects the tab and step two waits for that to actually land —
 * `useRootNavigationState` re-renders us when it does — before pushing the
 * destination on top.
 *
 * `push`, not a second `navigate`: navigating to the destination href would
 * re-resolve it against the route tree and rebuild the tabs underneath at their
 * default, throwing the selection away again.
 */
/**
 * Module scope, deliberately: a component ref resets when Expo Go remounts the
 * root after a reload, and both mounts would then push the same screen — the
 * user landing on Settings stacked on Settings. This lives as long as the JS
 * context, which is exactly the lifetime of one restore.
 */
let resumeDispatched = false;

function ResumeAfterLocaleSwitch({
  resume,
  onDone,
}: {
  resume: ResumeRoute | null;
  onDone: () => void;
}) {
  const rootState = useRootNavigationState();
  const ready = rootState?.key != null;
  // Set once the tab selection has been dispatched, so the effect below can
  // tell "not started" from "waiting for the tab to land".
  const [tabSelected, setTabSelected] = useState(false);
  // Step two must run on a LATER commit than step one. `ready` stays true
  // throughout, so it cannot drive that on its own; the state's identity
  // changes with every navigation, which is exactly the tick we need.
  const stateTick = rootState;

  useEffect(() => {
    if (resumeDispatched || !resume || !ready) return;
    const { path, tab } = resume;
    const needsTab = !!tab && tab !== path;

    // Step one: select the parked tab and wait for the next state commit.
    if (needsTab && !tabSelected) {
      addBreadcrumb('locale.resume', { path, tab });
      router.navigate(tab as Parameters<typeof router.navigate>[0]);
      setTabSelected(true);
      return;
    }

    // Step two: the tabs are mounted and on the right tab, so the destination
    // can go on top of them. Without a tab to restore we land here at once.
    resumeDispatched = true;
    if (needsTab) {
      router.push(path as Parameters<typeof router.push>[0]);
    } else {
      addBreadcrumb('locale.resume', { path, tab });
      router.navigate(path as Parameters<typeof router.navigate>[0]);
    }
    // Only now is the entry spent: the screen is on the stack, so a remount
    // that re-reads it would be restoring something already restored.
    void clearResumeRoute();
    // Hands animation back for whatever the user does next on this launch.
    onDone();
  }, [resume, ready, tabSelected, stateTick, onDone]);
  return null;
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
  /**
   * Where a language switch left the user, read HERE rather than in an effect
   * inside the navigator. Reading it after mount meant the tabs painted first
   * and the restored screen then slid in on top — the user watched the app
   * bounce through Book on its way back to Settings. Resolved before the first
   * frame, it is on the initial stack instead: the app comes back up already
   * on the screen they left.
   */
  const [resume, setResume] = useState<ResumeRoute | null>(null);

  useEffect(() => {
    let cancelled = false;
    // READ, not consume: Expo Go can mount the root twice after a reload, and
    // clearing here meant the second mount — the one the user actually lands
    // on — found nothing. The entry is cleared once the push has landed.
    Promise.all([loadBootPrefs(), readResumeRoute()])
      .then(([p, entry]) => {
        if (cancelled) return;
        if (reconcileRtl(p.locale) && reloadForRtl()) return; // reloading into the right direction
        setResume(entry);
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
  return <AppRoot prefs={prefs} resume={resume} />;
}

function AppRoot({ prefs, resume }: { prefs: BootPrefs; resume: ResumeRoute | null }) {
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
    Font.loadAsync(secondary).catch((error) =>
      captureException(error, { scope: 'fonts.secondary' }),
    );
  }, [fontsLoaded, secondary]);

  if (!fontsLoaded && !fontsError) return null; // splash is still covering us

  return (
    // Rehydrates the query cache from disk before first paint, so a cold start
    // shows real courts/bookings instead of spinners — and still works with no
    // network at all.
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <SafeAreaProvider>
        <LocaleProvider initialLocale={prefs.locale}>
          <ThemeProvider
            initialAppearance={prefs.appearance}
            fontsReady={fontsLoaded && !fontsError}
          >
            <AuthProvider>
              <ToastProvider>
                <ThemedChrome />
                <RootStack resume={resume} />
                <ConnectivityBanner />
                {/* Last child: it must paint over everything, including the
                    offline banner, while the switch applies. */}
                <LocaleSwitchOverlay />
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

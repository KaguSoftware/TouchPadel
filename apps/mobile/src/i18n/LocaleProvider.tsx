import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { makeT, isRtl, type Locale, type MessageKey, type TParams } from '@touch/i18n';
import { supabase } from '../lib/supabase';
import { LOCALE_KEY, reconcileRtl, reloadForRtl, saveResumeRoute } from '../lib/bootPrefs';
import { addBreadcrumb, captureException } from '../lib/telemetry';

export interface SetLocaleOptions {
  /**
   * The route to come back to once the new direction is up. A direction change
   * reloads the bundle, which would otherwise land the user on the tabs.
   */
  resumePath?: string;
  /**
   * The tab selected beneath `resumePath`, restored under it so back leads
   * where it did before the switch.
   */
  resumeTab?: string | null;

  /**
   * Apply the native RTL flag now (default). Pass false from flows that are
   * mid-navigation (sign-up, edit profile): the preference is stored and the
   * boot hook reconciles direction on the next launch, instead of flipping
   * half the screen under the user's thumb.
   */
  flip?: boolean;
}

export interface LocaleContextValue {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: (key: MessageKey, params?: TParams) => string;
  /**
   * Switch locale: persists on-device, writes profiles.preferred_lang when a
   * session exists, and reconciles the native RTL flag. In development the app
   * reloads itself so the new direction applies at once; in a release build
   * `needsRestart` turns on and Settings shows settings.rtlRestartNote.
   */
  setLocale: (locale: Locale, options?: SetLocaleOptions) => Promise<void>;
  /** The native layout direction lags the chosen language until a restart. */
  needsRestart: boolean;
  /**
   * A switch is in flight: the preference is being written, the profile synced,
   * and — when the direction changes — a reload is about to take the screen
   * away. The app covers itself with a spinner for the whole window so the user
   * never sees half-translated, half-mirrored UI. Stays true through the reload
   * (the bundle is torn down while it is set), and is cleared if we end up
   * staying put.
   */
  switching: boolean;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'en',
  dir: 'ltr',
  t: makeT('en'),
  setLocale: async () => {},
  needsRestart: false,
  switching: false,
});

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  /** Resolved by src/lib/bootPrefs.ts BEFORE first paint. */
  initialLocale: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [switching, setSwitching] = useState(false);

  const setLocale = useCallback(async (next: Locale, options?: SetLocaleOptions) => {
    // Only a user-facing switch (one that flips direction) shows the overlay;
    // the `flip: false` callers are mid-form and own their own busy state.
    const covering = options?.flip !== false;
    if (covering) setSwitching(true);
    setLocaleState(next);
    try {
      await AsyncStorage.setItem(LOCALE_KEY, next);
    } catch (error) {
      // Non-fatal: the locale still applies for this run. Recorded, not swallowed.
      captureException(error, { label: 'locale.persist', next });
    }
    try {
      // getSession() is a local read; getUser() was a network round-trip that
      // made the language toggle hang offline for the whole fetch timeout.
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (uid) {
        const { error } = await supabase.from('profiles').update({ preferred_lang: next }).eq('id', uid);
        if (error) throw error;
      }
    } catch (error) {
      // Best-effort: a guest may be offline. Retried next time they flip.
      captureException(error, { label: 'locale.profileSync', next });
    }
    if (options?.flip === false) return;
    if (reconcileRtl(next)) {
      addBreadcrumb('locale.switch', { next });
      // Park the route BEFORE reloading — DevSettings.reload() does not return.
      if (options?.resumePath) {
        await saveResumeRoute(options.resumePath, options.resumeTab ?? undefined);
      }
      if (reloadForRtl()) return; // the overlay stays up until the bundle dies
      setNeedsRestart(true);
    }
    // Same direction, or a release build that cannot reload: nothing is going
    // to take the screen away, so uncover it.
    setSwitching(false);
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      dir: isRtl(locale) ? 'rtl' : 'ltr',
      t: makeT(locale),
      setLocale,
      needsRestart,
      switching,
    }),
    [locale, setLocale, needsRestart, switching],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

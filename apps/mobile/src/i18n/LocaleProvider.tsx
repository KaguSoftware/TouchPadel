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
import { LOCALE_KEY, reconcileRtl, reloadForRtl } from '../lib/bootPrefs';
import { addBreadcrumb, captureException } from '../lib/telemetry';

export interface SetLocaleOptions {
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
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'en',
  dir: 'ltr',
  t: makeT('en'),
  setLocale: async () => {},
  needsRestart: false,
});

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

export function LocaleProvider({
  children,
  initialLocale,
  initialNeedsRestart,
}: {
  children: ReactNode;
  /** Resolved by src/lib/bootPrefs.ts BEFORE first paint. */
  initialLocale: Locale;
  /** Boot could not align the native direction with the locale (app/_layout.tsx). */
  initialNeedsRestart?: boolean;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [needsRestart, setNeedsRestart] = useState(initialNeedsRestart ?? false);

  const setLocale = useCallback(async (next: Locale, options?: SetLocaleOptions) => {
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
      if (!(await reloadForRtl())) setNeedsRestart(true);
    }
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      dir: isRtl(locale) ? 'rtl' : 'ltr',
      t: makeT(locale),
      setLocale,
      needsRestart,
    }),
    [locale, setLocale, needsRestart],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

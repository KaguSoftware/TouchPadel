import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { I18nManager } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { makeT, isRtl, type Locale, type MessageKey, type TParams } from '@touch/i18n';
import { supabase } from '../lib/supabase';

const LOCALE_KEY = 'tp.locale';

export interface LocaleContextValue {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: (key: MessageKey, params?: TParams) => string;
  /**
   * Switch locale: persists on-device, writes profiles.preferred_lang when a
   * session exists, and flips I18nManager. NOTE: RN applies forceRTL only after
   * an app RESTART — callers must surface settings.rtlRestartNote.
   */
  setLocale: (locale: Locale) => Promise<void>;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'en',
  dir: 'ltr',
  t: makeT('en'),
  setLocale: async () => {},
});

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  // Hydrate the persisted locale once at mount.
  useEffect(() => {
    let cancelled = false;
    void SecureStore.getItemAsync(LOCALE_KEY)
      .then((stored) => {
        if (!cancelled && (stored === 'en' || stored === 'ar')) setLocaleState(stored);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setLocale = useCallback(async (next: Locale) => {
    setLocaleState(next);
    try {
      await SecureStore.setItemAsync(LOCALE_KEY, next);
    } catch {
      // storage failure is non-fatal — locale still applies for this run
    }
    // Persist the preference on the profile (best-effort; guest may be offline).
    try {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (uid) {
        await supabase.from('profiles').update({ preferred_lang: next }).eq('id', uid);
      }
    } catch {
      // ignore — retried next time the user flips language while online
    }
    // I18nManager: takes effect after an app restart (surface rtlRestartNote).
    const wantRtl = isRtl(next);
    if (I18nManager.isRTL !== wantRtl) {
      I18nManager.allowRTL(wantRtl);
      I18nManager.forceRTL(wantRtl);
    }
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, dir: isRtl(locale) ? 'rtl' : 'ltr', t: makeT(locale), setLocale }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

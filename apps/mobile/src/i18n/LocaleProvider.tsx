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
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Localization from 'expo-localization';
import { makeT, isRtl, type Locale, type MessageKey, type TParams } from '@touch/i18n';
import { supabase } from '../lib/supabase';
import { addBreadcrumb, captureException } from '../lib/telemetry';

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

/** The device's preferred language, when we ship it. Venue is in Iraq. */
function deviceLocale(): Locale {
  try {
    const tags = Localization.getLocales();
    return tags.some((l) => l.languageCode === 'ar') ? 'ar' : 'en';
  } catch (error) {
    captureException(error, { label: 'locale.device' });
    return 'en';
  }
}

/**
 * Read the stored preference. Historically this lived in SecureStore, which is
 * keychain/keystore-backed: slow, size-capped, and entirely the wrong store for
 * a non-secret UI preference. New writes go to AsyncStorage; SecureStore is
 * still read once so existing installs keep their choice.
 */
async function readStoredLocale(): Promise<Locale | null> {
  try {
    const fresh = await AsyncStorage.getItem(LOCALE_KEY);
    if (fresh === 'en' || fresh === 'ar') return fresh;
    const legacy = await SecureStore.getItemAsync(LOCALE_KEY);
    if (legacy === 'en' || legacy === 'ar') {
      await AsyncStorage.setItem(LOCALE_KEY, legacy); // migrate forward
      return legacy;
    }
    return null;
  } catch (error) {
    captureException(error, { label: 'locale.read' });
    return null;
  }
}

/** Keep the native RTL flag in step with the active locale. */
function applyRtl(next: Locale): void {
  const wantRtl = isRtl(next);
  if (I18nManager.isRTL !== wantRtl) {
    I18nManager.allowRTL(wantRtl);
    I18nManager.forceRTL(wantRtl);
    addBreadcrumb('locale.forceRTL', { wantRtl });
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    let cancelled = false;
    void readStoredLocale().then((stored) => {
      if (cancelled) return;
      // First run has no stored preference. Falling back to 'en' meant an
      // Arabic phone in Iraq opened the app in English — the device language
      // was never consulted at all, because expo-localization wasn't installed.
      const next = stored ?? deviceLocale();
      setLocaleState(next);
      // Reconcile the native flag on every cold start. The hydration path used
      // to call setLocaleState directly and skip this, so the persisted locale
      // and I18nManager.isRTL could silently disagree (e.g. after a reinstall).
      applyRtl(next);
      addBreadcrumb('locale.hydrated', { locale: next, fromStore: stored !== null });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLocale = useCallback(async (next: Locale) => {
    setLocaleState(next);
    try {
      await AsyncStorage.setItem(LOCALE_KEY, next);
    } catch (error) {
      // Non-fatal: the locale still applies for this run. Recorded, not swallowed.
      captureException(error, { label: 'locale.persist', next });
    }
    try {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (uid) {
        const { error } = await supabase.from('profiles').update({ preferred_lang: next }).eq('id', uid);
        if (error) throw error;
      }
    } catch (error) {
      // Best-effort: a guest may be offline. Retried next time they flip.
      captureException(error, { label: 'locale.profileSync', next });
    }
    applyRtl(next);
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, dir: isRtl(locale) ? 'rtl' : 'ltr', t: makeT(locale), setLocale }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

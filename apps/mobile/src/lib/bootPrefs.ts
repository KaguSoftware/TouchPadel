/**
 * Boot preferences — everything the FIRST frame needs to be right.
 *
 * Read once, before the splash is hidden (app/_layout.tsx), and handed to
 * LocaleProvider / ThemeProvider as initial values. Both used to hydrate from
 * storage in an effect AFTER mounting with defaults ('en', 'light'), which gave
 * every cold start of an Arabic or dark-mode install a wrong first frame: a
 * white flash, Arabic strings in Latin faces (tofu), and a layout direction
 * that disagreed with the text until the next launch.
 *
 * Layout direction needs nothing from here beyond the locale itself: it is
 * derived from the locale in the React tree (src/i18n/direction.tsx), so there
 * is no native flag to reconcile and no reload to schedule.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Localization from 'expo-localization';
import type { Locale } from '@touch/i18n';
import { rememberLocale } from '../i18n/lastLocale';
import { rememberAppearance } from '../theme/lastAppearance';
import { addBreadcrumb, captureException } from './telemetry';

export const APPEARANCE_KEY = 'tp.appearance';
export const LOCALE_KEY = 'tp.locale';

/**
 * Keys the reload-based language switch (retired 2026-09-02) left on devices:
 * the parked route it replayed after reloading, and its reload-loop marker.
 * Removed once, best-effort, so old installs carry no debris.
 */
export const RETIRED_KEYS = ['tp.resumeRoute', 'tp.rtlReloadPending'] as const;

export type BootAppearance = 'light' | 'dark';

export interface BootPrefs {
  appearance: BootAppearance;
  locale: Locale;
  /** True when a stored preference was found (false = first run, device default). */
  localeFromStore: boolean;
}

function asLocale(value: unknown): Locale | null {
  return value === 'en' || value === 'ar' ? value : null;
}

/**
 * The device's preferred language — the FIRST one only. Checking every entry
 * in the list (`.some()`) opened an English-first phone with Arabic anywhere
 * in its preferences in Arabic, and flipped it RTL.
 */
export function deviceLocale(): Locale {
  try {
    return Localization.getLocales()[0]?.languageCode === 'ar' ? 'ar' : 'en';
  } catch (error) {
    captureException(error, { label: 'locale.device' });
    return 'en';
  }
}

/**
 * Historically the locale lived in SecureStore (keychain-backed: slow,
 * size-capped, and the wrong store for a non-secret preference). It is still
 * read once so existing installs keep their choice, then migrated forward.
 */
async function readLegacyLocale(): Promise<Locale | null> {
  try {
    const legacy = asLocale(await SecureStore.getItemAsync(LOCALE_KEY));
    if (legacy) await AsyncStorage.setItem(LOCALE_KEY, legacy);
    return legacy;
  } catch (error) {
    captureException(error, { label: 'locale.legacyRead' });
    return null;
  }
}

export async function loadBootPrefs(): Promise<BootPrefs> {
  let appearance: BootAppearance = 'light';
  let locale: Locale | null = null;
  try {
    const pairs = await AsyncStorage.multiGet([APPEARANCE_KEY, LOCALE_KEY]);
    for (const [key, value] of pairs) {
      if (key === APPEARANCE_KEY && (value === 'light' || value === 'dark')) appearance = value;
      if (key === LOCALE_KEY) locale = asLocale(value);
    }
  } catch (error) {
    captureException(error, { label: 'bootPrefs.read' });
  }
  if (!locale) locale = await readLegacyLocale();
  const localeFromStore = locale !== null;
  const resolved = locale ?? deviceLocale();
  rememberLocale(resolved);
  rememberAppearance(appearance);
  AsyncStorage.multiRemove([...RETIRED_KEYS]).catch((error) =>
    captureException(error, { label: 'bootPrefs.retire' }),
  );
  addBreadcrumb('boot.prefs', { appearance, locale: resolved, localeFromStore });
  return { appearance, locale: resolved, localeFromStore };
}

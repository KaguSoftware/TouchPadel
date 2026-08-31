/**
 * Boot preferences — everything the FIRST frame needs to be right.
 *
 * Read once, before the splash is hidden (app/_layout.tsx), and handed to
 * LocaleProvider / ThemeProvider as initial values. Both used to hydrate from
 * storage in an effect AFTER mounting with defaults ('en', 'light'), which gave
 * every cold start of an Arabic or dark-mode install a wrong first frame: a
 * white flash, Arabic strings in Latin faces (tofu), and a layout direction
 * that disagreed with the text until the next launch.
 */
import { DevSettings, I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Localization from 'expo-localization';
import { isRtl, type Locale } from '@touch/i18n';
import { addBreadcrumb, captureException } from './telemetry';

export const APPEARANCE_KEY = 'tp.appearance';
export const LOCALE_KEY = 'tp.locale';

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
  addBreadcrumb('boot.prefs', { appearance, locale: resolved, localeFromStore });
  return { appearance, locale: resolved, localeFromStore };
}

/**
 * Keep the native layout-direction flag in step with the active locale.
 *
 * `I18nManager.forceRTL` only takes effect for views created after the next
 * JS load, while JS-side reads of `isRTL` flip immediately — so a session that
 * flips it mid-flight renders Arabic text in an LTR layout with some icons
 * mirrored and some not. Returns true when the flag was changed, i.e. when the
 * caller must reload before painting anything.
 */
export function reconcileRtl(locale: Locale): boolean {
  const wantRtl = isRtl(locale);
  if (I18nManager.isRTL === wantRtl) return false;
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(wantRtl);
  addBreadcrumb('locale.forceRTL', { wantRtl });
  return true;
}

/**
 * Reload the JS bundle so a changed RTL flag applies. Available in development
 * (Expo Go / dev client) — the loop this app is tested in. Production builds
 * surface `settings.rtlRestartNote` instead (expo-updates' reloadAsync is the
 * release-build equivalent; it arrives with the EAS setup).
 */
export function reloadForRtl(): boolean {
  if (!__DEV__) return false;
  try {
    DevSettings.reload();
    return true;
  } catch (error) {
    captureException(error, { label: 'locale.reload' });
    return false;
  }
}

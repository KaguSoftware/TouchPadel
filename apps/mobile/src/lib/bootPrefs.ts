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
/** Set right before a dev reload for RTL; still set on the next boot = the reload did not stick. */
export const RTL_RELOAD_KEY = 'tp.rtlReloadPending';

/**
 * Where the user was standing when they switched language. A locale switch
 * reloads the JS bundle (the only way a changed RTL flag reaches native views),
 * which drops them on the initial route — so the route is parked here first and
 * replayed once the new direction is up.
 */
export const RESUME_KEY = 'tp.resumeRoute';

/** What a switch parks: where the user was, and what sits beneath it. */
export interface ResumeRoute {
  /** The screen the user was on, e.g. '/settings'. */
  path: string;
  /**
   * The tab that was selected UNDER that screen, e.g. '/profile'.
   *
   * Restoring only `path` rebuilt the tabs at their default (Book), so backing
   * out of the restored screen dropped the user somewhere they had never been.
   * Settings is reached from Profile, and back has to lead there.
   */
  tab?: string;
}

/**
 * Written just before the reload. Stale entries are possible (the reload can
 * fail, or the app can be killed mid-switch), so it carries a timestamp and is
 * consumed exactly once — see `consumeResumeRoute`.
 */
export async function saveResumeRoute(path: string, tab?: string): Promise<void> {
  try {
    await AsyncStorage.setItem(RESUME_KEY, JSON.stringify({ path, tab, at: Date.now() }));
  } catch (error) {
    // Non-fatal: the switch still happens, the user just lands on the tabs.
    captureException(error, { label: 'resume.save', path });
  }
}

/** A parked route older than this is treated as debris, not an intention. */
const RESUME_TTL_MS = 60_000;

/** Forget the parked route. Called once the restore has actually landed. */
export async function clearResumeRoute(): Promise<void> {
  try {
    await AsyncStorage.removeItem(RESUME_KEY);
  } catch (error) {
    captureException(error, { label: 'resume.clear' });
  }
}

/**
 * Read the parked route WITHOUT clearing it.
 *
 * Reading and clearing used to be one step, which lost the route on a double
 * boot: Expo Go remounts the root component after a reload, the first mount
 * consumed the entry, and the second — the one whose navigator the user
 * actually ends up on — found nothing and left them on the tabs. The entry is
 * now cleared by `clearResumeRoute` only after a push has really happened, so
 * whichever mount survives still finds it.
 */
export async function readResumeRoute(): Promise<ResumeRoute | null> {
  try {
    const raw = await AsyncStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { path, tab, at } = parsed as { path?: unknown; tab?: unknown; at?: unknown };
    if (typeof path !== 'string' || typeof at !== 'number') return null;
    if (Date.now() - at > RESUME_TTL_MS) return null;
    if (!isInAppPath(path)) return null;
    // A bad tab must not cost the user the destination: drop it, keep the path.
    return { path, tab: typeof tab === 'string' && isInAppPath(tab) ? tab : undefined };
  } catch (error) {
    captureException(error, { label: 'resume.read' });
    return null;
  }
}

/** In-app paths only, never a URL that could point off somewhere else. */
function isInAppPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//');
}

/**
 * Read and clear in one step. Kept for the paths that genuinely want the entry
 * gone whether or not anything is done with it.
 */
export async function consumeResumeRoute(): Promise<ResumeRoute | null> {
  const entry = await readResumeRoute();
  await clearResumeRoute();
  return entry;
}

export type BootAppearance = 'light' | 'dark';

export interface BootPrefs {
  appearance: BootAppearance;
  locale: Locale;
  /** True when a stored preference was found (false = first run, device default). */
  localeFromStore: boolean;
  /** The native layout direction could not be made to match the locale this run. */
  needsRestart: boolean;
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
  return { appearance, locale: resolved, localeFromStore, needsRestart: false };
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
 *
 * ONE attempt only. Expo Go resets the native RTL flag on every load (a dev
 * client / store build keeps it), so there the reload never "takes": boot saw
 * the mismatch, reloaded, saw it again, reloaded… — Metro rebundling forever
 * and the app never painting. A marker is set right before reloading; a boot
 * that finds it still set knows the previous reload did not stick and paints
 * anyway (Arabic strings in an LTR native layout, `needsRestart` on) instead
 * of trying again.
 */
export async function reloadForRtl(): Promise<boolean> {
  if (!__DEV__) return false;
  try {
    if ((await AsyncStorage.getItem(RTL_RELOAD_KEY)) === '1') {
      await AsyncStorage.removeItem(RTL_RELOAD_KEY);
      addBreadcrumb('locale.reloadDidNotStick');
      return false;
    }
    await AsyncStorage.setItem(RTL_RELOAD_KEY, '1');
    DevSettings.reload();
    return true;
  } catch (error) {
    captureException(error, { label: 'locale.reload' });
    return false;
  }
}

/** A boot whose direction already matches: the last reload (if any) stuck. */
export async function clearRtlReloadMarker(): Promise<void> {
  try {
    await AsyncStorage.removeItem(RTL_RELOAD_KEY);
  } catch (error) {
    captureException(error, { label: 'locale.reloadMarker' });
  }
}

/**
 * Android's system dialogs — the date and time pickers
 * (`DateTimePickerAndroid`) and every `Alert.alert` — take their language AND
 * layout direction from the APP's Android Configuration, which follows the
 * PHONE's language; neither has a `locale` option. An English app on a
 * Persian phone got an RTL alert: title flush right, English body and buttons
 * flush left. This hands the in-app language to that Configuration
 * (modules/app-locale) right before a dialog opens. Called per open, not once:
 * any system configuration change (theme, rotation) resets it.
 *
 * Latin digits in Arabic, as everywhere else (`@touch/i18n` formatting).
 * iOS needs none of this: its pickers take the locale directly
 * (DateTimeField's `locale`, DateWheelSheet.ios's environment).
 *
 * A no-op where the native module is absent: iOS, Expo Go, a build older than
 * the module, unit tests.
 */
import { Alert, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type { Locale } from '@touch/i18n';
import { lastKnownLocale } from './lastLocale';

interface AppLocaleModule {
  apply(tag: string): void;
}

const native =
  Platform.OS === 'android' ? requireOptionalNativeModule<AppLocaleModule>('AppLocale') : null;

export function applyNativeLocale(locale: Locale): void {
  try {
    native?.apply(locale === 'ar' ? 'ar-u-nu-latn' : 'en-GB');
  } catch {
    // The dialog still opens, in the phone's language.
  }
}

/**
 * Wraps `Alert.alert` once, at boot (index.js), so every alert in the app —
 * two dozen call sites, plus overlays.tsx — opens in the in-app language and
 * direction without each one remembering to ask.
 */
export function installAlertLocale(): void {
  if (!native) return;
  const alert = Alert.alert.bind(Alert);
  Alert.alert = (...args: Parameters<typeof Alert.alert>) => {
    applyNativeLocale(lastKnownLocale());
    alert(...args);
  };
}

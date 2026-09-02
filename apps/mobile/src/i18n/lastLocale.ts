/**
 * The locale the app last resolved — readable from OUTSIDE the React tree.
 *
 * Two screens render instead of the provider tree (expo-router's ErrorBoundary
 * and the config-error screen in app/_layout.tsx) and still have to speak the
 * user's language. Set by the boot hook and by every switch.
 */
import type { Locale } from '@touch/i18n';

let current: Locale = 'en';

export function rememberLocale(locale: Locale): void {
  current = locale;
}

export function lastKnownLocale(): Locale {
  return current;
}

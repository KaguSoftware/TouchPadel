/**
 * Hiding the native splash, exactly once and from one place.
 *
 * The reveal used to belong to AppRoot's font effect, which hid the splash the
 * moment the fonts landed — and the Book tab's court was then caught being
 * built (the GL scene, the brand pattern's one bare frame). Ownership moved to
 * BootOverlay so the splash lifts onto a screen that is ALREADY painted in the
 * splash's own blue, and never onto a half-drawn court.
 *
 * Idempotent and never throwing: it is called from a layout callback, from a
 * watchdog and from the already-shown path, and a splash that will not hide
 * must not take the app down with it.
 */
import * as SplashScreen from 'expo-splash-screen';

let hiding: Promise<void> | null = null;

export function hideNativeSplash(): Promise<void> {
  hiding ??= SplashScreen.hideAsync().catch(() => {});
  return hiding;
}

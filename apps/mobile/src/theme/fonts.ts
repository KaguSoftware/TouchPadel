/**
 * The brand faces. Lama Sans carries Latin AND Arabic in the same files, so a
 * single set serves both languages: there is no per-script family to choose
 * between, and a language switch changes no font at all. They are bundled
 * assets rather than a download, so `useFonts` in app/_layout.tsx registers
 * every one of them before the splash lifts and none can arrive late.
 *
 * Only the five weights `FontRole` names are required here. Metro bundles what
 * is `require`d, so the Medium and italic faces `scripts/sync-fonts.mjs` also
 * copies into assets/fonts cost nothing sitting unreferenced — while
 * registering them would hold first paint on two faces nothing renders in.
 *
 * The KEYS are the family names `<Text style={{ fontFamily }}>` resolves
 * against, so they must match `fontSets` in ./tokens.ts character for
 * character: a name the OS does not know red-boxes "Unrecognized font family"
 * on iOS, on every single <Text>.
 */
import * as Font from 'expo-font';

export const BRAND_FONTS: Record<string, Font.FontSource> = {
  LamaSans_400Regular: require('../../assets/fonts/LamaSans-Regular.ttf'),
  LamaSans_600SemiBold: require('../../assets/fonts/LamaSans-SemiBold.ttf'),
  LamaSans_700Bold: require('../../assets/fonts/LamaSans-Bold.ttf'),
  LamaSans_800ExtraBold: require('../../assets/fonts/LamaSans-ExtraBold.ttf'),
  LamaSans_900Black: require('../../assets/fonts/LamaSans-Black.ttf'),
};

/**
 * True once every brand face is registered with the OS.
 *
 * False on the two paths that paint without ever reaching `useFonts` — the
 * config-error and crash screens mount their own providers ABOVE AppRoot — and
 * after a partial load. ThemeProvider reads it and falls back to
 * `fontSets.system` rather than naming a family the OS cannot resolve.
 */
export function fontsLoaded(): boolean {
  return Object.keys(BRAND_FONTS).every((family) => Font.isLoaded(family));
}

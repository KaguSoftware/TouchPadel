/**
 * App-driven light/dark theming per the approved design: the design offers a
 * Light/Dark segmented control in Settings (no "system" option), so the theme
 * is a stored preference, not the OS scheme. Default light; persisted to
 * AsyncStorage; status bar + root background follow it in app/_layout.tsx.
 *
 * The initial value arrives as a prop from the boot hook (src/lib/bootPrefs.ts)
 * so the first frame is already the right theme — reading it in an effect here
 * painted a white frame on every cold start of a dark-mode install.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Appearance as NativeAppearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureException } from '../lib/telemetry';
import { APPEARANCE_KEY } from '../lib/bootPrefs';
import { useLocale } from '../i18n/LocaleProvider';
import { palettes, fontSets, type Palette, type FontSet } from './tokens';

export type Appearance = 'light' | 'dark';

export interface ThemeContextValue {
  appearance: Appearance;
  /** Persisted; applies immediately (no restart, unlike the locale flip). */
  setAppearance: (next: Appearance) => void;
  /** The active palette — the only color source components should touch. */
  colors: Palette;
  /** Locale-resolved font families (Arabic renders in Cairo throughout). */
  fonts: FontSet;
  /**
   * Letter-spacing guard. Positive tracking visually disconnects the letters of
   * a cursive script, so every uppercase micro-label and button in the app
   * rendered as broken-up Arabic. Returns 0 under Arabic, `px` otherwise.
   */
  tracking: (px: number) => number;
}

const ThemeContext = createContext<ThemeContextValue>({
  appearance: 'light',
  setAppearance: () => {},
  colors: palettes.light,
  fonts: fontSets.latin,
  tracking: (px) => px,
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export function ThemeProvider({
  children,
  initialAppearance = 'light',
  fontsReady = true,
}: {
  children: ReactNode;
  initialAppearance?: Appearance;
  /** False while the brand fonts failed to load: every family falls back to the system face. */
  fontsReady?: boolean;
}) {
  const { locale } = useLocale();
  const [appearance, setAppearanceState] = useState<Appearance>(initialAppearance);

  // Tell the OS so keyboards, alerts, share sheets and scroll indicators follow
  // the in-app choice (app.config.ts declares userInterfaceStyle 'automatic').
  useEffect(() => {
    try {
      NativeAppearance.setColorScheme(appearance);
    } catch (error) {
      captureException(error, { label: 'theme.nativeScheme' });
    }
  }, [appearance]);

  const setAppearance = useCallback((next: Appearance) => {
    setAppearanceState(next);
    // Non-fatal on failure: the choice still applies for this run.
    AsyncStorage.setItem(APPEARANCE_KEY, next).catch((error) =>
      captureException(error, { label: 'theme.persist', next }),
    );
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      appearance,
      setAppearance,
      colors: palettes[appearance],
      fonts: !fontsReady ? fontSets.system : locale === 'ar' ? fontSets.arabic : fontSets.latin,
      tracking: locale === 'ar' ? () => 0 : (px) => px,
    }),
    [appearance, setAppearance, locale, fontsReady],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

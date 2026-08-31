/**
 * App-driven light/dark theming per the approved design: the design offers a
 * Light/Dark segmented control in Settings (no "system" option), so the theme
 * is a stored preference, not the OS scheme. Default light; persisted to
 * AsyncStorage; status bar + root background follow it in app/_layout.tsx.
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureException } from '../lib/telemetry';
import { useLocale } from '../i18n/LocaleProvider';
import { palettes, fontSets, type Palette, type FontSet } from './tokens';

const APPEARANCE_KEY = 'tp.appearance';

export type Appearance = 'light' | 'dark';

export interface ThemeContextValue {
  appearance: Appearance;
  /** Persisted; applies immediately (no restart, unlike the locale flip). */
  setAppearance: (next: Appearance) => void;
  /** The active palette — the only color source components should touch. */
  colors: Palette;
  /** Locale-resolved font families (Arabic renders in Cairo throughout). */
  fonts: FontSet;
}

const ThemeContext = createContext<ThemeContextValue>({
  appearance: 'light',
  setAppearance: () => {},
  colors: palettes.light,
  fonts: fontSets.latin,
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  const [appearance, setAppearanceState] = useState<Appearance>('light');

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(APPEARANCE_KEY)
      .then((stored) => {
        if (!cancelled && (stored === 'light' || stored === 'dark')) setAppearanceState(stored);
      })
      .catch((error) => captureException(error, { label: 'theme.read' }));
    return () => {
      cancelled = true;
    };
  }, []);

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
      fonts: locale === 'ar' ? fontSets.arabic : fontSets.latin,
    }),
    [appearance, setAppearance, locale],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

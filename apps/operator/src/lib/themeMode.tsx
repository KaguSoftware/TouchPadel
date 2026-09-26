/**
 * Appearance for the operator app — light (paper) or BLUE MODE (the brand blue
 * as the ground, `packages/ui/src/tokens/operatorBlue.ts`). Chosen per station
 * and persisted the same way the locale is (lib/i18n.tsx), because the person
 * who wants a blue till at night is the same person who wants it tomorrow.
 *
 * index.html reads the SAME key before React mounts and sets `data-mode` on
 * <html>, so the boot frame paints blue instead of flashing paper first.
 *
 * `useThemeMode` does not throw without a provider: half the component tests
 * render a screen bare, and a chart asking for its colours there should get
 * the light set, not a crash.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ThemeMode } from '@touch/ui';

export const THEME_MODE_STORAGE_KEY = 'touch-operator-theme';

interface ThemeModeContextValue {
  mode: ThemeMode;
  /** Flip between light and blue. */
  toggleMode: () => void;
  setMode: (mode: ThemeMode) => void;
}

const FALLBACK: ThemeModeContextValue = {
  mode: 'light',
  toggleMode: () => {},
  setMode: () => {},
};

const ThemeModeContext = createContext<ThemeModeContextValue>(FALLBACK);

export function loadThemeMode(): ThemeMode {
  try {
    return localStorage.getItem(THEME_MODE_STORAGE_KEY) === 'blue' ? 'blue' : 'light';
  } catch {
    return 'light';
  }
}

function persist(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  } catch {
    /* private mode — the appearance simply resets next boot */
  }
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(loadThemeMode);

  const setMode = useCallback((next: ThemeMode) => {
    persist(next);
    setModeState(next);
  }, []);

  const toggleMode = useCallback(() => {
    setModeState((prev) => {
      const next: ThemeMode = prev === 'blue' ? 'light' : 'blue';
      persist(next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeModeContextValue>(() => ({ mode, toggleMode, setMode }), [mode, toggleMode, setMode]);

  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}

export function useThemeMode(): ThemeModeContextValue {
  return useContext(ThemeModeContext);
}

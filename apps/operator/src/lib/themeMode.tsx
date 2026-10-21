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
 *
 * The flip cross-fades (Sait, 2026-10-18): the change runs inside a view
 * transition, so the browser snapshots the old frame and fades it into the
 * new one instead of every surface jumping at once. flushSync makes React
 * commit (and ThemeProvider's effect write `data-mode`) inside the callback,
 * which is the frame the browser captures as "new". Reduced motion, or a
 * browser without the API (jsdom in tests), flips instantly as before. The
 * fade's timing lives in GlobalStyles (`::view-transition-*(root)`).
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
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

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Run `apply` inside a cross-fade where the browser can draw one. */
function withCrossFade(apply: () => void): void {
  if (typeof document.startViewTransition !== 'function' || prefersReducedMotion()) {
    apply();
    return;
  }
  document.startViewTransition(() => flushSync(apply));
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(loadThemeMode);
  // The toggle reads the mode from here, not from a state updater: the
  // updater would run inside the transition callback, and it must stay pure.
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const setMode = useCallback((next: ThemeMode) => {
    if (next === modeRef.current) return;
    persist(next);
    withCrossFade(() => setModeState(next));
  }, []);

  const toggleMode = useCallback(() => {
    setMode(modeRef.current === 'blue' ? 'light' : 'blue');
  }, [setMode]);

  const value = useMemo<ThemeModeContextValue>(() => ({ mode, toggleMode, setMode }), [mode, toggleMode, setMode]);

  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}

export function useThemeMode(): ThemeModeContextValue {
  return useContext(ThemeModeContext);
}

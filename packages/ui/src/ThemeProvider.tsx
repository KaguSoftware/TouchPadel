/**
 * ThemeProvider — the only React component in @touch/ui for now.
 *
 * Sets `data-theme` (padel | cafe | operator), `dir` (ltr | rtl) and, when a
 * theme has more than one appearance, `data-mode` on <html>; injects the token
 * stylesheet once, and exposes the current theme via context.
 */
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { ThemeName } from './tokens/palette';
import { THEME_STYLE_ID, themeCss } from './theme';

/**
 * An appearance of a theme. Today only the operator has two: `light` (the
 * paper surfaces) and `blue` (tokens/operatorBlue.ts — the brand blue as the
 * ground). `light` writes no attribute, so a theme with one appearance is
 * unchanged by this prop existing.
 */
export type ThemeMode = 'light' | 'blue';

export interface ThemeContextValue {
  theme: ThemeName;
  dir: 'ltr' | 'rtl';
  mode: ThemeMode;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'padel', dir: 'ltr', mode: 'light' });

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export interface ThemeProviderProps {
  theme: ThemeName;
  /** Document direction — pass dirAttr(locale) from @touch/i18n. */
  dir: 'ltr' | 'rtl';
  /** Appearance; defaults to `light`. Only the operator theme has a second one. */
  mode?: ThemeMode;
  children: ReactNode;
}

function ensureStylesInjected(): void {
  if (typeof document === 'undefined') return; // SSR: apps inline themeCss server-side
  if (document.getElementById(THEME_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = THEME_STYLE_ID;
  style.textContent = themeCss;
  document.head.appendChild(style);
}

export function ThemeProvider({ theme, dir, mode = 'light', children }: ThemeProviderProps) {
  useEffect(() => {
    ensureStylesInjected();
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('dir', dir);
    root.setAttribute('lang', dir === 'rtl' ? 'ar' : 'en');
    // The blue block itself declares `color-scheme: dark`, so native scrollbars,
    // selects and form controls follow the ground; the attribute is all that is
    // needed here. Removing it (rather than writing 'light') keeps the padel and
    // cafe documents byte-identical to what they were before modes existed.
    if (mode === 'light') root.removeAttribute('data-mode');
    else root.setAttribute('data-mode', mode);
  }, [theme, dir, mode]);

  return <ThemeContext.Provider value={{ theme, dir, mode }}>{children}</ThemeContext.Provider>;
}

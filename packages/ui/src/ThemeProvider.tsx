/**
 * ThemeProvider — the only React component in @touch/ui for now.
 *
 * Sets `data-theme` (padel | cafe) and `dir` (ltr | rtl) on <html>, injects the
 * token stylesheet once, and exposes the current theme via context.
 */
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { ThemeName } from './tokens/palette';
import { THEME_STYLE_ID, themeCss } from './theme';

export interface ThemeContextValue {
  theme: ThemeName;
  dir: 'ltr' | 'rtl';
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'padel', dir: 'ltr' });

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export interface ThemeProviderProps {
  theme: ThemeName;
  /** Document direction — pass dirAttr(locale) from @touch/i18n. */
  dir: 'ltr' | 'rtl';
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

export function ThemeProvider({ theme, dir, children }: ThemeProviderProps) {
  useEffect(() => {
    ensureStylesInjected();
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('dir', dir);
    root.setAttribute('lang', dir === 'rtl' ? 'ar' : 'en');
  }, [theme, dir]);

  return <ThemeContext.Provider value={{ theme, dir }}>{children}</ThemeContext.Provider>;
}

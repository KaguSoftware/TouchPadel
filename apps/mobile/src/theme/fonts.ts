/**
 * The brand faces, by script. Latin (Archivo display + Mulish body) and Arabic
 * (Cairo for both roles) are loaded per locale: the active script blocks first
 * paint (app/_layout.tsx), the other loads in the background so a language
 * switch has its faces ready — and `ensureFontsLoaded` makes the switch wait
 * for them when it does not, because an unregistered family on iOS falls back
 * to the system face silently and nothing re-renders when it later registers.
 */
import * as Font from 'expo-font';
import {
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  Archivo_900Black,
} from '@expo-google-fonts/archivo';
import {
  Mulish_400Regular,
  Mulish_600SemiBold,
  Mulish_700Bold,
  Mulish_800ExtraBold,
} from '@expo-google-fonts/mulish';
import {
  Cairo_400Regular,
  Cairo_600SemiBold,
  Cairo_700Bold,
  Cairo_800ExtraBold,
  Cairo_900Black,
} from '@expo-google-fonts/cairo';
import type { Locale } from '@touch/i18n';
import { captureException } from '../lib/telemetry';

export const LATIN_FONTS = {
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  Archivo_900Black,
  Mulish_400Regular,
  Mulish_600SemiBold,
  Mulish_700Bold,
  Mulish_800ExtraBold,
};

export const ARABIC_FONTS = {
  Cairo_400Regular,
  Cairo_600SemiBold,
  Cairo_700Bold,
  Cairo_800ExtraBold,
  Cairo_900Black,
};

/** The faces a locale renders in. */
export function fontsFor(locale: Locale): Record<string, Font.FontSource> {
  return locale === 'ar' ? ARABIC_FONTS : LATIN_FONTS;
}

/** The other script's faces — preloaded so a switch never waits on the network. */
export function otherFontsFor(locale: Locale): Record<string, Font.FontSource> {
  return locale === 'ar' ? LATIN_FONTS : ARABIC_FONTS;
}

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Called after a set of faces registers. ThemeProvider re-evaluates its
 * families on it, so a switch that committed before a slow download finished
 * (see LocaleProvider's FONT_WAIT_CAP_MS) picks the brand faces up when they
 * arrive instead of staying on the system face for the session.
 */
export function subscribeFontsRegistered(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True once every face of the locale's set is registered with the OS. */
export function fontsLoaded(locale: Locale): boolean {
  return Object.keys(fontsFor(locale)).every((family) => Font.isLoaded(family));
}

/**
 * Register the locale's faces if they are not yet. Concurrent callers share
 * one load (expo-font dedupes per family). Never throws: on failure the theme
 * falls back to the system faces (see ThemeProvider), which is the same
 * degradation the first paint already has.
 */
export async function ensureFontsLoaded(locale: Locale): Promise<boolean> {
  if (fontsLoaded(locale)) return true;
  try {
    await Font.loadAsync(fontsFor(locale));
    listeners.forEach((listener) => listener());
    return true;
  } catch (error) {
    captureException(error, { scope: 'fonts.switch', locale });
    return false;
  }
}

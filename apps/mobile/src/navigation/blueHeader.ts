/**
 * The brand-blue native bar of coach mode's screens (owner, 2026-10-11): the
 * bar wears the blue the page's hero carries on below it, in both themes, so its
 * title, back item and status-bar glyphs are white while the screen has focus.
 * The glyphs go back to the theme's when it loses focus (a push, a pop).
 *
 * Returns the options for the screen's `<Stack.Screen options>`.
 */
import { useCallback, useMemo } from 'react';
import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { brand, useTheme } from '../theme';
import { useNativeHeaderOptions } from './headerOptions';

export function useBlueHeaderOptions(title: string) {
  const { appearance } = useTheme();
  const header = useNativeHeaderOptions();

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle(appearance === 'dark' ? 'light' : 'dark');
    }, [appearance]),
  );

  return useMemo(
    () => ({
      title,
      headerStyle: { backgroundColor: brand.blue },
      headerTintColor: brand.white,
      headerTitleStyle: { ...header.headerTitleStyle, color: brand.white },
    }),
    [title, header.headerTitleStyle],
  );
}

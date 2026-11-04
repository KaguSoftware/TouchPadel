import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Whether the screen this is rendered in is the one in front. A tab stays
 * mounted behind the others and a pushed screen leaves the one under it
 * mounted, so "mounted" says nothing about being looked at; this does. True
 * on the first render, as the screen is opening.
 */
export function useScreenFocused(): boolean {
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return focused;
}

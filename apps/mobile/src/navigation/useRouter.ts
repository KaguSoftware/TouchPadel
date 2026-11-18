import { useMemo } from 'react';
import { useRouter as useExpoRouter } from 'expo-router';
import { guardRouter, sharedAllow } from './dedupeNavigation';

/** `useRouter` from expo-router, with a repeat tap on the same target dropped (see dedupeNavigation). */
export function useRouter() {
  const base = useExpoRouter();
  return useMemo(() => guardRouter(base, sharedAllow), [base]);
}

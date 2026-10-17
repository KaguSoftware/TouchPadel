/**
 * `useAssistantMode()`: the paid assistant or the free AI for the signed-in
 * person (mode.ts). `canUsePaid` is the /assistant route's own check, so the
 * owner (and only who that route admits) may switch; everyone else is free,
 * always, and `setMode` does nothing for them.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { canAccess, useAuth } from '../../lib/auth';
import { loadMode, resolveMode, saveMode, subscribeMode, type AssistantMode } from './mode';

export interface UseAssistantMode {
  mode: AssistantMode;
  canUsePaid: boolean;
  setMode: (next: AssistantMode) => void;
}

export function useAssistantMode(): UseAssistantMode {
  const { staff } = useAuth();
  const canUsePaid = canAccess(staff, '/assistant');
  const ownerId = staff?.id ?? '';
  const stored = useSyncExternalStore(subscribeMode, () => (canUsePaid ? loadMode(ownerId) : null));
  const setMode = useCallback(
    (next: AssistantMode) => {
      if (canUsePaid && ownerId) saveMode(ownerId, next);
    },
    [canUsePaid, ownerId],
  );
  return { mode: resolveMode(canUsePaid, stored), canUsePaid, setMode };
}

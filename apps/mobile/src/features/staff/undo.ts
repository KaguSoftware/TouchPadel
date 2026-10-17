/**
 * The staff pages' Undo (Sait, 2026-10-17): a withdraw, cancel or untick
 * happens on screen at once, a toast offers Undo for five seconds, and only
 * then does the call go to the server (undoLogic.ts says why).
 *
 * What waits is sent at once when the app leaves the screen or the page that
 * started it closes, so nothing is lost to a killed app and no call outlives
 * the page by long.
 */
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { useToast } from '../../components/overlays';
import { useLocale } from '../../i18n/LocaleProvider';
import { createUndoQueue } from './undoLogic';

const queue = createUndoQueue<ReturnType<typeof setTimeout>>({
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h),
});

let watchingAppState = false;
function watchAppState() {
  if (watchingAppState) return;
  watchingAppState = true;
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') queue.flush();
  });
}

export interface Undoable {
  /** The toast's line, e.g. "Request withdrawn". */
  message: string;
  /** Shows the result now: drop or change the row in the cache. */
  apply: () => void;
  /** Puts the row back as it was (Undo, or the call failed). */
  restore: () => void;
  /** The real call, made when the toast's time is up. */
  send: () => Promise<unknown>;
  /** After a failed send, once the row is back: say what went wrong. */
  onError: (error: unknown) => void;
  /** After a good send: refresh what the call changed. */
  onSent?: () => void;
}

/** Returns `run(undoable)`. */
export function useUndoable() {
  const toast = useToast();
  const { t } = useLocale();

  useEffect(() => {
    watchAppState();
    // The page closing sends what it left waiting.
    return () => queue.flush();
  }, []);

  return useCallback(
    (u: Undoable) => {
      u.apply();
      const id = queue.defer(() => {
        u.send().then(
          () => u.onSent?.(),
          (e: unknown) => {
            u.restore();
            u.onError(e);
          },
        );
      }, u.restore);
      toast(u.message, 'info', {
        action: { label: t('common.undo'), onPress: () => queue.undo(id) },
      });
    },
    [toast, t],
  );
}

/**
 * `apply` / `restore` for an Undoable that changes one cached list: the list
 * as it was is kept at `apply` and put back at `restore`. Lists not loaded
 * yet are left alone.
 */
export function cacheEdit<T>(client: QueryClient, key: QueryKey, edit: (data: T) => T) {
  let before: T | undefined;
  return {
    apply: () => {
      before = client.getQueryData<T>(key);
      if (before !== undefined) client.setQueryData<T>(key, edit(before));
    },
    restore: () => {
      if (before !== undefined) client.setQueryData<T>(key, before);
    },
  };
}

/** Several cacheEdits as one: a row that shows in more than one cached list. */
export function cacheEdits(edits: readonly ReturnType<typeof cacheEdit>[]) {
  return {
    apply: () => edits.forEach((e) => e.apply()),
    restore: () => edits.forEach((e) => e.restore()),
  };
}

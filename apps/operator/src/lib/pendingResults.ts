/**
 * usePendingResults — the rows a screen marked pending after mutate() resolved
 * `queued` (item 9, 0120): screen key (a tab id, a line id) -> the envelope's
 * localId, until the server answers.
 *
 * The map lives in a ref that the result listener reads and in state that the
 * render reads, written together. The listener is subscribed once and never
 * closes over a stale map: a result that lands in the render right after
 * awaitResult() timed out — before an effect keyed on the state could
 * re-subscribe — still finds the entry. Any terminal result for a held localId
 * retires the entry (an ack refetches; a refusal is handed to `onRefused` so
 * the screen lands it where the synchronous one would have).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutationResult } from '../ipc/bridge';
import { onResult } from './queueResults';

export interface PendingResults<K> {
  /** For rendering: the keys still waiting. */
  pending: ReadonlyMap<K, string>;
  add(key: K, localId: string): void;
  remove(key: K): void;
  clear(): void;
}

export function usePendingResults<K>(onRefused: (key: K, r: MutationResult) => void): PendingResults<K> {
  const [pending, setPending] = useState<ReadonlyMap<K, string>>(new Map());
  const ref = useRef(pending);
  const refused = useRef(onRefused);
  refused.current = onRefused;

  const write = useCallback((next: ReadonlyMap<K, string>) => {
    ref.current = next;
    setPending(next);
  }, []);
  const add = useCallback(
    (key: K, localId: string) => {
      const next = new Map(ref.current);
      next.set(key, localId);
      write(next);
    },
    [write],
  );
  const remove = useCallback(
    (key: K) => {
      if (!ref.current.has(key)) return;
      const next = new Map(ref.current);
      next.delete(key);
      write(next);
    },
    [write],
  );
  const clear = useCallback(() => {
    if (ref.current.size === 0) return;
    write(new Map());
  }, [write]);

  useEffect(
    () =>
      onResult((r) => {
        const key = [...ref.current].find(([, localId]) => localId === r.localId)?.[0];
        if (key === undefined) return;
        remove(key);
        if (r.state === 'conflict' || r.state === 'failed') refused.current(key, r);
      }),
    [remove],
  );

  return useMemo(() => ({ pending, add, remove, clear }), [pending, add, remove, clear]);
}

/**
 * Accessible toggle (`role="switch"`) with built-in optimism: flips at once,
 * awaits `onChange`, reverts + `toast.err` on throw. Pair with
 * `useOptimisticToggle` when the value lives in a React Query cache.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useToast } from './toast';

/** How long the optimistic value may outlive a successful call while the query refetches. */
const SETTLE_GRACE_MS = 5_000;

export function Switch({
  checked,
  onChange,
  label,
  busy,
  disabled,
  tone = 'accent',
  hideLabel,
  style,
}: {
  checked: boolean;
  onChange: (next: boolean) => Promise<void> | void;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  tone?: 'accent' | 'danger';
  /** Keep the label for screen readers only (dense list rows). */
  hideLabel?: boolean;
  style?: CSSProperties;
}) {
  const toast = useToast();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drop the optimistic overlay once the prop catches up (or after a grace period).
  useEffect(() => {
    if (optimistic !== null && checked === optimistic) setOptimistic(null);
  }, [checked, optimistic]);
  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  const value = optimistic ?? checked;
  const working = !!busy || (optimistic !== null && optimistic !== checked);

  async function flip() {
    if (working || disabled) return;
    const next = !checked;
    setOptimistic(next);
    try {
      await onChange(next);
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => setOptimistic(null), SETTLE_GRACE_MS);
    } catch (error) {
      setOptimistic(null);
      toast.err(error);
    }
  }

  const onColor = tone === 'danger' ? 'var(--tp-danger)' : 'var(--tp-accent)';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={hideLabel ? label : undefined}
      aria-busy={working || undefined}
      disabled={disabled}
      onClick={() => void flip()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        background: 'transparent',
        border: 'none',
        padding: 0,
        color: 'var(--tp-fg)',
        font: 'inherit',
        cursor: disabled ? 'not-allowed' : working ? 'progress' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'relative',
          display: 'inline-block',
          inlineSize: '2.4rem',
          blockSize: '1.35rem',
          borderRadius: '999px',
          background: value ? onColor : 'var(--tp-muted)',
          transition: 'background 0.15s',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            insetBlockStart: '0.15rem',
            insetInlineStart: value ? '1.2rem' : '0.15rem',
            inlineSize: '1.05rem',
            blockSize: '1.05rem',
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
            transition: 'inset-inline-start 0.15s',
          }}
        />
      </span>
      {!hideLabel && <span>{label}</span>}
    </button>
  );
}

/**
 * Optimistic boolean backed by a React Query mutation: overlays `next` during
 * the call, reverts + toasts on error, and keeps the overlay until the given
 * queries have refetched (no flicker back to the stale value).
 */
export function useOptimisticToggle(
  current: boolean,
  mutate: (next: boolean) => Promise<unknown>,
  invalidate: readonly QueryKey[] = [],
) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);

  const mutation = useMutation({
    mutationFn: mutate,
    onMutate: async (next: boolean) => {
      await Promise.all(invalidate.map((queryKey) => queryClient.cancelQueries({ queryKey })));
      setOptimistic(next);
    },
    onError: (error) => {
      setOptimistic(null);
      toast.err(error);
    },
    onSettled: async () => {
      await Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      setOptimistic(null);
    },
  });

  const value = optimistic ?? current;
  const set = (next: boolean) =>
    mutation.mutateAsync(next).then(
      () => undefined,
      () => undefined,
    );
  return {
    value,
    busy: mutation.isPending,
    /** Resolves after the call and refetch; errors are already toasted. */
    set,
    toggle: () => set(!value),
  };
}

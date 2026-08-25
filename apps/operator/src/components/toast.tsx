/**
 * Toasts: `toast.ok(msg)`, `toast.info(msg)`, `toast.err(unknown | string)`.
 * `err` runs errorToMessageKey so every RPC / edge / network failure is ONE
 * call. Auto-dismiss 3 s, max 3 stacked, bottom-end corner (logical).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useLocale } from '../lib/i18n';
import { errorToMessageKey } from '../lib/errors';

export type ToastKind = 'ok' | 'err' | 'info';

export interface ToastApi {
  ok: (message: string) => void;
  info: (message: string) => void;
  /** Pass the caught error (mapped via errorToMessageKey) or an already-localised string. */
  err: (error: unknown) => void;
}

export const TOAST_TTL_MS = 3_000;
export const TOAST_MAX = 3;

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { tr } = useLocale();
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++seq.current;
      setItems((prev) => [...prev, { id, kind, message }].slice(-TOAST_MAX));
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_TTL_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      ok: (message) => push('ok', message),
      info: (message) => push('info', message),
      err: (error) => push('err', typeof error === 'string' ? error : tr(errorToMessageKey(error))),
    }),
    [push, tr],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}

const TONE: Record<ToastKind, CSSProperties> = {
  ok: { background: 'var(--tp-accent-2)', color: 'var(--tp-accent-2-contrast)' },
  info: { background: 'var(--tp-fg)', color: 'var(--tp-bg)' },
  err: { background: 'var(--tp-danger)', color: 'var(--tp-danger-contrast)' },
};

function ToastViewport({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div
      data-no-print
      style={{
        position: 'fixed',
        insetBlockEnd: '1rem',
        insetInlineEnd: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        zIndex: 200,
        maxInlineSize: 'min(24rem, calc(100vw - 2rem))',
        pointerEvents: 'none',
      }}
    >
      {items.map((item) => (
        <div
          key={item.id}
          role={item.kind === 'err' ? 'alert' : 'status'}
          onClick={() => onDismiss(item.id)}
          style={{
            ...TONE[item.kind],
            paddingBlock: '0.6rem',
            paddingInline: '0.9rem',
            borderRadius: '0.5rem',
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            fontSize: '0.95rem',
            cursor: 'pointer',
            pointerEvents: 'auto',
          }}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}

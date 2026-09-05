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
import { Icon, type IconName } from './icons';

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

/**
 * One success green in the product. This used to paint --tp-accent-2, the
 * MARKETING green, while StatusBadge, MessagePresenter and ChangeDueDisplay
 * all use the --tp-success family — so two different greens for "this worked"
 * could appear on one screen. Kind is also carried by an icon, never by hue
 * alone (rulebook 5.3 and 13).
 */
const TONE: Record<ToastKind, { style: CSSProperties; icon: IconName }> = {
  ok: { style: { background: 'var(--tp-success-soft)', color: 'var(--tp-success-fg)' }, icon: 'checkCircle' },
  info: { style: { background: 'var(--tp-info-soft)', color: 'var(--tp-info-fg)' }, icon: 'info' },
  err: { style: { background: 'var(--tp-danger-soft)', color: 'var(--tp-danger-fg)' }, icon: 'alert' },
};

function ToastViewport({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  const { tr } = useLocale();
  if (items.length === 0) return null;
  return (
    <div
      data-no-print
      style={{
        position: 'fixed',
        insetBlockEnd: 'var(--tp-sp-4)',
        insetInlineEnd: 'var(--tp-sp-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--tp-sp-2)',
        zIndex: 'var(--tp-z-toast)',
        maxInlineSize: 'min(24rem, calc(100vw - 2rem))',
        pointerEvents: 'none',
      }}
    >
      {items.map((item) => {
        const tone = TONE[item.kind];
        return (
          <div
            key={item.id}
            role={item.kind === 'err' ? 'alert' : 'status'}
            // Enter only. Playing an exit would mean holding a dismissed item
            // in the store past its removal, which is a lifecycle change.
            // Toasts used to blink into the corner a cashier is least likely
            // to be watching.
            className="tp-rise"
            style={{
              ...tone.style,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'var(--tp-sp-2)',
              paddingBlock: 'var(--tp-sp-2-5)',
              paddingInline: 'var(--tp-sp-3)',
              border: '1px solid var(--tp-border)',
              borderRadius: 'var(--tp-radius-ctl)',
              boxShadow: 'var(--tp-shadow-popover)',
              fontSize: 'var(--tp-fs-md)',
              pointerEvents: 'auto',
            }}
          >
            <Icon name={tone.icon} size={17} style={{ marginBlockStart: '0.1rem', flexShrink: 0 }} />
            <span style={{ flex: 1, minInlineSize: 0 }}>{item.message}</span>
            {/* Dismissal used to be an onClick on a bare div: no role, no
                tabIndex, no keyboard path at all. */}
            <button
              type="button"
              onClick={() => onDismiss(item.id)}
              aria-label={tr('common.close')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                padding: 0,
                inlineSize: '1.25rem',
                blockSize: '1.25rem',
                marginBlockStart: '0.1rem',
                flexShrink: 0,
                opacity: 0.7,
              }}
            >
              <Icon name="x" size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

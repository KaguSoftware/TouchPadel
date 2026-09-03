/**
 * Tiny shared UI kit for the operator app. Inline styles, CSS LOGICAL
 * PROPERTIES ONLY (RTL flips via dir on <html>), theme tokens from @touch/ui.
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useLocale } from '../lib/i18n';
import { errorToMessageKey } from '../lib/errors';

export const card: CSSProperties = {
  background: 'var(--tp-surface)',
  border: '1px solid var(--tp-border)',
  borderRadius: '0.5rem',
  paddingBlock: '0.75rem',
  paddingInline: '0.75rem',
};

export const inputStyle: CSSProperties = {
  paddingBlock: '0.45rem',
  paddingInline: '0.6rem',
  border: '1px solid var(--tp-border)',
  borderRadius: '0.35rem',
  fontSize: '1rem',
  inlineSize: '100%',
  boxSizing: 'border-box',
  background: 'var(--tp-bg)',
  color: 'var(--tp-fg)',
};

export function Button({
  children,
  onClick,
  onMouseEnter,
  onFocus,
  kind = 'default',
  disabled,
  type = 'button',
  style,
  autoFocus,
  title,
  'aria-label': ariaLabel,
  'aria-pressed': ariaPressed,
}: {
  children: ReactNode;
  onClick?: () => void;
  /** Prefetch hooks (the till's tab rail warms the detail query on hover). */
  onMouseEnter?: () => void;
  onFocus?: () => void;
  kind?: 'default' | 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  type?: 'button' | 'submit';
  style?: CSSProperties;
  autoFocus?: boolean;
  title?: string;
  'aria-label'?: string;
  /** For toggle-group buttons (range presets): exposes which one is active. */
  'aria-pressed'?: boolean;
}) {
  const base: CSSProperties = {
    paddingBlock: '0.45rem',
    paddingInline: '0.9rem',
    borderRadius: '0.4rem',
    border: '1px solid var(--tp-border)',
    background: 'var(--tp-bg)',
    color: 'var(--tp-fg)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    fontSize: '0.95rem',
  };
  if (kind === 'primary') {
    base.background = 'var(--tp-accent)';
    base.color = 'var(--tp-accent-contrast)';
    base.border = '1px solid var(--tp-accent)';
  } else if (kind === 'danger') {
    base.background = 'var(--tp-danger)';
    base.color = 'var(--tp-danger-contrast)';
    base.border = '1px solid var(--tp-danger)';
  } else if (kind === 'ghost') {
    base.background = 'transparent';
    base.border = '1px solid transparent';
  }
  return (
    <button
      type={type}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onFocus={onFocus}
      disabled={disabled}
      style={{ ...base, ...style }}
      autoFocus={autoFocus}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <label style={{ display: 'block', marginBlockEnd: '0.6rem', ...style }}>
      <span
        style={{
          display: 'block',
          fontSize: '0.8rem',
          color: 'var(--tp-muted-fg)',
          marginBlockEnd: '0.2rem',
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keep Tab / Shift+Tab cycling inside the panel (dialog focus trap). */
function trapTab(e: KeyboardEvent<HTMLElement>, panel: HTMLElement | null) {
  if (!panel) return;
  const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (nodes.length === 0) {
    e.preventDefault();
    return;
  }
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === panel)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Centered dialog: click-outside and Esc call `onClose`; focus is trapped
 * inside and restored to the opener on unmount.
 */
export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Callers may autoFocus a control; only claim focus when nothing inside has it.
    if (panel && !panel.contains(document.activeElement)) panel.focus();
    return () => {
      if (opener && typeof opener.focus === 'function' && opener.isConnected) opener.focus();
    };
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCloseRef.current();
    } else if (e.key === 'Tab') {
      trapTab(e, panelRef.current);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--tp-bg)',
          color: 'var(--tp-fg)',
          borderRadius: '0.6rem',
          padding: '1rem',
          inlineSize: wide ? 'min(56rem, 94vw)' : 'min(30rem, 94vw)',
          maxBlockSize: '90vh',
          overflowY: 'auto',
          outline: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBlockEnd: '0.8rem',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{title}</h2>
          <Button kind="ghost" onClick={onClose}>
            ✕
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Localized error line for a caught RPC/network error; renders nothing when error is null. */
export function ErrorText({ error }: { error: unknown }) {
  const { tr } = useLocale();
  if (error == null) return null;
  return (
    <p
      role="alert"
      style={{ color: 'var(--tp-danger)', fontSize: '0.9rem', marginBlock: '0.4rem' }}
    >
      {tr(errorToMessageKey(error))}
    </p>
  );
}

/** Cash amount pad — appends digits / 000, backspace, clear. */
export function AmountPad({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', '⌫'];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '0.35rem',
        inlineSize: '14rem',
      }}
    >
      {keys.map((k) => (
        <Button
          key={k}
          onClick={() => {
            if (k === '⌫') onChange(Math.floor(value / 10));
            else {
              const next = Number(`${value}${k}`);
              if (Number.isSafeInteger(next)) onChange(next);
            }
          }}
          style={{ paddingBlock: '0.8rem', fontSize: '1.1rem' }}
        >
          {k}
        </Button>
      ))}
    </div>
  );
}

export const REASON_CODES = [
  'customer_request',
  'wrong_item',
  'changed_mind',
  'quality',
  'spill',
  'staff_error',
  'duplicate',
  'comp',
  'weather',
  'expired',
  'other',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/**
 * PIN + reason modal shared by discount / void / refund flows.
 * Submits (pin, reasonCode); the caller runs the RPC and passes errors back in.
 */
export function PinReasonModal({
  title,
  onSubmit,
  onClose,
  busy,
  error,
  reasons = REASON_CODES,
  children,
}: {
  title: string;
  onSubmit: (pin: string, reasonCode: ReasonCode) => void;
  onClose: () => void;
  busy?: boolean;
  error?: unknown;
  reasons?: readonly ReasonCode[];
  children?: ReactNode;
}) {
  const { tr } = useLocale();
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState<ReasonCode>(reasons[0] ?? 'other');
  return (
    <Modal title={title} onClose={onClose}>
      {children}
      <Field label={tr('op.common.reason')}>
        <select
          style={inputStyle}
          value={reason}
          onChange={(e) => setReason(e.target.value as ReasonCode)}
        >
          {reasons.map((r) => (
            <option key={r} value={r}>
              {tr(`op.reasons.${r}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={tr('op.common.pin')}>
        <input
          style={inputStyle}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          maxLength={6}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
      </Field>
      <ErrorText error={error} />
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>{tr('common.cancel')}</Button>
        <Button
          kind="primary"
          disabled={busy || pin.length < 4}
          onClick={() => onSubmit(pin, reason)}
        >
          {tr('common.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

/* ---------- W0 foundation primitives (operator-slice.md §2) ---------- */

const SPINNER_PX: Record<'xs' | 'sm' | 'md', string> = {
  xs: '0.8rem',
  sm: '1.1rem',
  md: '1.6rem',
};

/** Inline spinner; `tpSpin` keyframes come from <GlobalStyles/>. */
export function Spinner({
  size = 'sm',
  label,
  style,
}: {
  size?: 'xs' | 'sm' | 'md';
  label?: string;
  style?: CSSProperties;
}) {
  const { tr } = useLocale();
  const px = SPINNER_PX[size];
  return (
    <span
      role="status"
      aria-label={label ?? tr('common.loading')}
      style={{
        display: 'inline-block',
        inlineSize: px,
        blockSize: px,
        verticalAlign: 'middle',
        ...style,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="100%"
        height="100%"
        aria-hidden="true"
        style={{ animation: 'tpSpin 0.8s linear infinite', display: 'block' }}
      >
        <circle cx="12" cy="12" r="9" fill="none" stroke="var(--tp-border)" strokeWidth="3" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          fill="none"
          stroke="var(--tp-accent)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/** Shimmer placeholder blocks while a list/card loads (`tpPulse` keyframes). */
export function Skeleton({
  lines = 3,
  blockSize = '0.9rem',
  style,
}: {
  lines?: number;
  blockSize?: string;
  style?: CSSProperties;
}) {
  return (
    <div aria-hidden="true" style={{ display: 'grid', gap: '0.5rem', ...style }}>
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <div
          key={i}
          style={{
            blockSize,
            inlineSize: i === lines - 1 && lines > 1 ? '60%' : '100%',
            borderRadius: '0.3rem',
            background: 'var(--tp-border)',
            animation: 'tpPulse 1.4s ease-in-out infinite',
            animationDelay: `${i * 0.12}s`,
          }}
        />
      ))}
    </div>
  );
}

export interface TabItem<T extends string> {
  id: T;
  label: string;
  disabled?: boolean;
}

/** In-section tab strip (`role="tablist"`); arrow keys move, dir-aware. */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  style,
}: {
  value: T;
  onChange: (next: T) => void;
  items: readonly TabItem<T>[];
  style?: CSSProperties;
}) {
  const { dir } = useLocale();
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const enabled = items.filter((t) => !t.disabled);
    const index = enabled.findIndex((t) => t.id === value);
    if (index === -1 || enabled.length === 0) return;
    const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const backward = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    let next = index;
    if (e.key === forward) next = (index + 1) % enabled.length;
    else if (e.key === backward) next = (index - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    else return;
    e.preventDefault();
    onChange(enabled[next]!.id);
  }
  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      style={{
        display: 'flex',
        gap: '0.25rem',
        borderBlockEnd: '1px solid var(--tp-border)',
        marginBlockEnd: '0.8rem',
        overflowX: 'auto',
        ...style,
      }}
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            style={{
              paddingBlock: '0.5rem',
              paddingInline: '0.9rem',
              border: 'none',
              borderBlockEnd: selected ? '2px solid var(--tp-accent)' : '2px solid transparent',
              marginBlockEnd: '-1px',
              background: 'transparent',
              color: selected ? 'var(--tp-fg)' : 'var(--tp-muted-fg)',
              fontWeight: selected ? 700 : 400,
              fontSize: '0.95rem',
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              opacity: item.disabled ? 0.5 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/** Thin wrapper over a native `<select>` styled like our inputs. */
export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  id,
  style,
}: {
  value: T | '';
  onChange: (next: T) => void;
  options: readonly SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  style?: CSSProperties;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      style={{ ...inputStyle, ...style }}
    >
      {placeholder !== undefined && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

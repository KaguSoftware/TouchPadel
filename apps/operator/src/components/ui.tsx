/**
 * Shared UI kit for the operator app. Inline styles, CSS LOGICAL PROPERTIES
 * ONLY (RTL flips via dir on <html>), theme tokens from @touch/ui. Interaction
 * states live in GlobalStyles (class hooks: tp-btn, tp-tile, tp-row, tp-table).
 *
 * Every action control accepts `busy` (spec R10) and is non-actionable while
 * true. Nothing in here decides whether an action is permitted.
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useLocale } from '../lib/i18n';
import { errorToMessageKey } from '../lib/errors';
import { Icon, type IconName } from './icons';

export const card: CSSProperties = {
  background: 'var(--tp-surface)',
  border: '1px solid var(--tp-border)',
  borderRadius: 'var(--tp-radius-panel)',
  paddingBlock: '0.75rem',
  paddingInline: '0.85rem',
};

/** A quieter panel for toolbars and secondary groups. */
export const panelMuted: CSSProperties = {
  background: 'var(--tp-surface-2)',
  border: '1px solid var(--tp-border)',
  borderRadius: 'var(--tp-radius-panel)',
  paddingBlock: '0.75rem',
  paddingInline: '0.85rem',
};

export const inputStyle: CSSProperties = {
  paddingBlock: '0.45rem',
  paddingInline: '0.65rem',
  border: '1px solid var(--tp-border-strong)',
  borderRadius: 'var(--tp-radius-ctl)',
  fontSize: 'var(--tp-fs-md)',
  lineHeight: 1.35,
  inlineSize: '100%',
  minBlockSize: '2.25rem',
  boxSizing: 'border-box',
  background: 'var(--tp-surface)',
  color: 'var(--tp-fg)',
};

export type ButtonKind = 'default' | 'primary' | 'danger' | 'ghost' | 'soft';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export function Button({
  children,
  onClick,
  onMouseEnter,
  onFocus,
  kind = 'default',
  size = 'md',
  icon,
  iconEnd,
  disabled,
  busy,
  type = 'button',
  style,
  autoFocus,
  title,
  'aria-label': ariaLabel,
  'aria-pressed': ariaPressed,
  'data-testid': testId,
}: {
  children?: ReactNode;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Prefetch hooks (the till's tab rail warms the detail query on hover). */
  onMouseEnter?: () => void;
  onFocus?: () => void;
  kind?: ButtonKind;
  size?: ButtonSize;
  icon?: IconName;
  iconEnd?: IconName;
  disabled?: boolean;
  /** Spec R10: non-actionable while true; shows a spinner in place of the icon. */
  busy?: boolean;
  type?: 'button' | 'submit';
  style?: CSSProperties;
  autoFocus?: boolean;
  title?: string;
  'aria-label'?: string;
  /** For toggle-group buttons (range presets): exposes which one is active. */
  'aria-pressed'?: boolean;
  'data-testid'?: string;
}) {
  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 20 : size === 'xl' ? 22 : 16;
  return (
    <button
      type={type}
      className={`tp-btn${!children ? ' tp-iconbtn' : ''}`}
      data-kind={kind}
      data-size={size}
      data-busy={busy ? 'true' : undefined}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onFocus={onFocus}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      style={style}
      autoFocus={autoFocus}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      data-testid={testId}
    >
      {busy ? <Spinner size="xs" /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
      {iconEnd && !busy && <Icon name={iconEnd} size={iconSize} />}
    </button>
  );
}

/**
 * A labelled control. The `<label>` wraps ONLY its own text and the control:
 * hint and error are siblings, because everything inside a wrapping label
 * becomes part of the control's accessible name (a "Qty" field with a "g" hint
 * answered to "Qty g", and every exact label query missed it). The asterisk is
 * decorative — `required` on the control itself is what carries the meaning.
 */
export function Field({
  label,
  children,
  hint,
  error,
  required,
  style,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div style={{ marginBlockEnd: '0.85rem', ...style }}>
      <label style={{ display: 'block' }}>
        <span
          // The required marker is a CSS pseudo-element, not a character: an
          // asterisk in the label's text becomes part of the control's name.
          className={required ? 'tp-req' : undefined}
          style={{
            display: 'block',
            fontSize: 'var(--tp-fs-sm)',
            fontWeight: 600,
            color: 'var(--tp-fg)',
            marginBlockEnd: '0.3rem',
          }}
        >
          {label}
        </span>
        {children}
      </label>
      {hint && !error && (
        <span
          style={{
            display: 'block',
            fontSize: 'var(--tp-fs-xs)',
            color: 'var(--tp-muted-fg)',
            marginBlockStart: '0.25rem',
          }}
        >
          {hint}
        </span>
      )}
      {error && (
        <span
          role="alert"
          style={{
            display: 'block',
            fontSize: 'var(--tp-fs-xs)',
            color: 'var(--tp-danger-fg)',
            marginBlockStart: '0.25rem',
          }}
        >
          {error}
        </span>
      )}
    </div>
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
  size,
  subtitle,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  subtitle?: ReactNode;
  footer?: ReactNode;
}) {
  const { tr } = useLocale();
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

  const width =
    size === 'sm'
      ? 'min(24rem, 94vw)'
      : size === 'lg' || wide
        ? 'min(56rem, 94vw)'
        : size === 'xl'
          ? 'min(72rem, 96vw)'
          : 'min(32rem, 94vw)';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="tp-fade"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--tp-overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: '1rem',
      }}
      onClick={onClose}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="tp-rise"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--tp-surface)',
          color: 'var(--tp-fg)',
          borderRadius: 'var(--tp-radius-dialog)',
          boxShadow: 'var(--tp-shadow-dialog)',
          border: '1px solid var(--tp-border)',
          inlineSize: width,
          maxBlockSize: '92vh',
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
            paddingBlock: '0.9rem 0.6rem',
            paddingInline: '1.1rem',
          }}
        >
          <div style={{ minInlineSize: 0 }}>
            <h2 style={{ fontSize: 'var(--tp-fs-xl)', fontWeight: 700 }}>{title}</h2>
            {subtitle && (
              <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', marginBlockStart: '0.15rem' }}>
                {subtitle}
              </p>
            )}
          </div>
          <Button kind="ghost" size="sm" icon="x" onClick={onClose} aria-label={tr('common.close')} />
        </div>
        <div style={{ paddingInline: '1.1rem', paddingBlockEnd: footer ? '0.5rem' : '1rem', overflowY: 'auto', minBlockSize: 0 }}>
          {children}
        </div>
        {footer && (
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              justifyContent: 'flex-end',
              paddingBlock: '0.75rem',
              paddingInline: '1.1rem',
              borderBlockStart: '1px solid var(--tp-border)',
              background: 'var(--tp-surface-2)',
              borderEndStartRadius: 'var(--tp-radius-dialog)',
              borderEndEndRadius: 'var(--tp-radius-dialog)',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** Localized error line for a caught RPC/network error; renders nothing when error is null. */
export function ErrorText({ error, style }: { error: unknown; style?: CSSProperties }) {
  const { tr } = useLocale();
  if (error == null) return null;
  return (
    <p
      role="alert"
      style={{
        display: 'flex',
        gap: '0.4rem',
        alignItems: 'flex-start',
        color: 'var(--tp-danger-fg)',
        background: 'var(--tp-danger-soft)',
        borderRadius: 'var(--tp-radius-ctl)',
        paddingBlock: '0.45rem',
        paddingInline: '0.6rem',
        fontSize: 'var(--tp-fs-sm)',
        marginBlock: '0.5rem',
        ...style,
      }}
    >
      <Icon name="alert" size={16} style={{ marginBlockStart: '0.1rem' }} />
      <span>{tr(errorToMessageKey(error))}</span>
    </p>
  );
}

/** Cash amount pad — appends digits / 000, backspace, clear. Keyboard-operable. */
export function AmountPad({
  value,
  onChange,
  onConfirm,
  disabled,
}: {
  value: number;
  onChange: (next: number) => void;
  onConfirm?: () => void;
  disabled?: boolean;
}) {
  const { tr } = useLocale();
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', '⌫'];
  function press(k: string) {
    if (k === '⌫') onChange(Math.floor(value / 10));
    else {
      const next = Number(`${value}${k}`);
      if (Number.isSafeInteger(next)) onChange(next);
    }
  }
  return (
    <div
      role="group"
      aria-label={tr('ws.kit.keypad.confirm')}
      onKeyDown={(e) => {
        if (disabled) return;
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          press(e.key);
        } else if (e.key === 'Backspace') {
          e.preventDefault();
          press('⌫');
        } else if (e.key === 'Enter' && onConfirm) {
          e.preventDefault();
          onConfirm();
        }
      }}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '0.4rem',
        inlineSize: '15rem',
      }}
    >
      {keys.map((k) => (
        <Button
          key={k}
          size="lg"
          disabled={disabled}
          aria-label={k === '⌫' ? tr('ws.kit.keypad.backspace') : k}
          onClick={() => press(k)}
          style={{ fontSize: 'var(--tp-fs-xl)', minBlockSize: '3.25rem' }}
        >
          {k === '⌫' ? <Icon name="undo" size={20} /> : k}
        </Button>
      ))}
      <Button kind="ghost" size="sm" disabled={disabled} onClick={() => onChange(0)} style={{ gridColumn: '1 / -1' }}>
        {tr('ws.kit.keypad.clear')}
      </Button>
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
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" busy={busy} disabled={pin.length < 4} onClick={() => onSubmit(pin, reason)}>
            {tr('common.confirm')}
          </Button>
        </>
      }
    >
      {children}
      <Field label={tr('op.common.reason')}>
        <select style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value as ReasonCode)}>
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
    </Modal>
  );
}

/* ---------- foundation primitives ---------- */

const SPINNER_PX: Record<'xs' | 'sm' | 'md' | 'lg', string> = {
  xs: '0.9rem',
  sm: '1.1rem',
  md: '1.6rem',
  lg: '2.4rem',
};

/** Inline spinner; `tpSpin` keyframes come from <GlobalStyles/>. */
export function Spinner({
  size = 'sm',
  label,
  style,
}: {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  label?: string;
  style?: CSSProperties;
}) {
  const { tr } = useLocale();
  const px = SPINNER_PX[size];
  return (
    <span
      role="status"
      aria-label={label ?? tr('common.loading')}
      style={{ display: 'inline-block', inlineSize: px, blockSize: px, verticalAlign: 'middle', ...style }}
    >
      <svg
        viewBox="0 0 24 24"
        width="100%"
        height="100%"
        aria-hidden="true"
        style={{ animation: 'tpSpin 0.8s linear infinite', display: 'block' }}
      >
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
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
    <div aria-hidden="true" style={{ display: 'grid', gap: '0.55rem', ...style }}>
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <div
          key={i}
          style={{
            blockSize,
            inlineSize: i === lines - 1 && lines > 1 ? '60%' : '100%',
            borderRadius: '0.3rem',
            background: 'var(--tp-surface-3)',
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
  count?: number;
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
        marginBlockEnd: '0.9rem',
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
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              paddingBlock: '0.55rem',
              paddingInline: '0.85rem',
              border: 'none',
              borderBlockEnd: selected ? '2px solid var(--tp-accent)' : '2px solid transparent',
              marginBlockEnd: '-1px',
              background: 'transparent',
              color: selected ? 'var(--tp-fg)' : 'var(--tp-muted-fg)',
              fontWeight: selected ? 700 : 500,
              fontSize: 'var(--tp-fs-md)',
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              opacity: item.disabled ? 0.5 : 1,
              whiteSpace: 'nowrap',
              transition: 'color var(--tp-dur-fast) var(--tp-ease-out)',
            }}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                style={{
                  fontSize: 'var(--tp-fs-xs)',
                  background: selected ? 'var(--tp-accent-soft)' : 'var(--tp-surface-3)',
                  color: selected ? 'var(--tp-accent-soft-fg)' : 'var(--tp-muted-fg)',
                  borderRadius: 'var(--tp-radius-pill)',
                  paddingInline: '0.4rem',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {item.count}
              </span>
            )}
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
  'aria-label': ariaLabel,
}: {
  value: T | '';
  onChange: (next: T) => void;
  options: readonly SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  style?: CSSProperties;
  'aria-label'?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
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

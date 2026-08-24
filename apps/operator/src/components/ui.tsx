/**
 * Tiny shared UI kit for the operator app. Inline styles, CSS LOGICAL
 * PROPERTIES ONLY (RTL flips via dir on <html>), theme tokens from @touch/ui.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
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
  kind = 'default',
  disabled,
  type = 'button',
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'default' | 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  type?: 'button' | 'submit';
  style?: CSSProperties;
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
    <button type={type} onClick={onClick} disabled={disabled} style={{ ...base, ...style }}>
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
  return (
    <div
      role="dialog"
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
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--tp-bg)',
          color: 'var(--tp-fg)',
          borderRadius: '0.6rem',
          padding: '1rem',
          inlineSize: wide ? 'min(56rem, 94vw)' : 'min(30rem, 94vw)',
          maxBlockSize: '90vh',
          overflowY: 'auto',
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
    <p role="alert" style={{ color: 'var(--tp-danger)', fontSize: '0.9rem', marginBlock: '0.4rem' }}>
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
        <Button kind="primary" disabled={busy || pin.length < 4} onClick={() => onSubmit(pin, reason)}>
          {tr('common.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

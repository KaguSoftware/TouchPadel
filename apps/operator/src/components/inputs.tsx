/**
 * Form inputs shared by admin screens: integer IQD money, percent,
 * paired EN/AR fields, and move-up / move-down reorder buttons. Inline styles,
 * logical properties only; numeric inputs are always `dir="ltr"`.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { formatIQD } from '@touch/i18n';
import { useLocale } from '../lib/i18n';
import { Icon } from './icons';
import { Button, Field, inputStyle } from './ui';

const numericStyle: CSSProperties = { ...inputStyle, fontVariantNumeric: 'tabular-nums' };

function digitsOnly(raw: string): string {
  // Accept Arabic-Indic digits from an Arabic keyboard, then strip everything else.
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '');
}

/**
 * Integer IQD. Blank means `null` when `allowEmpty` (cost rule: blank ≠ 0),
 * otherwise blank commits `0`. Shows a formatted hint beside the field.
 */
export function MoneyInput({
  value,
  onChange,
  allowEmpty,
  min = 0,
  disabled,
  placeholder,
  id,
  style,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  allowEmpty?: boolean;
  min?: number;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  style?: CSSProperties;
}) {
  const { locale } = useLocale();
  const [text, setText] = useState(value === null ? '' : String(value));

  useEffect(() => {
    const parsed = text === '' ? null : Number(text);
    if (parsed !== value) setText(value === null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function commit(raw: string) {
    const digits = digitsOnly(raw);
    setText(digits);
    if (digits === '') {
      onChange(allowEmpty ? null : 0);
      return;
    }
    const n = Number(digits);
    if (!Number.isSafeInteger(n)) return;
    onChange(Math.max(min, n));
  }

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', ...style }}>
      <input
        id={id}
        style={numericStyle}
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onChange={(e) => commit(e.target.value)}
      />
      {value !== null && (
        <span
          dir="ltr"
          style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', whiteSpace: 'nowrap' }}
        >
          {formatIQD(value, locale)}
        </span>
      )}
    </span>
  );
}

/** Integer percent clamped to [min, max] (default 0–99). */
export function PercentInput({
  value,
  onChange,
  min = 0,
  max = 99,
  disabled,
  id,
  style,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  id?: string;
  style?: CSSProperties;
}) {
  const { tr } = useLocale();
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text === '' ? NaN : text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', ...style }}>
      <input
        id={id}
        style={{ ...numericStyle, inlineSize: '5rem' }}
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        value={text}
        onChange={(e) => {
          const digits = digitsOnly(e.target.value).slice(0, 3);
          setText(digits);
          if (digits === '') {
            onChange(min);
            return;
          }
          onChange(Math.min(max, Math.max(min, Number(digits))));
        }}
        onBlur={() => setText(String(value))}
      />
      {/* Arabic writes the percent sign as U+066A, so the unit is a catalog
          string like every other word on the screen — a literal '%' left half
          of a localised figure in Latin. */}
      <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.kit.common.percent')}</span>
    </span>
  );
}

/** Paired EN (ltr) / AR (rtl) inputs — dir is per FIELD, not per document. */
export function BilingualFields({
  labelEn,
  labelAr,
  en,
  ar,
  onEn,
  onAr,
  multiline,
  maxLength,
  placeholderEn,
  placeholderAr,
  disabled,
}: {
  labelEn: string;
  labelAr: string;
  en: string;
  ar: string;
  onEn: (v: string) => void;
  onAr: (v: string) => void;
  multiline?: boolean;
  maxLength?: number;
  placeholderEn?: string;
  placeholderAr?: string;
  disabled?: boolean;
}) {
  const textareaStyle: CSSProperties = {
    ...inputStyle,
    minBlockSize: '4.5rem',
    resize: 'vertical',
    fontFamily: 'inherit',
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
      <Field label={labelEn}>
        {multiline ? (
          <textarea
            style={textareaStyle}
            dir="ltr"
            value={en}
            maxLength={maxLength}
            placeholder={placeholderEn}
            disabled={disabled}
            onChange={(e) => onEn(e.target.value)}
          />
        ) : (
          <input
            style={inputStyle}
            dir="ltr"
            value={en}
            maxLength={maxLength}
            placeholder={placeholderEn}
            disabled={disabled}
            onChange={(e) => onEn(e.target.value)}
          />
        )}
      </Field>
      <Field label={labelAr}>
        {multiline ? (
          <textarea
            style={textareaStyle}
            dir="rtl"
            lang="ar"
            value={ar}
            maxLength={maxLength}
            placeholder={placeholderAr}
            disabled={disabled}
            onChange={(e) => onAr(e.target.value)}
          />
        ) : (
          <input
            style={inputStyle}
            dir="rtl"
            lang="ar"
            value={ar}
            maxLength={maxLength}
            placeholder={placeholderAr}
            disabled={disabled}
            onChange={(e) => onAr(e.target.value)}
          />
        )}
      </Field>
    </div>
  );
}

/**
 * Move-up / move-down ghost buttons for swap-with-neighbour reordering (no drag
 * lib). They drew literal ▲ / ▼ characters in an app whose icon module opens
 * with "no emoji as icons": a different family, a different stroke weight and a
 * different vertical metric from every other glyph in the row. One chevron with
 * a rotate, the same trick DataTable's sort indicator uses.
 */
export function SortButtons({
  onUp,
  onDown,
  disabledUp,
  disabledDown,
  style,
}: {
  onUp: () => void;
  onDown: () => void;
  disabledUp?: boolean;
  disabledDown?: boolean;
  style?: CSSProperties;
}) {
  const { tr } = useLocale();
  const compact: CSSProperties = {
    paddingBlock: '0.15rem',
    paddingInline: '0.45rem',
    lineHeight: 1,
  };
  return (
    <span style={{ display: 'inline-flex', gap: '0.15rem', ...style }}>
      <Button
        kind="ghost"
        onClick={onUp}
        disabled={disabledUp}
        aria-label={tr('op.common.moveUp')}
        title={tr('op.common.moveUp')}
        style={compact}
      >
        <Icon name="chevronDown" size={14} style={{ transform: 'rotate(180deg)' }} />
      </Button>
      <Button
        kind="ghost"
        onClick={onDown}
        disabled={disabledDown}
        aria-label={tr('op.common.moveDown')}
        title={tr('op.common.moveDown')}
        style={compact}
      >
        <Icon name="chevronDown" size={14} />
      </Button>
    </span>
  );
}

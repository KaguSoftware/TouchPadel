/**
 * The settings screens' own field shapes, shared by the venue details tab and
 * the online deposit rules beside it: a whole number with its unit written
 * after it, and the read-only "label, what it means, value" rows a manager
 * sees in place of the form.
 */
import type { ReactNode } from 'react';
import { Field, inputStyle } from '../../../components/ui';

export function NumberField({
  label,
  hint,
  unit,
  value,
  onChange,
  error,
  optional,
  placeholder,
}: {
  label: string;
  hint: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  optional?: boolean;
  placeholder?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional} style={{ marginBlockEnd: 0 }}>
      <UnitInput unit={unit} value={value} onChange={onChange} placeholder={placeholder} />
    </Field>
  );
}

/** A whole-number input with its unit written after it, so "12" is never read as minutes. */
export function UnitInput({ unit, value, onChange, ...rest }: { unit: string; value: string; onChange: (v: string) => void; [aria: string]: unknown }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
      <input
        {...(rest as Record<string, unknown>)}
        style={{ ...inputStyle, inlineSize: '7rem', fontVariantNumeric: 'tabular-nums' }}
        dir="ltr"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
      />
      <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{unit}</span>
    </span>
  );
}

/**
 * Label, value and one line of what it means — the value at the end of the
 * row, where the eye lands after reading the label, as on the /ops cards.
 */
export function Facts({ rows }: { rows: { label: string; value: ReactNode | null; empty?: string; hint?: string }[] }) {
  return (
    <dl style={{ margin: 0, display: 'grid' }}>
      {rows.map((r, i) => (
        <div
          key={r.label}
          style={{
            display: 'flex',
            gap: 'var(--tp-sp-4)',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            paddingBlock: 'var(--tp-sp-2)',
            borderBlockStart: i > 0 ? '1px solid var(--tp-border)' : undefined,
          }}
        >
          <div style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 18rem', minInlineSize: 0 }}>
            <dt style={{ fontWeight: 600, fontSize: 'var(--tp-fs-sm)' }}>{r.label}</dt>
            {r.hint && <dd style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{r.hint}</dd>}
          </div>
          <dd style={{ margin: 0, fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'end', color: r.value === null ? 'var(--tp-muted-fg)' : undefined }}>
            {r.value === null ? r.empty : r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

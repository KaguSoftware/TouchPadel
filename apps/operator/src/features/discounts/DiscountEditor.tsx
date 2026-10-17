/**
 * The discount form, shared by the customer record and the bill's dialog: a
 * Café and shop part and a Court fee part (each None / % / IQD and a value),
 * the reason as chips, and an optional note. The host owns the draft and its
 * check (discountLogic.checkDraft); this only draws them. Part errors show as
 * soon as a typed value is out of range, the rest (nothing set, no reason)
 * once the host asks (`showErrors`, after a press of Save).
 */
import { useId, useRef } from 'react';
import { useLocale } from '../../lib/i18n';
import { Field, inputStyle } from '../../components/ui';
import { SegmentedControl } from '../../components/kit';
import { Icon } from '../../components/icons';
import {
  DISCOUNT_REASONS,
  NOTE_MAX,
  type DiscountDraft,
  type DraftCheck,
  type DraftSections,
  type PartDraft,
  type PartError,
  type PartMode,
} from './discountLogic';

const ERROR_KEY = {
  empty: 'ws.discounts.editor.errors.empty',
  percentRange: 'ws.discounts.editor.errors.percentRange',
  amountRange: 'ws.discounts.editor.errors.amountRange',
} as const satisfies Record<PartError, string>;

const errorLine = { margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-danger-fg)' } as const;

export function DiscountEditor({
  draft,
  onChange,
  sections,
  check,
  showErrors,
  disabled,
  showNote = true,
}: {
  draft: DiscountDraft;
  onChange: (next: DiscountDraft) => void;
  sections: DraftSections;
  check: DraftCheck;
  /** Show every error, not only a value already typed out of range (after a press of Save). */
  showErrors: boolean;
  disabled?: boolean;
  /** The note belongs to the customer's record; a bill's "this bill only" has none. */
  showNote?: boolean;
}) {
  const { tr } = useLocale();
  const id = useId();
  const anyPart = (sections.cafe && draft.cafe.mode !== 'none') || (sections.court && draft.court.mode !== 'none');
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      {sections.cafe && (
        <PartRow
          label={tr('ws.discounts.part.cafe')}
          per={tr('ws.discounts.editor.perBill')}
          value={draft.cafe}
          error={check.errors.cafe}
          showErrors={showErrors}
          disabled={disabled}
          testId="discount-cafe"
          onChange={(cafe) => onChange({ ...draft, cafe })}
        />
      )}
      {sections.court && (
        <PartRow
          label={tr('ws.discounts.part.court')}
          per={tr('ws.discounts.editor.perBooking')}
          value={draft.court}
          error={check.errors.court}
          showErrors={showErrors}
          disabled={disabled}
          testId="discount-court"
          onChange={(court) => onChange({ ...draft, court })}
        />
      )}
      {showErrors && check.errors.parts && (
        <p role="alert" style={errorLine}>
          {tr('ws.discounts.editor.errors.parts')}
        </p>
      )}

      {/* The reason: chips over hidden radios, so the group stays a real radiogroup. */}
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        <span id={`${id}-reason`} style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
          {tr('ws.discounts.editor.reason')}
        </span>
        <div role="radiogroup" aria-labelledby={`${id}-reason`} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-2)' }}>
          {DISCOUNT_REASONS.map((r) => (
            <label key={r} className="tp-choice" data-selected={draft.reason === r ? 'true' : undefined} style={{ gap: 'var(--tp-sp-1-5)' }}>
              <input
                className="tp-sr-only"
                type="radio"
                name={`${id}-reason`}
                value={r}
                checked={draft.reason === r}
                disabled={disabled}
                onChange={() => onChange({ ...draft, reason: r })}
              />
              {draft.reason === r && <Icon name="check" size={14} />}
              <span>{tr(`ws.discounts.reason.${r}`)}</span>
            </label>
          ))}
        </div>
        {showErrors && anyPart && check.errors.reason && (
          <p role="alert" style={errorLine}>
            {tr('ws.discounts.editor.errors.reason')}
          </p>
        )}
      </div>

      {showNote && (
        <Field label={tr('ws.discounts.editor.note')} optional error={check.errors.note ? tr('ws.discounts.editor.errors.note') : undefined} style={{ marginBlockEnd: 0 }}>
          <input
            style={inputStyle}
            value={draft.note}
            maxLength={NOTE_MAX}
            disabled={disabled}
            placeholder={tr('ws.discounts.editor.notePlaceholder')}
            onChange={(e) => onChange({ ...draft, note: e.target.value })}
          />
        </Field>
      )}
    </div>
  );
}

/** One part: its name, None / % / IQD, and the value with its unit. */
function PartRow({
  label,
  per,
  value,
  error,
  showErrors,
  disabled,
  testId,
  onChange,
}: {
  label: string;
  /** "off each bill" / "off each booking": what an amount is taken off. */
  per: string;
  value: PartDraft;
  error: PartError | undefined;
  showErrors: boolean;
  disabled?: boolean;
  testId: string;
  onChange: (next: PartDraft) => void;
}) {
  const { tr } = useLocale();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  // An empty value is said only once Save was pressed; one typed out of range at once.
  const shown = error && (showErrors || (error !== 'empty' && value.text.trim() !== '')) ? error : undefined;
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }} data-testid={testId}>
      <span id={`${id}-label`} style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
        <SegmentedControl<PartMode>
          value={value.mode}
          aria-label={tr('ws.discounts.editor.typeLabel', { part: label })}
          onChange={(mode) => {
            if (disabled || mode === value.mode) return;
            // A figure typed for one kind means nothing in the other: 20% must not become 20 IQD.
            onChange({ mode, text: '' });
            if (mode !== 'none') requestAnimationFrame(() => input.current?.focus());
          }}
          options={[
            { value: 'none', label: tr('ws.discounts.editor.none'), disabled },
            { value: 'percent', label: tr('ws.discounts.editor.percent'), disabled },
            { value: 'amount', label: tr('ws.discounts.editor.amount'), disabled },
          ]}
        />
        {value.mode !== 'none' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)' }}>
            <input
              ref={input}
              style={{ ...inputStyle, inlineSize: value.mode === 'percent' ? '6rem' : '9rem', fontVariantNumeric: 'tabular-nums', textAlign: 'end' }}
              dir="ltr"
              inputMode={value.mode === 'percent' ? 'decimal' : 'numeric'}
              autoComplete="off"
              aria-label={tr('ws.discounts.editor.valueLabel', { part: label })}
              aria-invalid={shown ? true : undefined}
              aria-describedby={shown ? `${id}-error` : undefined}
              placeholder={tr(value.mode === 'percent' ? 'ws.discounts.editor.percentPlaceholder' : 'ws.discounts.editor.amountPlaceholder')}
              value={value.text}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, text: e.target.value })}
            />
            <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
              {value.mode === 'percent' ? tr('ws.kit.common.percent') : `${tr('ws.discounts.editor.amount')} ${per}`}
            </span>
          </span>
        )}
      </div>
      {shown && (
        <p id={`${id}-error`} role="alert" style={errorLine}>
          {tr(ERROR_KEY[shown])}
        </p>
      )}
    </div>
  );
}

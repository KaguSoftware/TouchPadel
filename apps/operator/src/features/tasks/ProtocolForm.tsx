/**
 * One protocol form, drawn from a `@touch/core/protocols` field list
 * (build-contracts-2026-09-23 §7.2): the same fields the phone asks for, with
 * the operator's own controls. The caller owns the draft (formModel.ts), the
 * option lists for every id field (`sources`, by dotted path), which fields
 * it draws itself (`hidden`), and the issues to show, which are
 * `validateStep`'s or the server's hint, keyed the server's way.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { FieldDef } from '@touch/core/protocols';
import type { FieldIssue } from '@touch/core/protocols';
import { formatWeekdayShort, type MessageKey } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button, Field, Select, inputStyle } from '../../components/ui';
import { DateField, MoneyInput } from '../../components/inputs';
import { OPTION_LABELS, fieldLabelKey } from './fieldLabels';
import { getIn, hintFor, setIn, emptyDraft, emptyValue, type Draft, type PriceMapRow } from './formModel';

export interface FormOption {
  value: string;
  label: string;
}

export interface ProtocolFormProps {
  fields: readonly FieldDef[];
  draft: Draft;
  onChange: (next: Draft) => void;
  /** Choices for id fields, by dotted path without list indexes (`lines.ingredient_id`). */
  sources?: Readonly<Record<string, readonly FormOption[]>>;
  /** Dotted paths the caller draws itself or leaves out (`change`, `category_id`). */
  hidden?: ReadonlySet<string>;
  /** A hint under a field, by dotted path. */
  hints?: Readonly<Record<string, string>>;
  issues?: readonly FieldIssue[];
  disabled?: boolean;
}

const NONE = '__none__';

const textareaStyle: CSSProperties = { ...inputStyle, minBlockSize: '4.5rem', resize: 'vertical', fontFamily: 'inherit' };

/** An English name is typed left to right and an Arabic one right to left, whatever the screen's language. */
function dirFor(name: string): 'ltr' | 'rtl' | 'auto' {
  if (name === 'en' || name.endsWith('_en')) return 'ltr';
  if (name === 'ar' || name.endsWith('_ar')) return 'rtl';
  return 'auto';
}

type Path = readonly (string | number)[];

/**
 * A field label inside a sentence ("Add ticker line", not "Add Ticker line").
 * The labels are written as headings; Arabic has no case, so this only ever
 * changes an English one.
 */
function inSentence(label: string): string {
  return label.charAt(0).toLocaleLowerCase('en') + label.slice(1);
}

export function ProtocolForm(props: ProtocolFormProps) {
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
      <Fields {...props} fields={props.fields} base={[]} />
    </div>
  );
}

function Fields({ fields, base, ...props }: ProtocolFormProps & { base: Path }) {
  const names = base.filter((k): k is string => typeof k === 'string');
  return (
    <>
      {fields.map((def) => {
        const dotted = [...names, def.name].join('.');
        if (props.hidden?.has(dotted)) return null;
        return <FieldControl key={def.name} {...props} fields={fields} def={def} path={[...base, def.name]} />;
      })}
    </>
  );
}

function useIssue(props: ProtocolFormProps, path: Path) {
  const { tr } = useLocale();
  const hint = hintFor(path);
  const issue = (props.issues ?? []).find((i) => i.field === hint.field && (hint.index === undefined || i.index === undefined || i.index === hint.index));
  if (!issue) return undefined;
  const key: MessageKey =
    issue.code === 'TEXT_TOO_LONG'
      ? 'ws.team.tasks.form.issue.tooLong'
      : issue.code === 'SPONSOR_DETAILS_REQUIRED'
        ? 'op.errors.SPONSOR_DETAILS_REQUIRED'
        : 'ws.team.tasks.form.issue.invalid';
  return tr(key);
}

function FieldControl(props: ProtocolFormProps & { def: FieldDef; path: Path }) {
  const { tr } = useLocale();
  const { def, path, draft, onChange, disabled } = props;
  const names = path.filter((k): k is string => typeof k === 'string');
  const labelKey = fieldLabelKey(names);
  const label = labelKey ? tr(labelKey) : def.name;
  const value = getIn(draft, path);
  const set = (next: unknown) => onChange(setIn(draft, path, next) as Draft);
  const error = useIssue(props, path);
  const hint = props.hints?.[names.join('.')];
  const common = { label, required: def.required, optional: !def.required, error, hint };
  const testId = `field.${names.join('.')}`;

  switch (def.type) {
    case 'text':
    case 'url':
      return (
        <Field {...common}>
          <input
            data-testid={testId}
            style={inputStyle}
            type={def.type === 'url' ? 'url' : 'text'}
            dir={def.type === 'url' ? 'ltr' : dirFor(def.name)}
            value={typeof value === 'string' ? value : ''}
            maxLength={def.max}
            disabled={disabled}
            onChange={(e) => set(e.target.value)}
          />
        </Field>
      );
    case 'longText':
      return (
        <Field {...common}>
          <textarea
            data-testid={testId}
            style={textareaStyle}
            dir={dirFor(def.name)}
            value={typeof value === 'string' ? value : ''}
            maxLength={def.max}
            disabled={disabled}
            onChange={(e) => set(e.target.value)}
          />
        </Field>
      );
    case 'enum': {
      const labels = OPTION_LABELS[def.name] ?? {};
      return (
        <Field {...common}>
          <Select<string>
            value={typeof value === 'string' ? value : ''}
            onChange={set}
            disabled={disabled}
            placeholder={tr('ws.team.tasks.form.choose')}
            options={(def.options ?? []).map((o) => ({ value: o, label: labels[o] ? tr(labels[o]!) : o }))}
          />
        </Field>
      );
    }
    case 'iqd':
      return (
        <Field {...common}>
          <MoneyInput value={typeof value === 'number' ? value : null} onChange={set} allowEmpty min={def.min ?? 0} disabled={disabled} />
        </Field>
      );
    case 'int':
    case 'number':
      return (
        <Field {...common}>
          <NumberInput value={typeof value === 'number' ? value : null} onChange={set} integer={def.type === 'int'} disabled={disabled} testId={testId} />
        </Field>
      );
    case 'uuid': {
      const options = props.sources?.[names.join('.')] ?? [];
      const current = typeof value === 'string' ? value : '';
      return (
        <Field {...common}>
          <Select<string>
            value={current === '' ? '' : current}
            onChange={(v) => set(v === NONE ? '' : v)}
            disabled={disabled || options.length === 0}
            placeholder={options.length === 0 ? tr('ws.team.tasks.form.noChoices') : tr('ws.team.tasks.form.choose')}
            options={[...(def.required || current === '' ? [] : [{ value: NONE, label: tr('ws.team.tasks.form.none') }]), ...options]}
          />
        </Field>
      );
    }
    case 'uuids': {
      const options = props.sources?.[names.join('.')] ?? [];
      const picked = Array.isArray(value) ? (value as string[]) : [];
      return (
        <Field {...common} group>
          <ChoiceChips
            options={options}
            picked={picked}
            disabled={disabled}
            onToggle={(v) => set(picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v])}
            empty={tr('ws.team.tasks.form.noChoices')}
          />
        </Field>
      );
    }
    case 'ints':
      return (
        <Field {...common} group>
          <WeekdayChips value={Array.isArray(value) ? (value as number[]) : []} onChange={set} disabled={disabled} />
        </Field>
      );
    case 'date':
      return (
        <Field {...common}>
          <DateField value={typeof value === 'string' ? value : ''} onChange={set} disabled={disabled} />
        </Field>
      );
    case 'datetime':
      return (
        <Field {...common}>
          <input
            type="datetime-local"
            data-testid={testId}
            style={inputStyle}
            dir="ltr"
            value={typeof value === 'string' ? value : ''}
            disabled={disabled}
            onChange={(e) => set(e.target.value)}
          />
        </Field>
      );
    case 'time':
      return (
        <Field {...common}>
          <input
            type="time"
            data-testid={testId}
            style={inputStyle}
            dir="ltr"
            value={typeof value === 'string' ? value : ''}
            disabled={disabled}
            onChange={(e) => set(e.target.value)}
          />
        </Field>
      );
    case 'bool':
      return (
        <div style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)', cursor: disabled ? 'default' : 'pointer' }}>
            <input type="checkbox" data-testid={testId} checked={value === true} disabled={disabled} onChange={(e) => set(e.target.checked)} />
            <span>{label}</span>
          </label>
        </div>
      );
    case 'priceMap':
      return (
        <Field {...common} group>
          <PriceMapRows rows={Array.isArray(value) ? (value as PriceMapRow[]) : []} onChange={set} max={def.maxItems ?? 12} disabled={disabled} />
        </Field>
      );
    case 'list':
      return <ListControl {...props} label={label} error={error} rows={Array.isArray(value) ? (value as Draft[]) : []} />;
    case 'object':
      return <ObjectControl {...props} label={label} error={error} value={value as Draft | null} />;
  }
}

function Group({ label, required, error, children, actions }: { label: string; required: boolean; error?: string; children: ReactNode; actions?: ReactNode }) {
  const { tr } = useLocale();
  return (
    <fieldset
      style={{
        border: `1px solid ${error ? 'var(--tp-danger)' : 'var(--tp-border)'}`,
        borderRadius: 'var(--tp-radius-ctl)',
        paddingBlock: 'var(--tp-sp-2)',
        paddingInline: 'var(--tp-sp-3)',
        marginBlockEnd: 'var(--tp-sp-3)',
        minInlineSize: 0,
      }}
    >
      <legend style={{ paddingInline: 'var(--tp-sp-1)', fontWeight: 600, fontSize: 'var(--tp-fs-sm)' }}>
        {label}
        {!required && <span style={{ fontWeight: 400, color: 'var(--tp-muted-fg)', marginInlineStart: 'var(--tp-sp-1)' }}>{tr('ws.kit.common.optional')}</span>}
      </legend>
      {error && (
        <p role="alert" style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)', marginBlockEnd: 'var(--tp-sp-2)' }}>
          {error}
        </p>
      )}
      {children}
      {actions && <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>{actions}</div>}
    </fieldset>
  );
}

function ListControl(props: ProtocolFormProps & { def: FieldDef; path: Path; label: string; error?: string; rows: Draft[] }) {
  const { tr } = useLocale();
  const { def, path, rows, draft, onChange, disabled } = props;
  const max = def.maxItems ?? 30;
  const min = def.required ? Math.max(1, def.minItems ?? 1) : 0;
  const setRows = (next: Draft[]) => onChange(setIn(draft, path, next) as Draft);
  return (
    <Group
      label={props.label}
      required={def.required}
      error={props.error}
      actions={
        rows.length < max ? (
          <Button size="sm" icon="plus" kind="ghost" disabled={disabled} onClick={() => setRows([...rows, emptyDraft(def.fields ?? [])])} data-testid={`add.${def.name}`}>
            {tr('ws.team.tasks.form.addRow')}
          </Button>
        ) : undefined
      }
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        {rows.map((_, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) auto',
              gap: 'var(--tp-sp-2)',
              alignItems: 'start',
              paddingBlockEnd: 'var(--tp-sp-1)',
              borderBlockEnd: i < rows.length - 1 ? '1px dashed var(--tp-border)' : undefined,
            }}
          >
            <div style={{ display: 'grid', gap: '0 var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))' }}>
              <Fields {...props} fields={def.fields ?? []} base={[...path, i]} />
            </div>
            {rows.length > min && (
              <Button
                size="sm"
                kind="ghost"
                icon="trash"
                aria-label={tr('ws.team.tasks.form.removeRow', { n: String(i + 1) })}
                disabled={disabled}
                onClick={() => setRows(rows.filter((__, j) => j !== i))}
                style={{ marginBlockStart: 'var(--tp-sp-5)' }}
              />
            )}
          </div>
        ))}
      </div>
    </Group>
  );
}

function ObjectControl(props: ProtocolFormProps & { def: FieldDef; path: Path; label: string; error?: string; value: Draft | null }) {
  const { tr } = useLocale();
  const { def, path, value, draft, onChange, disabled } = props;
  const set = (next: Draft | null) => onChange(setIn(draft, path, next) as Draft);
  if (value === null || value === undefined) {
    // An optional group the form leaves out until someone adds it.
    return (
      <div style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
        <Button size="sm" kind="ghost" icon="plus" disabled={disabled} onClick={() => set(emptyDraft(def.fields ?? []))} data-testid={`add.${def.name}`}>
          {tr('ws.team.tasks.form.addGroup', { name: inSentence(props.label) })}
        </Button>
        {props.error && <p role="alert" style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>{props.error}</p>}
      </div>
    );
  }
  return (
    <Group
      label={props.label}
      required={def.required}
      error={props.error}
      actions={
        !def.required ? (
          <Button size="sm" kind="ghost" icon="x" disabled={disabled} onClick={() => set(emptyValue(def) as null)}>
            {tr('ws.team.tasks.form.removeGroup', { name: inSentence(props.label) })}
          </Button>
        ) : undefined
      }
    >
      <div style={{ display: 'grid', gap: '0 var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))' }}>
        <Fields {...props} fields={def.fields ?? []} base={path} />
      </div>
    </Group>
  );
}

/** A number box holding its own text, so "1." and "" are typeable; blank reads as null. */
export function NumberInput({
  value,
  onChange,
  integer,
  disabled,
  testId,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  integer?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => {
    const parsed = text.trim() === '' ? null : Number(text);
    if (parsed !== value) setText(value === null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      data-testid={testId}
      style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }}
      dir="ltr"
      inputMode={integer ? 'numeric' : 'decimal'}
      autoComplete="off"
      disabled={disabled}
      value={text}
      onChange={(e) => {
        const raw = e.target.value.replace(integer ? /[^\d]/g : /[^\d.]/g, '');
        setText(raw);
        if (raw.trim() === '') return onChange(null);
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

function ChoiceChips({
  options,
  picked,
  onToggle,
  disabled,
  empty,
}: {
  options: readonly FormOption[];
  picked: readonly string[];
  onToggle: (value: string) => void;
  disabled?: boolean;
  empty: string;
}) {
  if (options.length === 0) return <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{empty}</p>;
  return (
    <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
      {options.map((o) => (
        <label
          key={o.value}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--tp-sp-1)',
            paddingBlock: 'var(--tp-sp-1)',
            paddingInline: 'var(--tp-sp-2)',
            borderRadius: 'var(--tp-radius-pill)',
            border: `1px solid ${picked.includes(o.value) ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
            background: picked.includes(o.value) ? 'var(--tp-accent-soft)' : 'var(--tp-surface)',
            cursor: disabled ? 'default' : 'pointer',
            fontSize: 'var(--tp-fs-sm)',
          }}
        >
          <input type="checkbox" checked={picked.includes(o.value)} disabled={disabled} onChange={() => onToggle(o.value)} />
          <bdi>{o.label}</bdi>
        </label>
      ))}
    </div>
  );
}

/** Sunday .. Saturday as 0 .. 6, the server's numbering (0067, 0071). */
function WeekdayChips({ value, onChange, disabled }: { value: readonly number[]; onChange: (next: number[]) => void; disabled?: boolean }) {
  const { locale } = useLocale();
  // 2023-01-01 was a Sunday; noon UTC is the same date in the venue's zone.
  const options = Array.from({ length: 7 }, (_, d) => ({ value: String(d), label: formatWeekdayShort(new Date(Date.UTC(2023, 0, 1 + d, 12)), locale) }));
  return (
    <ChoiceChips
      options={options}
      picked={value.map(String)}
      disabled={disabled}
      empty=""
      onToggle={(v) => {
        const n = Number(v);
        onChange(value.includes(n) ? value.filter((x) => x !== n) : [...value, n].sort((a, b) => a - b));
      }}
    />
  );
}

function PriceMapRows({ rows, onChange, max, disabled }: { rows: PriceMapRow[]; onChange: (next: PriceMapRow[]) => void; max: number; disabled?: boolean }) {
  const { tr } = useLocale();
  const set = (i: number, patch: Partial<PriceMapRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}>
            <span style={{ inlineSize: '5rem' }}>
              <NumberInput value={r.duration} integer onChange={(v) => set(i, { duration: v })} disabled={disabled} />
            </span>
            <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.team.tasks.form.minutes')}</span>
          </span>
          <MoneyInput value={r.price} onChange={(v) => set(i, { price: v })} allowEmpty disabled={disabled} />
          <Button size="sm" kind="ghost" icon="trash" aria-label={tr('ws.team.tasks.form.removeRow', { n: String(i + 1) })} disabled={disabled} onClick={() => onChange(rows.filter((_, j) => j !== i))} />
        </div>
      ))}
      {rows.length < max && (
        <div>
          <Button size="sm" kind="ghost" icon="plus" disabled={disabled} onClick={() => onChange([...rows, { duration: null, price: null }])}>
            {tr('ws.team.tasks.form.addLength')}
          </Button>
        </div>
      )}
    </div>
  );
}

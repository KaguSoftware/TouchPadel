/**
 * Every step form on the operator (build-contracts-2026-09-23 §5.4 "all 18
 * built-in forms plus the generic one"), drawn from the field list the phone
 * draws from too (`@touch/core/protocols` stepForm, §7.2, plan #38): the two
 * apps cannot ask for different things.
 *
 * The walker renders a field by its type. The fields that NAME something get a
 * picker fed by the step's context: an ingredient, a cafe section, a size of
 * the item, an add-on, a promotion, a court rate, a court, a campaign. Four
 * fields are not typed at all, because another screen writes them: the hiring
 * candidates and the pick (the candidates panel), the new staff member (Staff
 * ▸ Add staff member), the event blocks (Desk ▸ Block courts) and the launch
 * photo (chosen from the run's own photos, `LaunchPhotoPicker`).
 *
 * Refusals land on the field they name (`issueAt`, the server's hint names).
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { formatIQD, formatNumber, type MessageKey } from '@touch/i18n';
import {
  randomPromoCode,
  type FieldDef,
  type FieldIssue,
  type PriceChangeKind,
  type ProtocolKind,
  type TournamentVariant,
} from '@touch/core/protocols';
import { useLocale } from '../../lib/i18n';
import { Button, Field, Select, inputStyle } from '../../components/ui';
import { SegmentedControl } from '../../components/kit';
import { DateField, MoneyInput } from '../../components/inputs';
import { Switch } from '../../components/Switch';
import { decimalKeystroke } from '../stock/decimalInput';
import { StaffPhotoThumb } from '../checklists/StaffPhoto';
import { blankObject, fromLocalInput, getAt, issueAt, setAt, toLocalInput, toTimeInput, type Obj } from './formModel';
import { fieldHintKey, fieldLabelKey, optionLabelKey } from './labels';
import { pickText } from './protocolLogic';
import { pickTarget, type Targets } from './priceTargets';
import { useAllCategories, useCafeCategories, useCampaigns, useCourts, useIngredients, useMenuItems, type NamedRow } from './api';

/** A size a list of `variant_id`s covers: a release draft's, or a priced item's. */
export interface SizeRow {
  variant_id: string;
  name_en: string;
  name_ar: string;
  /** Today's price, shown beside the new one. */
  current?: number | null;
}

export interface AddonRow {
  modifier_id: string;
  name_en: string;
  name_ar: string;
  group_en: string;
  group_ar: string;
  current: number | null;
}

/** What a form needs from the step it is on. */
export interface FormEnv {
  kind: ProtocolKind;
  stepKey: string | null;
  variant: TournamentVariant | null;
  change: PriceChangeKind | null;
  /** The sizes a `prices` or `servings` list covers. */
  sizes?: SizeRow[];
  /** The add-ons a numbers step's `addons` covers. */
  addons?: AddonRow[];
  /** A price or promo proposal's targets (app.price_promo_targets). */
  targets?: Targets;
  /** A start form: the change kinds this person may pick. */
  changeChoices?: readonly PriceChangeKind[];
  /** A resubmission keeps the run's change and target (RECORD_INVALID hint `change`). */
  lockTarget?: boolean;
  /** The submitter decides this step, so fields a decider fills are asked (release `category_id`). */
  submitterDecides?: boolean;
  /** Release launch: the run's own photos to put on the menu. */
  launchPhotos?: string[];
}

/** Fields another screen or panel writes: the walker leaves them out. */
const WRITTEN_ELSEWHERE = new Set(['candidate_ids', 'picked_id', 'staff_id', 'reservation_ids', 'photo_path', 'variant_id', 'modifier_id']);

/** Figures of the numbers step, asked only when the recommendation is to change them. */
const NUMBERS_FIGURES = new Set(['prices', 'new_sizes', 'addons', 'rule_prices', 'discount_pct', 'promotion_value']);

type Path = (string | number)[];

const REASONS = new Set(['reason', 'expected_effect']);

/** Two languages of one thing sit side by side: `name_en` beside `name_ar`, `en` beside `ar`. */
const PAIR: CSSProperties = { display: 'grid', gap: 'var(--tp-sp-2-5)', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', alignItems: 'start' };

export function pairUp(fields: readonly FieldDef[]): FieldDef[][] {
  const out: FieldDef[][] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    const next = fields[i + 1];
    const stem = f.name === 'en' ? '' : f.name.endsWith('_en') ? f.name.slice(0, -3) : null;
    if (stem !== null && next && next.name === (stem === '' ? 'ar' : `${stem}_ar`)) {
      out.push([f, next]);
      i++;
    } else out.push([f]);
  }
  return out;
}

const muted: CSSProperties = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' };
/** A price box in a table cell: its own width, at the end of the cell. */
const MONEY_CELL: CSSProperties = { inlineSize: '16rem', marginInlineStart: 'auto' };
const textareaStyle: CSSProperties = { ...inputStyle, minBlockSize: '4.5rem', resize: 'vertical', fontFamily: 'inherit' };

function dirFor(name: string): 'ltr' | 'rtl' | 'auto' {
  if (name.endsWith('_en') || name === 'en' || name === 'link' || name === 'public_code') return 'ltr';
  if (name.endsWith('_ar') || name === 'ar') return 'rtl';
  return 'auto';
}

export function RecordForm({
  fields,
  value,
  onChange,
  issues,
  env,
  disabled,
}: {
  fields: readonly FieldDef[];
  value: Obj;
  onChange: (next: Obj) => void;
  issues: readonly FieldIssue[];
  env: FormEnv;
  disabled?: boolean;
}) {
  const shown = fields.filter((f) => {
    if (WRITTEN_ELSEWHERE.has(f.name)) return false;
    if (f.deciderOnly && !env.submitterDecides) return false;
    if (env.kind === 'price_promo' && env.stepKey === 'numbers' && NUMBERS_FIGURES.has(f.name)) return value.recommendation === 'change';
    return true;
  });
  // A price or promo proposal names its target and figures first, then why.
  const ordered =
    env.kind === 'price_promo' && env.stepKey === 'propose'
      ? [...shown.filter((f) => !REASONS.has(f.name)), ...shown.filter((f) => REASONS.has(f.name))]
      : shown;
  const set = (path: Path, next: unknown) => onChange(setAt(value, path, next) as Obj);
  const launch = env.kind === 'product_release' && env.stepKey === 'launch';
  // Nothing typed here (the interviews send the candidates list): no empty block.
  if (ordered.length === 0 && !launch) return null;
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      {pairUp(ordered).map((group) =>
        group.length === 2 ? (
          <div key={group[0]!.name} style={PAIR}>
            {group.map((f) => (
              <FieldControl key={f.name} def={f} path={[f.name]} value={value} set={set} issues={issues} env={env} disabled={disabled} onRecord={onChange} />
            ))}
          </div>
        ) : (
          <FieldControl key={group[0]!.name} def={group[0]!} path={[group[0]!.name]} value={value} set={set} issues={issues} env={env} disabled={disabled} onRecord={onChange} />
        ),
      )}
      {launch && (
        <LaunchPhotoPicker
          photos={env.launchPhotos ?? []}
          value={typeof value.photo_path === 'string' ? value.photo_path : ''}
          onChange={(p) => set(['photo_path'], p)}
          invalid={issueAt(issues, ['photo_path']) !== null}
          disabled={disabled}
        />
      )}
    </div>
  );
}

interface ControlProps {
  def: FieldDef;
  path: Path;
  value: Obj;
  set: (path: Path, next: unknown) => void;
  issues: readonly FieldIssue[];
  env: FormEnv;
  disabled?: boolean;
  /** Replace the whole record: a target pick brings its figures. */
  onRecord: (next: Obj) => void;
  /**
   * A member of an optional object (a hero line, the sponsor): no marker of
   * its own. The object's legend says it is optional, and its members are
   * needed only once it is used, which the check says on send.
   */
  quiet?: boolean;
}

function useFieldWords(path: Path) {
  const { tr } = useLocale();
  const labelKey = fieldLabelKey(path);
  const hintKey = fieldHintKey(path);
  return {
    label: labelKey ? tr(labelKey) : String(path[path.length - 1]),
    hint: hintKey ? tr(hintKey) : undefined,
  };
}

function issueText(tr: (k: MessageKey, p?: Record<string, string | number>) => string, issue: FieldIssue | null): string | undefined {
  if (!issue) return undefined;
  if (issue.code === 'RECORD_INVALID') return tr('ws.protocols.form.fieldInvalid');
  if (issue.code === 'TEXT_TOO_LONG') return tr('ws.protocols.form.fieldTooLong');
  return tr(`op.errors.${issue.code}` as MessageKey);
}

function FieldControl(props: ControlProps) {
  const { def, path, value, set, issues, env, disabled, onRecord } = props;
  const { tr } = useLocale();
  const { label, hint } = useFieldWords(path);
  const v = getAt(value, path);
  const issue = issueAt(issues, path);
  const error = issueText(tr, issue);
  const top = path.length === 1 ? String(path[0]) : null;
  const joined = path.filter((p) => typeof p === 'string').join('.');
  const req = def.required && !props.quiet;
  const opt = !def.required && !props.quiet;

  // ── Pickers ──
  if (top === 'change' && env.kind === 'price_promo') {
    const choices = env.changeChoices ?? [];
    return (
      <Field label={label} required error={error}>
        <Select<PriceChangeKind>
          value={(typeof v === 'string' ? v : '') as PriceChangeKind | ''}
          disabled={disabled || env.lockTarget || choices.length <= 1}
          options={(choices.length > 0 ? choices : typeof v === 'string' ? [v as PriceChangeKind] : []).map((c) => ({ value: c, label: tr(`work.protocol.change.${c}`) }))}
          onChange={(c) => onRecord({ change: c, reason: value.reason ?? '', expected_effect: value.expected_effect ?? '' })}
        />
      </Field>
    );
  }
  if (env.kind === 'price_promo' && env.stepKey === 'propose' && (top === 'menu_item_id' || top === 'promotion_id' || top === 'rule_id')) {
    return <TargetSelect {...props} label={label} error={error} />;
  }
  if (top === 'prices' && def.type === 'list') return <SizePriceTable {...props} label={label} error={error} />;
  if (top === 'servings') return <ServingsTable {...props} label={label} error={error} />;
  if (top === 'addons') return <AddonTable {...props} label={label} error={error} />;
  if (top === 'lines' && env.kind === 'product_release') return <RecipeLines {...props} label={label} error={error} />;
  if (top === 'ranges' && env.kind === 'tournament') return <CourtRanges {...props} label={label} error={error} />;
  if (def.name === 'campaign_id') return <CampaignSelect {...props} label={label} error={error} />;
  if (top === 'category_id') return <CategorySelect {...props} label={label} error={error} hint={hint} />;
  if (joined === 'promotion.scope') return <ScopePicker {...props} label={label} />;
  if (joined === 'rule.court_id') return <CourtSelect {...props} label={label} error={error} />;
  if (def.type === 'ints' && (def.name === 'weekdays' || def.name === 'days_of_week')) {
    return (
      <Field label={label} hint={hint} error={error} required={def.required && (def.minItems ?? 0) > 0} group>
        <WeekdayPicker value={Array.isArray(v) ? (v as number[]) : []} onChange={(next) => set(path, next)} disabled={disabled} />
      </Field>
    );
  }

  // ── By type ──
  switch (def.type) {
    case 'text':
    case 'url':
      return (
        <Field label={label} hint={hint} error={error} required={req} optional={opt}>
          <span style={{ display: 'flex', gap: 'var(--tp-sp-1-5)' }}>
            <input
              style={{ ...inputStyle, flex: 1, minInlineSize: 0 }}
              dir={dirFor(def.name)}
              value={typeof v === 'string' ? v : ''}
              maxLength={def.max !== undefined ? def.max + 20 : undefined}
              disabled={disabled}
              aria-invalid={error ? true : undefined}
              onChange={(e) => set(path, e.target.value)}
            />
            {joined === 'promotion.public_code' && !disabled && (
              <Button
                size="sm"
                icon="refresh"
                onClick={() => set(path, randomPromoCode((n) => crypto.getRandomValues(new Uint8Array(n))))}
              >
                {tr('ws.protocols.form.drawCode')}
              </Button>
            )}
          </span>
        </Field>
      );
    case 'longText':
      return (
        <Field label={label} hint={hint} error={error} required={req} optional={opt}>
          <textarea
            style={textareaStyle}
            dir={dirFor(def.name)}
            rows={3}
            value={typeof v === 'string' ? v : ''}
            maxLength={def.max !== undefined ? def.max + 20 : undefined}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            onChange={(e) => set(path, e.target.value)}
          />
        </Field>
      );
    case 'enum': {
      const options = (def.options ?? []).map((o) => {
        const k = optionLabelKey(path, o);
        return { value: o, label: k ? tr(k) : o };
      });
      if (options.length <= 4 && def.name !== 'role') {
        return (
          <Field label={label} hint={hint} error={error} required={req} optional={opt} group>
            <SegmentedControl<string>
              value={typeof v === 'string' ? v : ''}
              onChange={(next) => !disabled && set(path, next)}
              options={options.map((o) => ({ ...o, disabled }))}
            />
          </Field>
        );
      }
      return (
        <Field label={label} hint={hint} error={error} required={req} optional={opt}>
          <Select<string> value={typeof v === 'string' ? v : ''} disabled={disabled} options={options} placeholder={tr('ws.protocols.form.choose')} onChange={(next) => set(path, next)} />
        </Field>
      );
    }
    case 'iqd':
      return (
        <Field label={label} hint={hint} error={error} required={req} optional={opt}>
          <MoneyInput value={typeof v === 'number' ? v : null} allowEmpty onChange={(next) => set(path, next)} disabled={disabled} />
        </Field>
      );
    case 'int':
    case 'number':
      return (
        <Field label={label} hint={hint} error={error} required={req} optional={opt}>
          <NumberBox value={typeof v === 'number' ? v : null} integer={def.type === 'int'} onChange={(next) => set(path, next)} disabled={disabled} />
        </Field>
      );
    case 'date':
      return (
        <Field label={label} hint={hint} error={error} required={req} optional={opt}>
          <DateField value={typeof v === 'string' ? v : ''} onChange={(next) => set(path, next)} disabled={disabled} />
        </Field>
      );
    case 'datetime':
      // "At" of a launch or an apply matters only on a date.
      if (def.name === 'at' && value.when !== 'date') return null;
      return (
        <Field label={label} hint={hint} error={error} required={def.required || def.name === 'at'} optional={!def.required && def.name !== 'at'}>
          <input
            type="datetime-local"
            style={inputStyle}
            dir="ltr"
            value={toLocalInput(v)}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            onChange={(e) => set(path, fromLocalInput(e.target.value))}
          />
        </Field>
      );
    case 'time':
      return (
        <Field label={label} hint={hint} error={error} required={req} optional={opt}>
          <input type="time" style={inputStyle} dir="ltr" value={toTimeInput(v)} disabled={disabled} onChange={(e) => set(path, e.target.value)} />
        </Field>
      );
    case 'bool':
      return (
        <div>
          <Switch checked={v === true} label={label} disabled={disabled} onChange={(next) => set(path, next)} />
          {hint && <p style={{ ...muted, margin: 0 }}>{hint}</p>}
        </div>
      );
    case 'priceMap':
      return (
        <Field label={label} hint={hint ?? tr('ws.protocols.form.durationsHint')} error={error} required={req} optional={opt} group>
          <PriceMapEditor value={v && typeof v === 'object' ? (v as Record<string, number>) : {}} onChange={(next) => set(path, next)} disabled={disabled} />
        </Field>
      );
    case 'object': {
      const members = (def.fields ?? []).filter((f) => !WRITTEN_ELSEWHERE.has(f.name));
      const quiet = props.quiet || !def.required;
      return (
        <fieldset style={{ border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-ctl)', padding: 'var(--tp-sp-2-5)', margin: 0, minInlineSize: 0 }}>
          <legend style={{ fontWeight: 600, paddingInline: 'var(--tp-sp-1)' }}>
            {label}
            {opt && <OptionalMark />}
          </legend>
          {hint && <p style={{ ...muted, marginBlock: '0 var(--tp-sp-2)' }}>{hint}</p>}
          {error && <p style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)', marginBlock: '0 var(--tp-sp-2)' }}>{error}</p>}
          <div style={{ display: 'grid', gap: 'var(--tp-sp-2-5)' }}>
            {pairUp(members).map((group) =>
              group.length === 2 ? (
                <div key={group[0]!.name} style={PAIR}>
                  {group.map((m) => (
                    <FieldControl key={m.name} {...props} quiet={quiet} def={m} path={[...path, m.name]} />
                  ))}
                </div>
              ) : (
                <FieldControl key={group[0]!.name} {...props} quiet={quiet} def={group[0]!} path={[...path, group[0]!.name]} />
              ),
            )}
          </div>
        </fieldset>
      );
    }
    case 'list':
      return <ListEditor {...props} label={label} error={error} hint={hint} />;
    case 'uuid':
    case 'uuids':
      // An id with no picker of its own is never typed by hand.
      return null;
  }
}

/** The "Optional" word a Field shows beside its label, for a legend. */
function OptionalMark() {
  const { tr } = useLocale();
  return (
    <span aria-hidden="true" style={{ marginInlineStart: 'var(--tp-sp-1)', fontWeight: 400, color: 'var(--tp-muted-fg)' }}>
      {tr('ws.kit.common.optional')}
    </span>
  );
}

// ── Generic list ────────────────────────────────────────────────────────────

function ListEditor({ def, path, value, set, issues, env, disabled, onRecord, label, error, hint }: ControlProps & { label: string; error?: string; hint?: string }) {
  const { tr, locale } = useLocale();
  const rows = (Array.isArray(getAt(value, path)) ? getAt(value, path) : []) as Obj[];
  const members = (def.fields ?? []).filter((f) => !WRITTEN_ELSEWHERE.has(f.name));
  const full = def.maxItems !== undefined && rows.length >= def.maxItems;
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0, minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
      <legend style={{ fontWeight: 600, paddingInline: 0, marginBlockEnd: 'var(--tp-sp-1)' }}>
        {label}
        {!def.required && <OptionalMark />}
      </legend>
      {hint && <p style={{ ...muted, margin: 0 }}>{hint}</p>}
      {error && rows.length === 0 && <p style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)', margin: 0 }}>{error}</p>}
      {rows.map((_, i) => {
        const rowIssue = issueAt(issues, [...path, i]);
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--tp-sp-2)',
              alignItems: 'flex-end',
              padding: 'var(--tp-sp-2)',
              borderRadius: 'var(--tp-radius-ctl)',
              border: `1px solid ${rowIssue ? 'var(--tp-danger)' : 'var(--tp-border)'}`,
            }}
          >
            {members.map((m) => (
              <div key={m.name} style={{ flex: '1 1 10rem', minInlineSize: 0 }}>
                <FieldControl def={m} path={[...path, i, m.name]} value={value} set={set} issues={[]} env={env} disabled={disabled} onRecord={onRecord} />
              </div>
            ))}
            {!disabled && (
              <Button
                size="sm"
                kind="ghost"
                icon="x"
                aria-label={tr('ws.protocols.form.removeRow', { n: formatNumber(i + 1, locale) })}
                title={tr('ws.protocols.form.removeRow', { n: formatNumber(i + 1, locale) })}
                onClick={() => set(path, rows.filter((__, j) => j !== i))}
              />
            )}
            {rowIssue && <p style={{ flexBasis: '100%', color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)', margin: 0 }}>{issueText(tr, rowIssue)}</p>}
          </div>
        );
      })}
      {!disabled && !full && (
        <div>
          <Button size="sm" icon="plus" onClick={() => set(path, [...rows, blankObject(def.fields ?? [], path.filter((p): p is string => typeof p === 'string'))])}>
            {tr('ws.protocols.form.addRow')}
          </Button>
        </div>
      )}
    </fieldset>
  );
}

// ── Numbers ────────────────────────────────────────────────────────────────

export function NumberBox({
  value,
  onChange,
  integer,
  disabled,
  ariaLabel,
  style,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  integer?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  style?: CSSProperties;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const shown = Number(text === '' ? NaN : text) === value || (text === '' && value === null) ? text : value === null ? '' : String(value);
  return (
    <input
      style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums', inlineSize: '8rem', ...style }}
      dir="ltr"
      inputMode={integer ? 'numeric' : 'decimal'}
      autoComplete="off"
      aria-label={ariaLabel}
      disabled={disabled}
      value={shown}
      onChange={(e) => {
        const raw = decimalKeystroke(e.target.value);
        const next = integer ? raw.replace(/\..*$/, '') : raw;
        setText(next);
        onChange(next === '' || next === '.' ? null : Number(next));
      }}
      onBlur={() => setText(value === null ? '' : String(value))}
    />
  );
}

function PriceMapEditor({ value, onChange, disabled }: { value: Record<string, number>; onChange: (next: Record<string, number>) => void; disabled?: boolean }) {
  const { tr, locale } = useLocale();
  const [duration, setDuration] = useState<number | null>(null);
  const entries = Object.entries(value).sort(([a], [b]) => Number(a) - Number(b));
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
      {entries.map(([minutes, price]) => (
        <div key={minutes} style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ minInlineSize: '6rem' }}>{tr('ws.protocols.form.minutes', { n: formatNumber(Number(minutes), locale) })}</span>
          <MoneyInput value={price} allowEmpty onChange={(next) => onChange({ ...value, [minutes]: next ?? 0 })} disabled={disabled} />
          {!disabled && (
            <Button
              size="sm"
              kind="ghost"
              icon="x"
              aria-label={tr('ws.protocols.form.removeDuration', { n: formatNumber(Number(minutes), locale) })}
              onClick={() => onChange(Object.fromEntries(entries.filter(([k]) => k !== minutes)))}
            />
          )}
        </div>
      ))}
      {!disabled && entries.length < 12 && (
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <NumberBox value={duration} integer onChange={setDuration} ariaLabel={tr('ws.protocols.form.newDuration')} style={{ inlineSize: '6rem' }} />
          <span style={muted}>{tr('ws.protocols.form.minutesUnit')}</span>
          <Button
            size="sm"
            icon="plus"
            disabled={duration === null || duration < 15 || duration > 480 || duration % 5 !== 0 || String(duration) in value}
            onClick={() => {
              if (duration === null) return;
              onChange({ ...value, [String(duration)]: 0 });
              setDuration(null);
            }}
          >
            {tr('ws.protocols.form.addDuration')}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Weekdays ───────────────────────────────────────────────────────────────

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function WeekdayPicker({ value, onChange, disabled }: { value: number[]; onChange: (next: number[]) => void; disabled?: boolean }) {
  const { tr } = useLocale();
  return (
    <span style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
      {WEEKDAY_KEYS.map((k, d) => {
        const on = value.includes(d);
        return (
          <Button
            key={k}
            size="sm"
            kind={on ? 'primary' : 'default'}
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort((a, b) => a - b))}
          >
            {tr(`op.days.${k}`)}
          </Button>
        );
      })}
    </span>
  );
}

// ── Chips ──────────────────────────────────────────────────────────────────

function ChipPicker({ options, selected, onToggle, disabled, label }: { options: { id: string; label: string }[]; selected: string[]; onToggle: (id: string) => void; disabled?: boolean; label: string }) {
  const { tr } = useLocale();
  if (options.length === 0) return <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.form.noneToPick')}</p>;
  return (
    <span role="group" aria-label={label} style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <Button key={o.id} size="sm" kind={on ? 'primary' : 'default'} aria-pressed={on} disabled={disabled} onClick={() => onToggle(o.id)}>
            {o.label}
          </Button>
        );
      })}
    </span>
  );
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

function ScopePicker({ path, value, set, disabled, label }: ControlProps & { label: string }) {
  const { tr, locale } = useLocale();
  const courts = useCourts();
  const categories = useAllCategories();
  const items = useMenuItems();
  const scope = (getAt(value, path) ?? {}) as { courtIds?: string[]; categoryIds?: string[]; itemIds?: string[] };
  const part = (k: 'courtIds' | 'categoryIds' | 'itemIds') => (Array.isArray(scope[k]) ? scope[k]! : []);
  const named = (rows: readonly NamedRow[] | undefined) => (rows ?? []).map((r) => ({ id: r.id, label: pickText(locale, r.name_en, r.name_ar) }));
  return (
    <fieldset style={{ border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-ctl)', padding: 'var(--tp-sp-2-5)', margin: 0, display: 'grid', gap: 'var(--tp-sp-2-5)', minInlineSize: 0 }}>
      <legend style={{ fontWeight: 600, paddingInline: 'var(--tp-sp-1)' }}>{label}</legend>
      <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.hints.promotion_scope')}</p>
      {(['courtIds', 'categoryIds', 'itemIds'] as const).map((k) => {
        const words = fieldLabelKey([...path, k]);
        const rows = k === 'courtIds' ? named(courts.data) : k === 'categoryIds' ? named(categories.data) : named(items.data);
        const text = words ? tr(words) : k;
        return (
          <div key={k} style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
            <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>{text}</span>
            <ChipPicker label={text} options={rows} selected={part(k)} disabled={disabled} onToggle={(id) => set([...path, k], toggle(part(k), id))} />
          </div>
        );
      })}
    </fieldset>
  );
}

// ── Pickers fed by the step's context ─────────────────────────────────────

function TargetSelect({ path, value, env, disabled, onRecord, label, error }: ControlProps & { label: string; error?: string }) {
  const { tr, locale } = useLocale();
  const top = String(path[0]);
  const targets = env.targets;
  const change = env.change;
  const v = typeof value[top] === 'string' ? (value[top] as string) : '';
  let options: { value: string; label: string }[] = [];
  if (top === 'menu_item_id') {
    options = (targets?.items ?? []).map((i) => ({
      value: i.menu_item_id,
      label: `${pickText(locale, i.name_en, i.name_ar)}${i.category_kind === 'shop' ? ` · ${tr('ws.protocols.form.shop')}` : ''}`,
    }));
  } else if (top === 'promotion_id') {
    options = (targets?.promotions ?? []).map((p) => ({
      value: p.promotion_id,
      label: `${pickText(locale, p.name_en, p.name_ar)}${p.enabled ? '' : ` · ${tr('ws.protocols.form.off')}`}`,
    }));
  } else {
    options = [
      { value: '', label: tr('ws.protocols.form.newRule') },
      ...(targets?.rules ?? []).map((r) => ({
        value: r.rule_id,
        label: `${r.name}${r.court_name_en ? ` · ${pickText(locale, r.court_name_en, r.court_name_ar)}` : ''}${r.is_active ? '' : ` · ${tr('ws.protocols.form.off')}`}`,
      })),
    ];
  }
  const required = top !== 'rule_id';
  return (
    <Field label={label} error={error} required={required} optional={!required}>
      {options.length === 0 && top !== 'rule_id' ? (
        <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.form.noTargets')}</p>
      ) : (
        <Select<string>
          value={v}
          disabled={disabled || env.lockTarget}
          placeholder={tr('ws.protocols.form.choose')}
          options={options}
          onChange={(id) => change && targets && onRecord(pickTarget(change, targets, value, id))}
        />
      )}
    </Field>
  );
}

/** The sizes a prices list covers: the step's own, else the picked target item's. */
function sizesFor(env: FormEnv, value: Obj): SizeRow[] {
  if (env.sizes && env.sizes.length > 0) return env.sizes;
  const item = env.targets?.items.find((i) => i.menu_item_id === value.menu_item_id);
  return (item?.sizes ?? []).map((s) => ({ variant_id: s.variant_id, name_en: s.name_en, name_ar: s.name_ar, current: s.price_iqd }));
}

function SizePriceTable({ path, value, set, env, disabled, label, error }: ControlProps & { label: string; error?: string }) {
  const { tr, locale } = useLocale();
  const sizes = sizesFor(env, value);
  const rows = (Array.isArray(value.prices) ? value.prices : []) as { variant_id: string; price_iqd: number | null }[];
  const priceOf = (id: string) => rows.find((r) => r.variant_id === id)?.price_iqd ?? null;
  const put = (id: string, price: number | null) => {
    const others = rows.filter((r) => r.variant_id !== id);
    const next = sizes.map((s) => (s.variant_id === id ? { variant_id: id, price_iqd: price } : others.find((r) => r.variant_id === s.variant_id))).filter((r): r is { variant_id: string; price_iqd: number | null } => r !== undefined);
    set(path, next);
  };
  if (sizes.length === 0) {
    return (
      <Field label={label} error={error}>
        <p style={{ ...muted, margin: 0 }}>{tr(env.kind === 'price_promo' ? 'ws.protocols.form.pickItemFirst' : 'ws.protocols.form.noSizes')}</p>
      </Field>
    );
  }
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0, minInlineSize: 0 }}>
      <legend style={{ fontWeight: 600, marginBlockEnd: 'var(--tp-sp-1)' }}>{label}</legend>
      {env.change === 'price' && env.stepKey === 'propose' && <p style={{ ...muted, marginBlock: '0 var(--tp-sp-1-5)' }}>{tr('ws.protocols.hints.prices_change')}</p>}
      <table style={{ inlineSize: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={muted}>
            <th style={{ textAlign: 'start', fontWeight: 600, paddingBlock: 'var(--tp-sp-1)' }}>{tr('ws.protocols.form.size')}</th>
            <th style={{ textAlign: 'end', fontWeight: 600 }}>{tr('ws.protocols.form.now')}</th>
            <th style={{ textAlign: 'end', fontWeight: 600 }}>{tr('ws.protocols.form.newPrice')}</th>
          </tr>
        </thead>
        <tbody>
          {sizes.map((s) => (
            <tr key={s.variant_id} style={{ borderBlockStart: '1px solid var(--tp-border)' }}>
              <td style={{ paddingBlock: 'var(--tp-sp-1-5)' }}>{pickText(locale, s.name_en, s.name_ar)}</td>
              <td style={{ textAlign: 'end', ...muted }} dir="ltr">
                {s.current != null ? formatIQD(s.current, locale) : '—'}
              </td>
              <td style={{ textAlign: 'end' }}>
                <MoneyInput value={priceOf(s.variant_id)} allowEmpty onChange={(p) => put(s.variant_id, p)} disabled={disabled} style={MONEY_CELL} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)', margin: 0 }}>{error}</p>}
    </fieldset>
  );
}

function ServingsTable({ path, value, set, env, disabled, label, error }: ControlProps & { label: string; error?: string }) {
  const { tr, locale } = useLocale();
  const sizes = env.sizes ?? [];
  const rows = (Array.isArray(value.servings) ? value.servings : []) as { variant_id: string; count: number | null }[];
  const countOf = (id: string) => rows.find((r) => r.variant_id === id)?.count ?? null;
  const put = (id: string, count: number | null) =>
    set(
      path,
      sizes
        .map((s) => (s.variant_id === id ? { variant_id: id, count } : rows.find((r) => r.variant_id === s.variant_id)))
        .filter((r): r is { variant_id: string; count: number | null } => r !== undefined && r.count !== null && r.count !== 0),
    );
  return (
    <Field label={label} hint={tr('ws.protocols.hints.servings')} error={error} required group>
      {sizes.length === 0 ? (
        <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.form.noSizes')}</p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          {sizes.map((s) => (
            <label key={s.variant_id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)' }}>
              <span style={{ minInlineSize: '10rem' }}>{pickText(locale, s.name_en, s.name_ar)}</span>
              <NumberBox value={countOf(s.variant_id)} integer onChange={(n) => put(s.variant_id, n)} disabled={disabled} style={{ inlineSize: '6rem' }} />
            </label>
          ))}
        </div>
      )}
    </Field>
  );
}

function AddonTable({ path, value, set, env, disabled, label, error }: ControlProps & { label: string; error?: string }) {
  const { tr, locale } = useLocale();
  const rows = (Array.isArray(value.addons) ? value.addons : []) as { modifier_id: string; price_delta_iqd: number | null }[];
  // The proposal picks from every add-on; the numbers step prices the ones proposed.
  const choices: AddonRow[] =
    env.addons ??
    (env.targets?.addons ?? []).map((a) => ({
      modifier_id: a.modifier_id,
      name_en: a.name_en,
      name_ar: a.name_ar,
      group_en: a.group_name_en,
      group_ar: a.group_name_ar,
      current: a.price_delta_iqd,
    }));
  const fixed = env.addons !== undefined;
  const has = (id: string) => rows.some((r) => r.modifier_id === id);
  const put = (id: string, price: number | null) => set(path, rows.map((r) => (r.modifier_id === id ? { ...r, price_delta_iqd: price } : r)));
  const flip = (a: AddonRow) => set(path, has(a.modifier_id) ? rows.filter((r) => r.modifier_id !== a.modifier_id) : [...rows, { modifier_id: a.modifier_id, price_delta_iqd: a.current }]);
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0, minInlineSize: 0 }}>
      <legend style={{ fontWeight: 600, marginBlockEnd: 'var(--tp-sp-1)' }}>{label}</legend>
      {choices.length === 0 ? (
        <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.form.noTargets')}</p>
      ) : (
        <table style={{ inlineSize: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={muted}>
              <th style={{ textAlign: 'start', fontWeight: 600, paddingBlock: 'var(--tp-sp-1)' }}>{tr('ws.protocols.form.addon')}</th>
              <th style={{ textAlign: 'end', fontWeight: 600 }}>{tr('ws.protocols.form.now')}</th>
              <th style={{ textAlign: 'end', fontWeight: 600 }}>{tr('ws.protocols.form.newPrice')}</th>
            </tr>
          </thead>
          <tbody>
            {choices.map((a) => {
              const on = fixed || has(a.modifier_id);
              const name = `${pickText(locale, a.group_en, a.group_ar)} · ${pickText(locale, a.name_en, a.name_ar)}`;
              return (
                <tr key={a.modifier_id} style={{ borderBlockStart: '1px solid var(--tp-border)' }}>
                  <td style={{ paddingBlock: 'var(--tp-sp-1-5)' }}>
                    {fixed ? (
                      name
                    ) : (
                      <label style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center' }}>
                        <input type="checkbox" checked={on} disabled={disabled} onChange={() => flip(a)} />
                        {name}
                      </label>
                    )}
                  </td>
                  <td style={{ textAlign: 'end', ...muted }} dir="ltr">
                    {a.current != null ? formatIQD(a.current, locale) : '—'}
                  </td>
                  <td style={{ textAlign: 'end' }}>
                    {on && (
                      <MoneyInput
                        style={MONEY_CELL}
                        value={rows.find((r) => r.modifier_id === a.modifier_id)?.price_delta_iqd ?? null}
                        allowEmpty
                        onChange={(p) => (fixed && !has(a.modifier_id) ? set(path, [...rows, { modifier_id: a.modifier_id, price_delta_iqd: p }]) : put(a.modifier_id, p))}
                        disabled={disabled}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {error && <p style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)', margin: 0 }}>{error}</p>}
    </fieldset>
  );
}

function RecipeLines({ path, value, set, issues, disabled, label, error }: ControlProps & { label: string; error?: string }) {
  const { tr, locale } = useLocale();
  const ingredients = useIngredients();
  const rows = (Array.isArray(value.lines) ? value.lines : []) as Obj[];
  const unitOf = (id: string) => ingredients.data?.find((i) => i.id === id)?.unit;
  const NEW = '__new__';
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0, minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
      <legend style={{ fontWeight: 600, marginBlockEnd: 'var(--tp-sp-1)' }}>{label}</legend>
      <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.hints.lines')}</p>
      {error && rows.length === 0 && <p style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)', margin: 0 }}>{error}</p>}
      {rows.map((row, i) => {
        const ingredientId = typeof row.ingredient_id === 'string' ? row.ingredient_id : '';
        // Typed mode: chosen as "not stocked yet", or a label came back with the record.
        const typed = ingredientId === '' && (row._typed === true || (typeof row.label === 'string' && row.label !== ''));
        const rowIssue = issueAt(issues, [...path, i]);
        return (
          <div key={i} style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap', paddingBlock: 'var(--tp-sp-1)', borderBlockEnd: '1px solid var(--tp-border)' }}>
            <span style={{ flex: '2 1 12rem', minInlineSize: 0 }}>
              <Select<string>
                aria-label={tr('ws.protocols.fields.lines_ingredient_id')}
                value={ingredientId !== '' ? ingredientId : typed ? NEW : ''}
                disabled={disabled}
                placeholder={tr('ws.protocols.form.pickIngredient')}
                options={[
                  ...(ingredients.data ?? []).map((ing) => ({ value: ing.id, label: pickText(locale, ing.name_en, ing.name_ar) })),
                  { value: NEW, label: tr('ws.protocols.form.notStocked') },
                ]}
                onChange={(id) =>
                  set([...path, i], id === NEW ? { ...row, ingredient_id: '', label: typeof row.label === 'string' ? row.label : '', _typed: true } : { ...row, ingredient_id: id, label: '', _typed: false, unit: unitOf(id) ?? row.unit })
                }
              />
            </span>
            {typed && (
              <input
                style={{ ...inputStyle, flex: '2 1 10rem', minInlineSize: 0 }}
                dir="auto"
                aria-label={tr('ws.protocols.fields.lines_label')}
                placeholder={tr('ws.protocols.fields.lines_label')}
                value={String(row.label ?? '')}
                disabled={disabled}
                onChange={(e) => set([...path, i, 'label'], e.target.value)}
              />
            )}
            <NumberBox value={typeof row.qty === 'number' ? row.qty : null} onChange={(q) => set([...path, i, 'qty'], q)} disabled={disabled} ariaLabel={tr('ws.protocols.fields.lines_qty')} style={{ inlineSize: '6rem' }} />
            <SegmentedControl<string>
              size="sm"
              aria-label={tr('ws.protocols.fields.lines_unit')}
              value={String(row.unit ?? 'g')}
              onChange={(u) => !disabled && set([...path, i, 'unit'], u)}
              options={['g', 'ml', 'pc'].map((u) => ({ value: u, label: tr(`ws.protocols.options.unit.${u}` as MessageKey), disabled }))}
            />
            {!disabled && (
              <Button
                size="sm"
                kind="ghost"
                icon="x"
                aria-label={tr('ws.protocols.form.removeRow', { n: formatNumber(i + 1, locale) })}
                onClick={() => set(path, rows.filter((_, j) => j !== i))}
              />
            )}
            {rowIssue && <span style={{ flexBasis: '100%', color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>{issueText(tr, rowIssue)}</span>}
          </div>
        );
      })}
      {!disabled && rows.length < 30 && (
        <div>
          <Button size="sm" icon="plus" onClick={() => set(path, [...rows, { ingredient_id: '', label: '', qty: null, unit: 'g' }])}>
            {tr('ws.protocols.form.addLine')}
          </Button>
        </div>
      )}
    </fieldset>
  );
}

function CourtRanges({ path, value, set, issues, disabled, label, error }: ControlProps & { label: string; error?: string }) {
  const { tr, locale } = useLocale();
  const courts = useCourts();
  const rows = (Array.isArray(value.ranges) ? value.ranges : []) as Obj[];
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0, minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
      <legend style={{ fontWeight: 600, marginBlockEnd: 'var(--tp-sp-1)' }}>{label}</legend>
      <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.hints.ranges')}</p>
      {error && rows.length === 0 && <p style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)', margin: 0 }}>{error}</p>}
      {rows.map((row, i) => {
        const ids = Array.isArray(row.court_ids) ? (row.court_ids as string[]) : [];
        const rowIssue = issueAt(issues, [...path, i]);
        return (
          <div key={i} style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', padding: 'var(--tp-sp-2)', border: `1px solid ${rowIssue ? 'var(--tp-danger)' : 'var(--tp-border)'}`, borderRadius: 'var(--tp-radius-ctl)' }}>
            <ChipPicker
              label={tr('ws.protocols.fields.ranges_court_ids')}
              options={(courts.data ?? []).map((c) => ({ id: c.id, label: pickText(locale, c.name_en, c.name_ar) }))}
              selected={ids}
              disabled={disabled}
              onToggle={(id) => set([...path, i, 'court_ids'], toggle(ids, id))}
            />
            <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'end', flexWrap: 'wrap' }}>
              {(['from', 'to'] as const).map((k) => (
                <Field key={k} label={tr(`ws.protocols.fields.ranges_${k}`)}>
                  <input type="datetime-local" style={inputStyle} dir="ltr" value={toLocalInput(row[k])} disabled={disabled} onChange={(e) => set([...path, i, k], fromLocalInput(e.target.value))} />
                </Field>
              ))}
              {!disabled && (
                <Button size="sm" kind="ghost" icon="x" aria-label={tr('ws.protocols.form.removeRow', { n: formatNumber(i + 1, locale) })} onClick={() => set(path, rows.filter((_, j) => j !== i))} />
              )}
            </div>
            {rowIssue && <span style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>{issueText(tr, rowIssue)}</span>}
          </div>
        );
      })}
      {!disabled && rows.length < 14 && (
        <div>
          <Button size="sm" icon="plus" onClick={() => set(path, [...rows, { court_ids: [], from: '', to: '' }])}>
            {tr('ws.protocols.form.addRange')}
          </Button>
        </div>
      )}
    </fieldset>
  );
}

function CampaignSelect({ path, value, set, disabled, label, error }: ControlProps & { label: string; error?: string }) {
  const { tr, locale } = useLocale();
  const campaigns = useCampaigns();
  // Only management reads campaigns; with none to name, the field is left out.
  if (!campaigns.data || campaigns.data.length === 0) return null;
  const v = getAt(value, path);
  return (
    <Field label={label} error={error} optional>
      <Select<string>
        value={typeof v === 'string' ? v : ''}
        disabled={disabled}
        options={[{ value: '', label: tr('ws.protocols.form.noCampaign') }, ...campaigns.data.map((c) => ({ value: c.id, label: pickText(locale, c.name_en, c.name_ar) }))]}
        onChange={(id) => set(path, id)}
      />
    </Field>
  );
}

function CategorySelect({ path, value, set, disabled, label, error, hint, def }: ControlProps & { label: string; error?: string; hint?: string }) {
  const { tr, locale } = useLocale();
  const categories = useCafeCategories();
  const v = getAt(value, path);
  return (
    <Field label={label} hint={hint} error={error} required={def.deciderOnly} optional={!def.deciderOnly}>
      <Select<string>
        value={typeof v === 'string' ? v : ''}
        disabled={disabled}
        placeholder={tr('ws.protocols.form.choose')}
        options={(categories.data ?? []).map((c) => ({ value: c.id, label: pickText(locale, c.name_en, c.name_ar) }))}
        onChange={(id) => set(path, id)}
      />
    </Field>
  );
}

function CourtSelect({ path, value, set, disabled, label, error }: ControlProps & { label: string; error?: string }) {
  const { tr, locale } = useLocale();
  const courts = useCourts();
  const v = getAt(value, path);
  return (
    <Field label={label} error={error} optional>
      <Select<string>
        value={typeof v === 'string' ? v : ''}
        disabled={disabled}
        options={[{ value: '', label: tr('ws.protocols.form.everyCourt') }, ...(courts.data ?? []).map((c) => ({ value: c.id, label: pickText(locale, c.name_en, c.name_ar) }))]}
        onChange={(id) => set(path, id)}
      />
    </Field>
  );
}

/** The launch photo: one of the run's own test or marketing photos (§2.8 `launch`). */
function LaunchPhotoPicker({ photos, value, onChange, invalid, disabled }: { photos: string[]; value: string; onChange: (p: string) => void; invalid?: boolean; disabled?: boolean }) {
  const { tr, locale } = useLocale();
  return (
    <Field label={tr('ws.protocols.fields.photo_path')} hint={tr('ws.protocols.hints.photo_path')} error={invalid ? tr('ws.protocols.form.fieldInvalid') : undefined} required group>
      {photos.length === 0 ? (
        <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.form.noLaunchPhotos')}</p>
      ) : (
        <span style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
          {photos.map((p, i) => (
            <span
              key={p}
              style={{
                display: 'grid',
                gap: 'var(--tp-sp-0)',
                justifyItems: 'center',
                padding: 'var(--tp-sp-0)',
                borderRadius: 'var(--tp-radius-ctl)',
                outline: p === value ? '2px solid var(--tp-accent)' : undefined,
              }}
            >
              <StaffPhotoThumb path={p} expanded={p === value} label={tr('ws.protocols.form.useLaunchPhoto', { n: formatNumber(i + 1, locale) })} onClick={() => !disabled && onChange(p)} />
            </span>
          ))}
        </span>
      )}
    </Field>
  );
}

/** A labelled block of read-only context above a form. */
export function ContextBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', padding: 'var(--tp-sp-2-5)', borderRadius: 'var(--tp-radius-ctl)', background: 'var(--tp-surface-2)' }}>
      <h4 style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>{title}</h4>
      {children}
    </section>
  );
}

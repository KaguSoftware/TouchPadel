/**
 * One protocol form, rendered from `@touch/core`'s field list for its step
 * (build-contracts-2026-09-23 §7.2): the phone and the operator ask for the
 * same fields for a `step_key`, in the same order, with the same caps.
 *
 * CONTROLLED. The screen owns the draft (assemble.ts) and the issues (core's
 * validators, plus a refusal's hint); this only draws and edits. What the
 * screen already chose (a proposal's target, the run's photos) is `hidden`,
 * lists whose rows the context sets (one per size, one per add-on) are
 * `fixed`, and id fields get their `pickers` from the screen's reads. An id
 * field with no picker is never shown: nobody types a uuid.
 *
 * TEST IDs: `${testID}.field.<path>` on every input (`lines.0.qty` inside a
 * list), `${testID}.field.<path>.<option>` on an option chip, and the list
 * buttons of §6.3: `${testID}.line.add`, `${testID}.line.<n>.remove`,
 * `${testID}.size.add` (other lists `${testID}.field.<path>.add`).
 */
import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { parseTypedDate, type FieldDef, type FieldIssue } from '@touch/core';
import { formatDate, formatDateTime, formatIQD, isolate, type MessageKey } from '@touch/i18n';
import { Text } from '../../../i18n/text';
import { useLocale } from '../../../i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../../../theme';
import { Button, ErrorText, Field, Hint, MicroLabel } from '../../../components/ui';
import {
  concretePath,
  parseTypedNumber,
  parseVenueDateTime,
  exampleVenueDay,
  setAt,
  templatePath,
  type Draft,
  type DraftPath,
  type DraftValue,
} from './assemble';
import { fieldLabelKey, optionLabelKey, WEEKDAY_KEYS } from './labels';
import { bilingual, type FixedRow } from './logic';
import { OptionPicker, type PickerOption } from './OptionPicker';
import { MULTILINE_BOX, MULTILINE_TEXT } from './multiline';
import { issueMessageKey } from './parts';

export interface FieldPicker {
  options: readonly PickerOption[];
}

export interface FormFieldsProps {
  testID: string;
  fields: readonly FieldDef[];
  draft: Draft;
  onChange: (next: Draft) => void;
  issues: readonly FieldIssue[];
  /** Template paths not drawn (`change`, `prices.variant_id`). */
  hidden?: ReadonlySet<string>;
  /** Id fields' options, by template path (`lines.ingredient_id`). */
  pickers?: Readonly<Record<string, FieldPicker>>;
  /** Lists whose rows the context sets, by template path. */
  fixed?: Readonly<Record<string, { key: string; rows: readonly FixedRow[] }>>;
  /** A line under a field, by template path. */
  hints?: Readonly<Record<string, string>>;
  /** Option labels that read better for this step (`when` on a launch), by template path. */
  optionLabels?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Filled when the submitter decides the step (release `propose.category_id`). */
  deciderFields?: boolean;
  disabled?: boolean;
}

/** §6.3's names for the start form's two list buttons; other lists use their field path. */
const LIST_TEST_NAMES: Record<string, string> = { lines: 'line', sizes: 'size' };

const ADD_LABELS: Record<string, MessageKey> = {
  lines: 'staff.protocols.form.addLine',
  sizes: 'staff.protocols.form.addSize',
  ranges: 'staff.protocols.form.addRange',
  new_sizes: 'staff.protocols.form.addNewSize',
};

function isBlank(v: DraftValue | undefined): boolean {
  if (v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (typeof v === 'boolean') return false;
  if (Array.isArray(v)) return v.length === 0;
  return Object.values(v).every(isBlank);
}

/** The props every node reads, plus the example day the date hints show (read once per form). */
interface NodeProps extends FormFieldsProps {
  exampleDay: string;
}

export function FormFields(props: FormFieldsProps) {
  const { fields, draft } = props;
  const [exampleDay] = useState(() => exampleVenueDay(Date.now()));
  const nodeProps: NodeProps = { ...props, exampleDay };
  return (
    // Each field brings its own top margin (the shared Field's 12), so the
    // gap between them is the small step: 20 from one field to the next, as
    // on the other staff forms.
    <View style={{ gap: space.s }}>
      {fields.map((def) => (
        <FieldNode key={def.name} def={def} path={[def.name]} value={draft[def.name]} props={nodeProps} />
      ))}
    </View>
  );
}

function FieldNode({
  def,
  path,
  value,
  props,
  inRow,
}: {
  def: FieldDef;
  path: DraftPath;
  value: DraftValue | undefined;
  props: NodeProps;
  /** Inside a list row: the row carries the error, not each member. */
  inRow?: boolean;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const tpl = templatePath(path);
  if (props.hidden?.has(tpl)) return null;
  if (def.deciderOnly && !props.deciderFields) return null;

  const id = `${props.testID}.field.${concretePath(path)}`;
  const labelKey = fieldLabelKey(tpl);
  const baseLabel = labelKey ? t(labelKey) : def.name;
  const required = def.required || (def.deciderOnly === true && props.deciderFields === true);
  // "Notes · Optional": the one way every form on the phone marks a field that may stay empty.
  const label = required ? baseLabel : t('staff.protocols.form.optionalLabel', { label: baseLabel });
  const set = (next: DraftValue) => props.onChange(setAt(props.draft, path, next));
  const issue = inRow ? undefined : props.issues.find((i) => i.field === tpl && i.index === undefined);
  const error = issue ? t(issueMessageKey(issue, isBlank(value))) : null;
  const hint = props.hints?.[tpl];
  const disabled = props.disabled;

  // A field's label reads as the shared Field's does (MicroLabel), so a
  // chip group or a picker sits in a form exactly like the text fields around
  // it; a list or a group of fields is a heading one step up.
  const fieldLabel = <MicroLabel>{label}</MicroLabel>;
  const groupLabel = (
    <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, lineHeight: 19, color: colors.ink }}>{label}</Text>
  );

  switch (def.type) {
    case 'uuid':
    case 'uuids': {
      const picker = props.pickers?.[tpl];
      if (!picker) return null;
      return (
        <View style={{ gap: 4, marginTop: space.sm }}>
          <OptionPicker
            testID={id}
            label={label}
            options={picker.options}
            value={def.type === 'uuids' ? ((value as string[] | undefined) ?? []) : ((value as string | undefined) ?? '')}
            onChange={(next) => set(next)}
            multi={def.type === 'uuids'}
            error={error}
            disabled={disabled}
          />
          {hint ? <Hint>{hint}</Hint> : null}
        </View>
      );
    }
    case 'enum': {
      const current = (value as string | undefined) ?? '';
      return (
        <View style={{ gap: 6, marginTop: space.sm }}>
          {fieldLabel}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {(def.options ?? []).map((option) => {
              const custom = props.optionLabels?.[tpl]?.[option];
              const key = optionLabelKey(tpl, option);
              return (
                <Chip
                  key={option}
                  testID={`${id}.${option}`}
                  label={custom ?? (key ? t(key) : option)}
                  selected={current === option}
                  disabled={disabled}
                  onPress={() => set(current === option && !def.required ? '' : option)}
                />
              );
            })}
          </View>
          {hint ? <Hint>{hint}</Hint> : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
        </View>
      );
    }
    case 'ints': {
      const chosen = (value as string[] | undefined) ?? [];
      return (
        <View style={{ gap: 6, marginTop: space.sm }}>
          {fieldLabel}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {WEEKDAY_KEYS.map((key, n) => {
              const on = chosen.includes(String(n));
              return (
                <Chip
                  key={key}
                  testID={`${id}.${n}`}
                  label={t(key)}
                  selected={on}
                  disabled={disabled}
                  onPress={() =>
                    set(
                      on
                        ? chosen.filter((c) => c !== String(n))
                        : [...chosen, String(n)].sort((a, b) => Number(a) - Number(b)),
                    )
                  }
                />
              );
            })}
          </View>
          {hint ? <Hint>{hint}</Hint> : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
        </View>
      );
    }
    case 'bool':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s }}>
          <Text style={{ flexShrink: 1, fontFamily: fonts.body600, fontSize: 13.5, lineHeight: 19, color: colors.ink }}>
            {label}
          </Text>
          <Switch
            testID={id}
            accessibilityLabel={baseLabel}
            value={value === true}
            onValueChange={(v) => set(v)}
            disabled={disabled}
            trackColor={{ true: brand.blue, false: colors.seg }}
          />
        </View>
      );
    case 'list':
      return <ListNode def={def} path={path} value={(value as Draft[] | undefined) ?? []} props={props} label={label} error={error} />;
    case 'priceMap':
      return <PriceMapNode path={path} value={(value as Draft[] | undefined) ?? []} props={props} label={label} error={error} />;
    case 'object': {
      const obj = (value as Draft | undefined) ?? {};
      const collapsed = !def.required && !expanded && isBlank(obj);
      if (collapsed) {
        return (
          <Button
            testID={`${id}.open`}
            label={`+ ${baseLabel}`}
            variant="ghost"
            onPress={() => setExpanded(true)}
            disabled={disabled}
            style={{ alignSelf: 'flex-start' }}
          />
        );
      }
      // A group of fields opens under a hairline and its own heading; no
      // coloured edge down its side (impeccable: no side-stripe borders).
      return (
        <View style={{ gap: space.xs, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.sub }}>
          {groupLabel}
          {(def.fields ?? []).map((child) => (
            <FieldNode key={child.name} def={child} path={[...path, child.name]} value={obj[child.name]} props={props} inRow={inRow} />
          ))}
          {hint ? <Hint>{hint}</Hint> : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
        </View>
      );
    }
    default: {
      const text = typeof value === 'string' ? value : '';
      const numeric = def.type === 'int' || def.type === 'iqd' || def.type === 'number';
      const typedTime = def.type === 'date' || def.type === 'time' || def.type === 'datetime';
      const example = props.exampleDay;
      // The example is Latin digits inside an Arabic sentence: isolated, or the
      // bidi algorithm puts the time before the date.
      const formatHint =
        def.type === 'date'
          ? t('staff.protocols.form.dateHint', { example: isolate(example) })
          : def.type === 'datetime'
            ? t('staff.protocols.form.datetimeHint', { example: isolate(`${example} 18:00`) })
            : def.type === 'time'
              ? t('staff.protocols.form.timeHint')
              : def.type === 'url'
                ? t('staff.protocols.form.urlHint')
                : null;
      let preview: string | null = null;
      if (def.type === 'date') {
        const day = parseTypedDate(text);
        preview = day ? formatDate(new Date(`${day}T12:00:00Z`), locale) : null;
      } else if (def.type === 'datetime') {
        const at = parseVenueDateTime(text);
        preview = at ? formatDateTime(new Date(at), locale) : null;
      } else if (def.type === 'iqd' && text.trim()) {
        const n = parseTypedNumber(text, true);
        preview = Number.isFinite(n) ? formatIQD(n, locale) : null;
      }
      return (
        <View style={{ gap: 4 }}>
          <Field
            testID={id}
            label={label}
            value={text}
            onChangeText={(v) => set(v)}
            multiline={def.type === 'longText'}
            boxStyle={def.type === 'longText' ? MULTILINE_BOX : undefined}
            style={def.type === 'longText' ? MULTILINE_TEXT : undefined}
            keyboardType={
              def.type === 'number'
                ? 'decimal-pad'
                : numeric
                  ? 'number-pad'
                  : typedTime
                    ? 'numbers-and-punctuation'
                    : def.type === 'url'
                      ? 'url'
                      : 'default'
            }
            autoCapitalize={def.type === 'url' || typedTime ? 'none' : 'sentences'}
            latin={numeric || typedTime || def.type === 'url'}
            maxLength={def.type === 'text' || def.type === 'longText' || def.type === 'url' ? (def.max ?? undefined) : undefined}
            editable={!disabled}
            error={error}
          />
          {preview ? <Hint>{preview}</Hint> : null}
          {hint ? <Hint>{hint}</Hint> : formatHint ? <Hint>{formatHint}</Hint> : null}
        </View>
      );
    }
  }
}

function ListNode({
  def,
  path,
  value,
  props,
  label,
  error,
}: {
  def: FieldDef;
  path: DraftPath;
  value: Draft[];
  props: NodeProps;
  label: string;
  error: string | null;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const tpl = templatePath(path);
  const fixed = props.fixed?.[tpl];
  const testName = LIST_TEST_NAMES[tpl] ?? `field.${concretePath(path)}`;
  const set = (next: Draft[]) => props.onChange(setAt(props.draft, path, next));
  const addKey = ADD_LABELS[tpl];
  const hint = props.hints?.[tpl];
  const rowLabel = (row: FixedRow): { title: string; sub: string | null } => {
    const name = bilingual(locale, row.name_en, row.name_ar) ?? '';
    const group = bilingual(locale, row.group_en, row.group_ar);
    const price = row.current !== null ? formatIQD(row.current, locale) : null;
    if (group) return { title: name, sub: price !== null ? t('staff.protocols.start.addonNow', { group, price }) : group };
    return { title: name, sub: price !== null ? t('staff.protocols.start.sizeNow', { price }) : null };
  };

  return (
    <View style={{ gap: space.s, marginTop: space.sm }}>
      <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, lineHeight: 19, color: colors.ink }}>{label}</Text>
      {hint ? <Hint style={{ marginTop: 0 }}>{hint}</Hint> : null}
      {value.map((row, i) => {
        const rowIssue = props.issues.find((x) => x.field === tpl && x.index === i);
        const fixedRow = fixed ? fixed.rows.find((r) => r.id === row[fixed.key]) : undefined;
        const heading = fixedRow ? rowLabel(fixedRow) : null;
        return (
          <View
            key={i}
            style={{
              gap: space.xs,
              padding: space.sm,
              paddingTop: space.xs,
              borderRadius: radius.cell,
              borderWidth: 1,
              borderColor: rowIssue ? colors.redline : colors.line,
              backgroundColor: colors.card,
            }}
          >
            {heading ? (
              <View style={{ marginTop: space.s }}>
                <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>{heading.title}</Text>
                {heading.sub ? (
                  <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>{heading.sub}</Text>
                ) : null}
              </View>
            ) : null}
            {(def.fields ?? []).map((child) =>
              fixed && child.name === fixed.key ? null : (
                <FieldNode key={child.name} def={child} path={[...path, i, child.name]} value={row[child.name]} props={props} inRow />
              ),
            )}
            {rowIssue ? <ErrorText>{t(issueMessageKey(rowIssue, false))}</ErrorText> : null}
            {fixed ? null : (
              <Button
                testID={`${props.testID}.${testName}.${i}.remove`}
                label={t('staff.protocols.form.remove')}
                variant="ghost"
                onPress={() => set(value.filter((_, j) => j !== i))}
                disabled={props.disabled}
                style={{ alignSelf: 'flex-end' }}
              />
            )}
          </View>
        );
      })}
      {fixed || (def.maxItems !== undefined && value.length >= def.maxItems) ? null : (
        <Button
          testID={`${props.testID}.${testName}.add`}
          label={t(addKey ?? 'staff.protocols.form.add')}
          variant="secondary"
          size="compact"
          onPress={() => set([...value, emptyRow(def)])}
          disabled={props.disabled}
          style={{ alignSelf: 'flex-start' }}
        />
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

function emptyRow(def: FieldDef): Draft {
  const row: Draft = {};
  for (const f of def.fields ?? []) {
    row[f.name] = f.type === 'bool' ? false : f.type === 'uuids' || f.type === 'ints' ? [] : f.type === 'object' ? {} : '';
  }
  return row;
}

function PriceMapNode({
  path,
  value,
  props,
  label,
  error,
}: {
  path: DraftPath;
  value: Draft[];
  props: NodeProps;
  label: string;
  error: string | null;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const id = `${props.testID}.field.${concretePath(path)}`;
  const set = (next: Draft[]) => props.onChange(setAt(props.draft, path, next));
  const current = value;
  return (
    <View style={{ gap: space.s, marginTop: space.sm }}>
      <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, lineHeight: 19, color: colors.ink }}>{label}</Text>
      {current.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.s }}>
          <View style={{ flex: 1 }}>
            <Field
              testID={`${id}.${i}.minutes`}
              label={t('staff.protocols.form.minutes')}
              value={String(row.minutes ?? '')}
              onChangeText={(v) => set(current.map((r, j) => (j === i ? { ...r, minutes: v } : r)))}
              keyboardType="number-pad"
              latin
              editable={!props.disabled}
            />
          </View>
          <View style={{ flex: 1.4 }}>
            <Field
              testID={`${id}.${i}.price`}
              label={t('staff.protocols.form.price')}
              value={String(row.price ?? '')}
              onChangeText={(v) => set(current.map((r, j) => (j === i ? { ...r, price: v } : r)))}
              keyboardType="number-pad"
              latin
              editable={!props.disabled}
            />
          </View>
          <Button
            testID={`${id}.${i}.remove`}
            label={t('staff.protocols.form.remove')}
            variant="ghost"
            onPress={() => set(current.filter((_, j) => j !== i))}
            disabled={props.disabled}
          />
        </View>
      ))}
      {current.length >= 12 ? null : (
        <Button
          testID={`${id}.add`}
          label={t('staff.protocols.form.addPrice')}
          variant="secondary"
          size="compact"
          onPress={() => set([...current, { minutes: '', price: '' }])}
          disabled={props.disabled}
          style={{ alignSelf: 'flex-start' }}
        />
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

/** A selectable pill: an enum option, a weekday. */
export function Chip({
  testID,
  label,
  selected,
  onPress,
  disabled,
}: {
  testID: string;
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => ({
        paddingStart: 12,
        paddingEnd: 12,
        paddingTop: 8,
        paddingBottom: 8,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? brand.blue : colors.line,
        backgroundColor: selected ? brand.blue : colors.card,
        opacity: disabled ? 0.55 : pressed ? 0.75 : 1,
      })}
    >
      <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: selected ? brand.white : colors.ink }}>{label}</Text>
    </Pressable>
  );
}

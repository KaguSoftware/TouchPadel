/**
 * A sent record, read back: the same field list the form was drawn from,
 * labelled the same way, in the reader's language. Ids are shown by name when
 * the page has read the list they come from (`names`), and left out when it
 * has not: a uuid means nothing to anyone. Free text is shown as typed.
 *
 * Keys a check hook adds to the normalised record (`before`,
 * `base_updated_at`) are not in the field list and are not shown.
 */
import { View } from 'react-native';
import type { FieldDef } from '@touch/core';
import { formatDate, formatDateTime, formatIQD, formatNumber } from '@touch/i18n';
import { Text } from '../../../i18n/text';
import { useLocale } from '../../../i18n/LocaleProvider';
import { space, useTheme } from '../../../theme';
import { fieldLabelKey, optionLabelKey, WEEKDAY_KEYS } from './labels';

/** The marker the hiring purge writes over free text (§2.12). */
const PURGED = '[deleted after 90 days]';

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function RecordView({
  fields,
  record,
  names,
  skip,
}: {
  fields: readonly FieldDef[];
  record: Obj;
  /** Id → display name, from what the page has read. */
  names?: Readonly<Record<string, string>>;
  /** Template paths not shown (the launch's photo path: the photos are shown apart). */
  skip?: ReadonlySet<string>;
}) {
  return (
    <View style={{ gap: 6 }}>
      {fields.map((def) => (
        <Entry key={def.name} def={def} value={record[def.name]} path={def.name} names={names} skip={skip} />
      ))}
    </View>
  );
}

function Entry({
  def,
  value,
  path,
  names,
  skip,
}: {
  def: FieldDef;
  value: unknown;
  path: string;
  names?: Readonly<Record<string, string>>;
  skip?: ReadonlySet<string>;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  if (skip?.has(path) || value === undefined || value === null || value === '') return null;
  const key = fieldLabelKey(path);
  const label = key ? t(key) : def.name;

  const text = (() => {
    switch (def.type) {
      case 'iqd':
        return typeof value === 'number' ? formatIQD(value, locale) : null;
      case 'int':
      case 'number':
        return typeof value === 'number' ? formatNumber(value, locale) : null;
      case 'bool':
        return value === true ? t('staff.protocols.common.yes') : t('staff.protocols.common.no');
      case 'enum': {
        const k = typeof value === 'string' ? optionLabelKey(path, value) : null;
        return k ? t(k) : String(value);
      }
      case 'date':
        return typeof value === 'string' ? formatDate(new Date(`${value}T12:00:00Z`), locale) : null;
      case 'datetime':
        return typeof value === 'string' && !Number.isNaN(Date.parse(value))
          ? formatDateTime(new Date(value), locale)
          : null;
      case 'uuid':
        return typeof value === 'string' ? (names?.[value] ?? null) : null;
      case 'uuids': {
        if (!Array.isArray(value)) return null;
        const known = value.map((v) => (typeof v === 'string' ? names?.[v] : undefined)).filter((n): n is string => !!n);
        return known.length > 0 ? known.join(locale === 'ar' ? '، ' : ', ') : formatNumber(value.length, locale);
      }
      case 'ints':
        return Array.isArray(value)
          ? value
              .map((n) => (typeof n === 'number' && WEEKDAY_KEYS[n] ? t(WEEKDAY_KEYS[n]) : String(n)))
              .join(' ')
          : null;
      case 'priceMap':
        return isObj(value)
          ? Object.entries(value)
              .map(([m, p]) => `${m}′ ${typeof p === 'number' ? formatIQD(p, locale) : ''}`)
              .join(' · ')
          : null;
      case 'list':
      case 'object':
        return null;
      default:
        if (value === PURGED) return t('work.protocol.noteDeleted');
        return typeof value === 'string' ? value : String(value);
    }
  })();

  if (def.type === 'object' && isObj(value)) {
    return (
      <View style={{ gap: 4 }}>
        <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.mut }}>{label}</Text>
        <View style={{ paddingStart: space.sm, gap: 4 }}>
          {(def.fields ?? []).map((child) => (
            <Entry
              key={child.name}
              def={child}
              value={value[child.name]}
              path={`${path}.${child.name}`}
              names={names}
              skip={skip}
            />
          ))}
        </View>
      </View>
    );
  }
  if (def.type === 'list' && Array.isArray(value)) {
    if (value.length === 0) return null;
    return (
      <View style={{ gap: 4 }}>
        <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.mut }}>{label}</Text>
        {value.map((row, i) => (
          <View key={i} style={{ paddingStart: space.sm, gap: 2, borderStartWidth: 2, borderStartColor: colors.line }}>
            {isObj(row)
              ? (def.fields ?? []).map((child) => (
                  <Entry
                    key={child.name}
                    def={child}
                    value={row[child.name]}
                    path={`${path}.${child.name}`}
                    names={names}
                    skip={skip}
                  />
                ))
              : null}
          </View>
        ))}
      </View>
    );
  }
  if (text === null || text === '') return null;
  return (
    <View style={{ gap: 1 }}>
      <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.mut }}>{label}</Text>
      <Text style={{ fontFamily: fonts.body400, fontSize: 13.5, lineHeight: 20, color: colors.ink }}>{text}</Text>
    </View>
  );
}

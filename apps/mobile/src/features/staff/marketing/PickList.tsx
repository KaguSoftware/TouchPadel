/**
 * PickList: choose one thing from a short list (a menu item, a run, a
 * campaign), for the take, the campaign draft and the request to marketing.
 * With something chosen it shows that one and a Change link; without, a
 * search field and the first matches as rows.
 *
 * TEST IDs derive from the required `testID`: `${testID}.search`,
 * `${testID}.<optionId>` and `${testID}.change`.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '../../../i18n/text';
import { useLocale } from '../../../i18n/LocaleProvider';
import { radius, space, useTheme } from '../../../theme';
import { ErrorText, Field, Hint, LinkText } from '../../../components/ui';
import { CheckIcon } from '../../../components/icons';

export interface PickOption {
  id: string;
  label: string;
  /** A second, quieter line: a run's kind, a campaign's status. */
  detail?: string;
}

/** Rows shown at once; the search narrows a longer list. */
const SHOWN = 8;

export function matchOptions(options: readonly PickOption[], query: string): PickOption[] {
  const q = query.trim().toLocaleLowerCase();
  const hits = q
    ? options.filter(
        (o) => o.label.toLocaleLowerCase().includes(q) || (o.detail ?? '').toLocaleLowerCase().includes(q),
      )
    : options;
  return hits.slice(0, SHOWN);
}

export function PickList({
  testID,
  options,
  value,
  onChange,
  loading,
  error,
}: {
  testID: string;
  options: readonly PickOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  loading?: boolean;
  /** The field's own message (nothing chosen yet, when it must be). */
  error?: string | null;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const [query, setQuery] = useState('');
  const chosen = value ? options.find((o) => o.id === value) : undefined;

  if (value) {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.s,
          padding: space.sm,
          borderRadius: radius.cell,
          borderWidth: 1,
          borderColor: colors.gline,
          backgroundColor: colors.gtint,
        }}
      >
        <CheckIcon size={14} color={colors.gstrong} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.ink }}>
            {chosen?.label ?? '…'}
          </Text>
          {chosen?.detail ? (
            <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>{chosen.detail}</Text>
          ) : null}
        </View>
        <LinkText
          testID={`${testID}.change`}
          label={t('staff.marketing.pick.change')}
          onPress={() => onChange(null)}
        />
      </View>
    );
  }

  const shown = matchOptions(options, query);
  return (
    <View style={{ gap: space.xs }}>
      {options.length > SHOWN ? (
        <Field
          testID={`${testID}.search`}
          label={t('staff.marketing.pick.search')}
          value={query}
          onChangeText={setQuery}
          error={error}
        />
      ) : null}
      {loading ? (
        <Hint>{t('staff.marketing.pick.loading')}</Hint>
      ) : options.length === 0 ? (
        <Hint>{t('staff.marketing.pick.none')}</Hint>
      ) : shown.length === 0 ? (
        <Hint>{t('staff.marketing.pick.noMatch')}</Hint>
      ) : (
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.cell,
            overflow: 'hidden',
            backgroundColor: colors.card,
          }}
        >
          {shown.map((option, i) => (
            <Pressable
              key={option.id}
              testID={`${testID}.${option.id}`}
              accessibilityRole="button"
              onPress={() => {
                setQuery('');
                onChange(option.id);
              }}
              style={({ pressed }) => ({
                paddingStart: space.m,
                paddingEnd: space.m,
                paddingTop: 11,
                paddingBottom: 11,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: colors.sub,
                backgroundColor: pressed ? colors.sub : 'transparent',
              })}
            >
              <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.ink }}>{option.label}</Text>
              {option.detail ? (
                <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>{option.detail}</Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      )}
      {options.length <= SHOWN ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

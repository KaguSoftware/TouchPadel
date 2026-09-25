/**
 * Choose one or several rows from a list the server gave: an ingredient, a
 * menu category, courts, a campaign draft. Inline rather than a sheet, so a
 * long form keeps its place; a long list gets a search box.
 *
 * TEST IDs derive from the required `testID`: the box itself,
 * `${testID}.search` and `${testID}.option.<value>`.
 */
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '../../../i18n/text';
import { useLocale } from '../../../i18n/LocaleProvider';
import { radius, space, useTheme } from '../../../theme';
import { CheckIcon, ChevronIcon } from '../../../components/icons';
import { ErrorText, Field, MicroLabel } from '../../../components/ui';

export interface PickerOption {
  value: string;
  label: string;
  hint?: string | null;
}

/** Past this many options the list gets a search box. */
const SEARCH_FROM = 8;

export function OptionPicker({
  testID,
  label,
  options,
  value,
  onChange,
  multi,
  error,
  disabled,
}: {
  testID: string;
  label?: string;
  options: readonly PickerOption[];
  /** One value, or the chosen values of a `multi` picker. */
  value: string | readonly string[];
  onChange: (next: string | string[]) => void;
  multi?: boolean;
  error?: string | null;
  disabled?: boolean;
}) {
  const { t, dir } = useLocale();
  const { colors, fonts } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const chosen = useMemo(() => (Array.isArray(value) ? value : value ? [value as string] : []), [value]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const summary =
    chosen.length === 0
      ? t('staff.protocols.form.choose')
      : multi && chosen.length > 1
        ? t('staff.protocols.form.chosen', { count: chosen.length })
        : (options.find((o) => o.value === chosen[0])?.label ?? t('staff.protocols.form.choose'));

  const pick = (v: string) => {
    if (multi) {
      onChange(chosen.includes(v) ? chosen.filter((c) => c !== v) : [...chosen, v]);
      return;
    }
    onChange(v === chosen[0] ? '' : v);
    setOpen(false);
  };

  return (
    <View style={{ gap: 6 }}>
      {label ? <MicroLabel>{label}</MicroLabel> : null}
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled: !!disabled }}
        accessibilityLabel={label ? `${label}: ${summary}` : summary}
        disabled={disabled}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.s,
          paddingStart: 14,
          paddingEnd: 12,
          paddingTop: 13,
          paddingBottom: 13,
          borderRadius: radius.cell,
          // The same boundary as the shared Field beside it (2px, line2), so a
          // picker does not read as a weaker control than a text box.
          borderWidth: 2,
          borderColor: error ? colors.redline : colors.line2,
          backgroundColor: pressed ? colors.sub : colors.card,
          opacity: disabled ? 0.55 : 1,
        })}
      >
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 1,
            fontFamily: chosen.length ? fonts.body600 : fonts.body400,
            fontSize: 14,
            color: chosen.length ? colors.ink : colors.mut,
          }}
        >
          {summary}
        </Text>
        {/* The chevron points to the END (it mirrors itself in Arabic); open,
            it turns to point down, which is a quarter turn the other way
            round when the glyph is mirrored. */}
        <View style={{ transform: [{ rotate: open ? (dir === 'rtl' ? '-90deg' : '90deg') : '0deg' }] }}>
          <ChevronIcon size={15} color={colors.fnt2} />
        </View>
      </Pressable>
      {open ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.cell,
            backgroundColor: colors.card,
            overflow: 'hidden',
          }}
        >
          {options.length > SEARCH_FROM ? (
            <View style={{ padding: space.s }}>
              <Field
                testID={`${testID}.search`}
                placeholder={t('staff.protocols.form.search')}
                value={query}
                onChangeText={setQuery}
                dense
              />
            </View>
          ) : null}
          {shown.length === 0 ? (
            <Text style={{ padding: space.m, fontFamily: fonts.body400, fontSize: 13, color: colors.mut }}>
              {options.length === 0 ? t('staff.protocols.form.noOptions') : t('staff.protocols.form.noMatch')}
            </Text>
          ) : (
            shown.map((o, i) => {
              const on = chosen.includes(o.value);
              return (
                <Pressable
                  key={o.value}
                  testID={`${testID}.option.${o.value}`}
                  accessibilityRole={multi ? 'checkbox' : 'radio'}
                  accessibilityState={{ checked: on, selected: on }}
                  onPress={() => pick(o.value)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.s,
                    paddingStart: 14,
                    paddingEnd: 14,
                    paddingTop: 11,
                    paddingBottom: 11,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: colors.sub,
                    backgroundColor: pressed ? colors.sub : 'transparent',
                  })}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: multi ? 6 : radius.pill,
                      borderWidth: 1.5,
                      // An empty box is still a control: fnt clears 3:1 on the card.
                      borderColor: on ? colors.blue : colors.fnt,
                      backgroundColor: on ? colors.blue : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {on ? <CheckIcon size={12} color={colors.card} strokeWidth={3} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.body600, fontSize: 13.5, color: colors.ink }}>{o.label}</Text>
                    {o.hint ? (
                      <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>{o.hint}</Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

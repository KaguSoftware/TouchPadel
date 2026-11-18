import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { isolate, isolateLtr } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { Field } from '../../components/ui';
import { space, useTheme } from '../../theme';
import { useFindPlayer } from './hooks';
import { normaliseUsername, type SetInput } from './logic';

/**
 * The pieces the score forms share (app/ranks-report.tsx, the player's report; app/(coach-mode)/
 * coach-mode-result.tsx, a coach's game, 0444): a player picked by exact username, and the sets.
 */

/** A value that settles 300 ms after the last keystroke, so a lookup is not sent per letter. */
function useSettled(value: string): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), 300);
    return () => clearTimeout(id);
  }, [value]);
  return settled;
}

/**
 * One player picked by username: the field, and under it who that is ("Found: Sara M."), or
 * that nobody has the name, or that it is the guest themself. Exact usernames only (the server
 * looks one up, never searches), so nobody can be found by guessing a name.
 */
export function PlayerField({
  label,
  value,
  onChange,
  onKnown,
  testID,
}: {
  /** The field's label ("Your partner", "First player"). */
  label: string;
  value: string;
  onChange: (v: string) => void;
  onKnown: (known: boolean) => void;
  testID: string;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const settled = useSettled(value);
  const found = useFindPlayer(settled);
  const name = normaliseUsername(settled);
  const known = name.length >= 3 && !!found.data && !found.data.me && normaliseUsername(value) === name;
  useEffect(() => onKnown(known), [known, onKnown]);

  let line: { text: string; color: string } | null = null;
  if (name.length >= 3 && found.isSuccess) {
    if (!found.data) line = { text: t('ranks.report.notFound'), color: colors.redtext };
    else if (found.data.me) line = { text: t('ranks.report.isYou'), color: colors.redtext };
    else
      line = {
        text: found.data.name
          ? t('ranks.report.found', { name: isolate(found.data.name) })
          : t('ranks.report.foundNoName'),
        color: colors.gtext,
      };
  }
  return (
    <View>
      <Field
        testID={testID}
        label={label}
        value={value}
        onChangeText={onChange}
        placeholder={t('ranks.report.placeholder')}
        autoCapitalize="none"
        autoCorrect={false}
        latin
        dense
      />
      {line ? (
        <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: line.color, marginTop: space.xs }}>
          {line.text}
        </Text>
      ) : null}
    </View>
  );
}


/**
 * Up to three sets, two small number fields each, and the line when one is half filled. The
 * score itself is logic.buildScore's. `testID` is the prefix: `${testID}.<set>.us|them`.
 */
export function SetsInput({
  sets,
  onChange,
  invalid,
  sideLabels = ['us', 'them'],
  testID,
}: {
  sets: SetInput[];
  onChange: (next: SetInput[]) => void;
  invalid: boolean;
  /** The two fields' id segments (the report: us | them; a coach: a | b). */
  sideLabels?: readonly [string, string];
  testID: string;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <View style={{ gap: space.s }}>
      {sets.map((set, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={{ width: 64, fontFamily: fonts.body600, fontSize: 13, color: colors.mut }}>
            {t('ranks.report.set', { n: isolateLtr(String(i + 1)) })}
          </Text>
          {[0, 1].map((side) => (
            <View key={side} style={{ width: 64 }}>
              <Field
                testID={`${testID}.${i + 1}.${sideLabels[side]}`}
                value={set[side]}
                onChangeText={(v) =>
                  onChange(sets.map((s, j) => (j === i ? ((side === 0 ? [v, s[1]] : [s[0], v]) as SetInput) : s)))
                }
                keyboardType="number-pad"
                maxLength={2}
                latin
                dense
                style={{ textAlign: 'center' }}
              />
            </View>
          ))}
        </View>
      ))}
      {invalid ? (
        <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.redtext }}>{t('ranks.report.scoreInvalid')}</Text>
      ) : null}
    </View>
  );
}

/**
 * The age band (migration 0368, Majed 2026-10-24: "at sign up, the customer is
 * asked their gender, their age, their level"). Six chips, one tap, nothing
 * picked at first: a band is what someone answers without thinking, where a
 * date of birth is a form to fill in.
 *
 * Built as GenderPicker's twin so the sign-up form reads as one thing: the same
 * micro label, the same chosen state (blue frame, tinted ground, a check), the
 * same error line. It wraps to two rows at any width, and each chip holds the
 * 48pt target. A radio group to assistive tech. `testID` is REQUIRED: the
 * group carries it and each option `${testID}.<band>`.
 */
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { AGE_BANDS, type AgeBand } from '../features/playProfile/logic';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { radius, space, useTheme } from '../theme';
import { CheckIcon } from './icons';
import { ErrorText, MicroLabel } from './ui';

export function AgeBandPicker({
  testID,
  value,
  onChange,
  error,
  disabled = false,
  hint = false,
  style,
}: {
  testID: string;
  value: AgeBand | null;
  onChange: (next: AgeBand) => void;
  error?: string | null;
  disabled?: boolean;
  /** The one-line "Pick the range you are in", under the chips. */
  hint?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const label = t('profile.ageSection');
  return (
    <View style={[{ marginTop: space.sm }, style]}>
      <MicroLabel style={{ marginBottom: 5 }}>{label}</MicroLabel>
      <View
        testID={testID}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}
      >
        {AGE_BANDS.map((band) => {
          const selected = value === band;
          return (
            <Pressable
              key={band}
              testID={`${testID}.${band}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(band)}
              style={({ pressed }) => ({
                // Three to a row on a narrow phone, two on the narrowest: the
                // chips carry numbers, so they need less room than the gender's.
                flexGrow: 1,
                flexBasis: '30%',
                minHeight: 48,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                paddingStart: space.sm,
                paddingEnd: space.sm,
                borderRadius: radius.cell,
                borderWidth: 1.5,
                borderColor: selected ? colors.blue : error ? colors.redline : colors.line2,
                backgroundColor: selected ? colors.tint : pressed ? colors.sub : colors.card,
                opacity: disabled ? 0.5 : 1,
              })}
            >
              {selected ? <CheckIcon size={14} color={colors.blue} strokeWidth={2.6} /> : null}
              <Text
                style={{
                  fontFamily: selected ? fonts.body800 : fonts.body700,
                  fontSize: 14,
                  color: selected ? colors.blue : colors.ink,
                }}
              >
                {t(`profile.ageBand.${band}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {hint && !error ? (
        <Text
          style={{
            marginTop: 6,
            fontFamily: fonts.body400,
            fontSize: 12.5,
            lineHeight: 17,
            color: colors.mut,
            textAlign: 'auto',
          }}
        >
          {t('profile.ageHint')}
        </Text>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

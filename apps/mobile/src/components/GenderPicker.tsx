/**
 * The required "Woman / Man" choice (migration 0353, Majed 2026-10-19: a gender
 * is a must for every account, because some courts and hours are kept for
 * women or for men). Sign up and Complete profile ask it with this.
 *
 * Two equal buttons with NOTHING picked at first: a segmented control always
 * shows one side as chosen, and a default here would be a guess saved as the
 * guest's answer, which only the front desk can undo. A radio group to
 * assistive tech. `testID` is REQUIRED: the group carries it and each option
 * `${testID}.female` / `${testID}.male`.
 */
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { radius, space, useTheme } from '../theme';
import { CheckIcon } from './icons';
import { ErrorText, MicroLabel } from './ui';

export type GenderValue = 'female' | 'male';

const OPTIONS: readonly GenderValue[] = ['female', 'male'];

export function GenderPicker({
  testID,
  value,
  onChange,
  error,
  disabled = false,
  style,
}: {
  testID: string;
  value: GenderValue | null;
  onChange: (next: GenderValue) => void;
  error?: string | null;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const label = t('profile.genderSection');
  return (
    <View style={[{ marginTop: space.sm }, style]}>
      <MicroLabel style={{ marginBottom: 5 }}>{label}</MicroLabel>
      <View
        testID={testID}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={{ flexDirection: 'row', gap: space.s }}
      >
        {OPTIONS.map((option) => {
          const selected = value === option;
          return (
            <Pressable
              key={option}
              testID={`${testID}.${option}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(option)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 48,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingStart: space.m,
                paddingEnd: space.m,
                borderRadius: radius.cell,
                borderWidth: 1.5,
                borderColor: selected ? colors.blue : error ? colors.redline : colors.line2,
                backgroundColor: selected ? colors.tint : pressed ? colors.sub : colors.card,
                opacity: disabled ? 0.5 : 1,
              })}
            >
              {selected ? <CheckIcon size={15} color={colors.blue} strokeWidth={2.6} /> : null}
              <Text
                style={{
                  fontFamily: selected ? fonts.body800 : fonts.body700,
                  fontSize: 15,
                  color: selected ? colors.blue : colors.ink,
                }}
              >
                {t(option === 'female' ? 'matches.gender.female' : 'matches.gender.male')}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

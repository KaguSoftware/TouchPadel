/**
 * Date of birth on sign-up: a row that opens the same bottom-sheet date wheel
 * Edit profile uses (`DateWheelSheet`). Nothing is chosen at first; the sheet
 * opens on the usual default and the guest confirms a day. The value is the
 * server's `YYYY-MM-DD`; the sign-up form derives the age band from it.
 */
import { useState } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { formatDate } from '@touch/i18n';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { radius, space, useTheme } from '../theme';
import {
  BIRTH_MIN,
  BIRTH_TZ,
  birthDateToDate,
  defaultBirthDate,
  todayBirthDate,
} from '../features/profile/birthDate';
import { DateWheelSheet } from './DateWheelSheet';
import { CalendarIcon } from './icons';
import { ErrorText, MicroLabel } from './ui';

export function BirthDatePicker({
  testID,
  value,
  onChange,
  error,
  style,
}: {
  testID: string;
  /** `YYYY-MM-DD`, or null while nothing is chosen. */
  value: string | null;
  onChange: (next: string) => void;
  error?: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const [open, setOpen] = useState(false);
  const label = t('profile.birthSection');
  const date = birthDateToDate(value);
  return (
    <View style={[{ marginTop: space.sm }, style]}>
      <MicroLabel style={{ marginBottom: 5 }}>{label}</MicroLabel>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          minHeight: 48,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.s,
          paddingStart: space.sm,
          paddingEnd: space.sm,
          borderRadius: radius.cell,
          borderWidth: 1.5,
          borderColor: error ? colors.redline : colors.line2,
          backgroundColor: pressed ? colors.sub : colors.card,
        })}
      >
        <CalendarIcon size={16} color={colors.gstrong} />
        <Text
          style={{
            fontFamily: date ? fonts.body700 : fonts.body400,
            fontSize: 15,
            color: date ? colors.ink : colors.mut,
          }}
        >
          {date ? formatDate(date, locale, BIRTH_TZ) : label}
        </Text>
      </Pressable>
      <ErrorText>{error}</ErrorText>
      <DateWheelSheet
        testID={`${testID}.sheet`}
        visible={open}
        title={label}
        value={value ?? defaultBirthDate()}
        min={BIRTH_MIN}
        max={todayBirthDate()}
        confirmLabel={t('common.confirm')}
        onConfirm={(day) => {
          setOpen(false);
          onChange(day);
        }}
        onClose={() => setOpen(false)}
      />
    </View>
  );
}

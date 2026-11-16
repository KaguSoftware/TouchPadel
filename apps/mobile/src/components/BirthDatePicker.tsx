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
import { brand, radius, space, useTheme } from '../theme';
import {
  BIRTH_MIN,
  BIRTH_TZ,
  birthDateToDate,
  defaultBirthDate,
  todayBirthDate,
} from '../features/profile/birthDate';
import { DateWheelSheet } from './DateWheelSheet';
import { CalendarIcon } from './icons';
import { FloatingLabel } from './FloatingLabel';
import { ErrorText, LINE } from './ui';

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
    <View style={style}>
      {/* The label floats up like the name fields': it rests in the box and rises once a day is chosen. */}
      <FloatingLabel label={label} floated={!!date || open}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={() => setOpen(true)}
          style={({ pressed }) => ({
            marginTop: space.sm,
            height: 1 + 14 + LINE + 14 + 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.s,
            paddingStart: space.m,
            paddingEnd: space.m,
            borderRadius: radius.cell,
            // The same 2px border as the text fields above.
            borderWidth: 2,
            borderColor: open ? brand.green : error ? colors.redline : colors.line2,
            backgroundColor: pressed ? colors.sub : colors.card,
          })}
        >
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontFamily: fonts.body700,
              fontSize: 15,
              lineHeight: LINE,
              color: colors.ink,
            }}
          >
            {date ? formatDate(date, locale, BIRTH_TZ) : ''}
          </Text>
          <CalendarIcon size={16} color={colors.gstrong} />
        </Pressable>
      </FloatingLabel>
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

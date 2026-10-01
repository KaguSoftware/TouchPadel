/**
 * The platform's own date and time picker, wrapped once
 * (docs/design/coaching/guest.md §4.13.8, R19): coach mode's time off, group
 * and course starts, reschedules, and weekly hours.
 *
 *  - iOS: `UIDatePicker` in its compact style, inline in the row — the
 *    system's own date and time buttons, which open the system popover.
 *    `minuteInterval={30}` keeps a lesson start on the half-hour grid.
 *  - Android: a row that opens the Material date dialog, then (for a date and
 *    time) the clock dialog, through `DateTimePickerAndroid.open`. The clock
 *    has no reliable 30-minute step, so its answer goes through `snap`
 *    (`snapToGrid` for a lesson start).
 *
 * Every value is shown and picked in the branch's time zone (`timeZone`, an
 * IANA name), never the phone's: a coach abroad still sets Baghdad times.
 *
 * `@react-native-community/datetimepicker` is a native module: it reaches
 * phones only in a new dev client and the next store build (R19).
 *
 * `testID` is REQUIRED and forwarded explicitly: `<route>.<element>` on the
 * row, `${testID}.picker` on the iOS picker.
 */
import { Platform, Pressable, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { formatDate, formatDateTime, formatTime } from '@touch/i18n';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../theme';

export type DateTimeMode = 'date' | 'time' | 'datetime';

export interface DateTimeFieldProps {
  testID: string;
  label?: string;
  value: Date;
  mode: DateTimeMode;
  onChange: (next: Date) => void;
  /** The IANA zone the value is shown and picked in (the branch's). */
  timeZone: string;
  /** 30 for a lesson start (C-20, R9). */
  minuteInterval?: 30;
  /** Applied to every picked value (Android's clock has no 30-minute step). */
  snap?: (picked: Date) => Date;
  minimumDate?: Date;
  maximumDate?: Date;
  error?: string | null;
  disabled?: boolean;
}

/** The value as the row reads it, in the branch's zone and the app's language. */
function display(value: Date, mode: DateTimeMode, locale: 'en' | 'ar', timeZone: string): string {
  if (mode === 'date') return formatDate(value, locale, timeZone);
  if (mode === 'time') return formatTime(value, locale, timeZone);
  return formatDateTime(value, locale, timeZone);
}

export function DateTimeField({
  testID,
  label,
  value,
  mode,
  onChange,
  timeZone,
  minuteInterval,
  snap,
  minimumDate,
  maximumDate,
  error,
  disabled,
}: DateTimeFieldProps) {
  const { locale } = useLocale();
  const { colors, fonts, appearance } = useTheme();
  const pick = (next: Date) => onChange(snap ? snap(next) : next);

  const labelText = label ? (
    <Text style={{ flexShrink: 1, fontFamily: fonts.body700, fontSize: 13, color: colors.mut2 }}>
      {label}
    </Text>
  ) : null;
  const errorText = error ? (
    <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.redtext, marginTop: 4 }}>
      {error}
    </Text>
  ) : null;

  if (Platform.OS === 'ios') {
    return (
      <View testID={testID} style={{ opacity: disabled ? 0.5 : 1 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space.s,
            minHeight: 44,
          }}
        >
          {labelText}
          <DateTimePicker
            testID={`${testID}.picker`}
            value={value}
            mode={mode}
            display="compact"
            minuteInterval={minuteInterval}
            timeZoneName={timeZone}
            locale={locale === 'ar' ? 'ar@numbers=latn' : 'en_GB'}
            themeVariant={appearance === 'dark' ? 'dark' : 'light'}
            accentColor={brand.blue}
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            disabled={disabled}
            onValueChange={(_event, next) => pick(next)}
          />
        </View>
        {errorText}
      </View>
    );
  }

  const open = () => {
    const common = {
      timeZoneName: timeZone,
      is24Hour: true,
      minuteInterval,
      minimumDate,
      maximumDate,
    } as const;
    if (mode === 'time') {
      DateTimePickerAndroid.open({
        ...common,
        value,
        mode: 'time',
        onValueChange: (_e, next) => pick(next),
      });
      return;
    }
    DateTimePickerAndroid.open({
      ...common,
      value,
      mode: 'date',
      onValueChange: (_e, day) => {
        if (mode === 'date') {
          pick(day);
          return;
        }
        // The date and time come as two dialogs, one after the other.
        DateTimePickerAndroid.open({
          ...common,
          value: day,
          mode: 'time',
          onValueChange: (_e2, at) => pick(at),
        });
      },
    });
  };

  return (
    <View>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={
          label ? `${label}: ${display(value, mode, locale, timeZone)}` : undefined
        }
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={open}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.s,
          minHeight: 48,
          paddingStart: space.m,
          paddingEnd: space.m,
          borderRadius: radius.cell,
          borderWidth: 2,
          borderColor: error ? colors.redline : colors.line2,
          backgroundColor: pressed ? colors.sub : colors.card,
          opacity: disabled ? 0.5 : 1,
        })}
      >
        {labelText}
        <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.blue }}>
          {display(value, mode, locale, timeZone)}
        </Text>
      </Pressable>
      {errorText}
    </View>
  );
}

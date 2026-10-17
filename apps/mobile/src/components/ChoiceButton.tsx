/**
 * A filter as one big button (Sait, 2026-10-17: "one row of filters,
 * remembered"): a small label saying what it filters, the current choice in
 * bold, and a round down arrow that says it can be changed. Tapping it opens
 * the platform's own choice: the action sheet (`nativeChoice`) for up to three
 * options, the wheel sheet beyond that, since Android's alert holds three
 * buttons at most (nativeChoice.ts).
 *
 * Two of them share a row; give each `flex: 1` through `style`.
 * `testID` is REQUIRED: the button carries it, the wheel sheet `${testID}.sheet`.
 */
import { useState } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { radius, space, useTheme } from '../theme';
import { ChevronDownIcon } from './icons';
import { ANDROID_MAX_BUTTONS, nativeChoice } from './nativeChoice';
import { WheelSheet } from './WheelSheet';

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

export function ChoiceButton<T extends string>({
  testID,
  label,
  title,
  options,
  value,
  onChange,
  style,
}: {
  testID: string;
  /** What it filters, over the value: "Store". */
  label: string;
  /** The sheet's title: "Show stock from". */
  title: string;
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange: (next: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, fonts } = useTheme();
  const { t } = useLocale();
  const [wheelOpen, setWheelOpen] = useState(false);
  const [wheelPick, setWheelPick] = useState<T>(value);
  const current = options.find((o) => o.value === value)?.label ?? '';

  const open = async () => {
    if (options.length <= ANDROID_MAX_BUTTONS) {
      const picked = await nativeChoice<T>({ title, options, cancelLabel: t('common.cancel') });
      if (picked && picked !== value) onChange(picked);
      return;
    }
    setWheelPick(value);
    setWheelOpen(true);
  };

  return (
    <>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current}`}
        accessibilityHint={title}
        onPress={() => void open()}
        style={({ pressed }) => [
          {
            minHeight: 52,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.s,
            paddingStart: space.m,
            paddingEnd: space.sm,
            paddingTop: 7,
            paddingBottom: 7,
            borderRadius: radius.cell,
            borderWidth: 1.5,
            borderColor: colors.line2,
            backgroundColor: pressed ? colors.sub : colors.card,
          },
          style,
        ]}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{
              fontFamily: fonts.body800,
              fontSize: 11,
              letterSpacing: 0.6,
              color: colors.fnt,
              textTransform: 'uppercase',
            }}
          >
            {label}
          </Text>
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.body800, fontSize: 15, color: colors.blue }}
          >
            {current}
          </Text>
        </View>
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: colors.tint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ChevronDownIcon size={14} color={colors.blue} />
        </View>
      </Pressable>
      {options.length > ANDROID_MAX_BUTTONS ? (
        <WheelSheet<T>
          testID={`${testID}.sheet`}
          visible={wheelOpen}
          title={title}
          options={options}
          value={wheelPick}
          onChange={setWheelPick}
          confirmLabel={t('common.done')}
          onConfirm={() => {
            setWheelOpen(false);
            if (wheelPick !== value) onChange(wheelPick);
          }}
          onClose={() => setWheelOpen(false)}
        />
      ) : null}
    </>
  );
}

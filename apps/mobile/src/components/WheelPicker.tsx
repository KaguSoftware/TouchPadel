/**
 * A short list picked by scrolling a wheel, like the date picker's drum: the
 * Android half of `WheelSheet` (Edit profile's gender, owner 2026-10-04). iOS
 * draws SwiftUI's own wheel inside its native sheet instead
 * (`WheelSheet.ios.tsx`); Material has no wheel, so this is a ScrollView that
 * snaps row by row, the middle row picked and drawn on a band. A tap on a row
 * scrolls it to the middle.
 *
 * `testID` is REQUIRED; every row is `${testID}.<value>`.
 */
import { useEffect, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Text } from '../i18n/text';
import { radius, useTheme } from '../theme';
import { WHEEL_ROW, WHEEL_ROWS, type WheelPickerProps } from './WheelPicker.types';

export type { WheelOption, WheelPickerProps } from './WheelPicker.types';

export function WheelPicker<T extends string>({
  testID,
  options,
  value,
  onChange,
}: WheelPickerProps<T>) {
  const { colors, fonts } = useTheme();
  const scroll = useRef<ScrollView>(null);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  // As many rows as the list needs, up to five: a short list leaves no empty
  // rows above and below it.
  const rows = Math.min(WHEEL_ROWS, options.length % 2 ? options.length : options.length + 1);
  const height = rows * WHEEL_ROW;
  const pad = (height - WHEEL_ROW) / 2;

  // Follow a value set from outside (and place the first one) without animating.
  useEffect(() => {
    scroll.current?.scrollTo({ y: index * WHEEL_ROW, animated: false });
  }, [index]);

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.min(
      options.length - 1,
      Math.max(0, Math.round(e.nativeEvent.contentOffset.y / WHEEL_ROW)),
    );
    const next = options[i];
    if (next && next.value !== value) onChange(next.value);
  };

  return (
    <View style={{ height }}>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: pad,
          start: 0,
          end: 0,
          height: WHEEL_ROW,
          borderRadius: radius.cell,
          backgroundColor: colors.sub,
        }}
      />
      <ScrollView
        ref={scroll}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ROW}
        decelerationRate="fast"
        contentOffset={{ x: 0, y: index * WHEEL_ROW }}
        contentContainerStyle={{ paddingTop: pad, paddingBottom: pad }}
        onMomentumScrollEnd={settle}
        nestedScrollEnabled
      >
        {options.map((o, i) => {
          const picked = i === index;
          return (
            <Pressable
              key={o.value}
              testID={`${testID}.${o.value}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: picked }}
              onPress={() => {
                scroll.current?.scrollTo({ y: i * WHEEL_ROW, animated: true });
                if (!picked) onChange(o.value);
              }}
              style={{ height: WHEEL_ROW, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text
                style={{
                  fontFamily: picked ? fonts.body700 : fonts.body400,
                  fontSize: picked ? 17 : 15,
                  color: picked ? colors.ink : colors.mut,
                  textAlign: 'center',
                }}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

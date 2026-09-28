/**
 * Place an order: the pieces the four order pages share. Sized for a thumb on
 * a moving waiter's phone: every tap target is at least 44 pt.
 *
 * TEST IDs derive from the required `testID`: a Stepper forwards
 * `${testID}.less` and `${testID}.more`; a ChoiceRow is its own `testID`.
 */
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { formatNumber } from '@touch/i18n';
import { Text } from '../../../i18n/text';
import { useLocale } from '../../../i18n/LocaleProvider';
import { radius, space, useTheme } from '../../../theme';
import { CheckIcon, MinusIcon, PlusIcon } from '../../../components/icons';
import { staffKeys } from '../keys';
import { fetchFloor, fetchFloorMenu } from './api';

/** The tables and their open tabs; kept fresh while a page shows them (a tab the till settles drops out). */
export function useFloor(venue: string) {
  return useQuery({
    queryKey: staffKeys.floor(venue),
    queryFn: () => fetchFloor(venue),
    enabled: venue !== '',
    refetchInterval: 20_000,
  });
}

export function useFloorMenu(venue: string) {
  return useQuery({
    queryKey: staffKeys.floorMenu(venue),
    queryFn: () => fetchFloorMenu(venue),
    enabled: venue !== '',
    // Sold out and 86'd change during service; read again every few minutes.
    refetchInterval: 180_000,
  });
}

/** A light tick for an add or a count change; never for a failure. */
export function tick() {
  void Haptics.selectionAsync().catch(() => {});
}

export const TOUCH = 44;

/** − n +, for a line's count. `min` 0 lets the minus remove the line. */
export function Stepper({
  testID,
  value,
  onChange,
  min = 1,
  max = 99,
  lessLabel,
  moreLabel,
  disabled,
}: {
  testID: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  lessLabel: string;
  moreLabel: string;
  disabled?: boolean;
}) {
  const { colors, fonts } = useTheme();
  const { locale } = useLocale();
  const button = (which: 'less' | 'more') => {
    const off = disabled || (which === 'less' ? value <= min : value >= max);
    const Icon = which === 'less' ? MinusIcon : PlusIcon;
    return (
      <Pressable
        testID={`${testID}.${which}`}
        accessibilityRole="button"
        accessibilityLabel={which === 'less' ? lessLabel : moreLabel}
        accessibilityState={{ disabled: !!off }}
        disabled={off}
        hitSlop={4}
        onPress={() => {
          tick();
          onChange(which === 'less' ? value - 1 : value + 1);
        }}
        style={({ pressed }) => ({
          width: TOUCH,
          height: TOUCH,
          borderRadius: radius.button,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? colors.line : colors.sub,
          opacity: off ? 0.4 : 1,
        })}
      >
        <Icon size={18} color={colors.ink} strokeWidth={2.4} />
      </Pressable>
    );
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
      {button('less')}
      <Text
        style={{
          minWidth: 28,
          textAlign: 'center',
          fontFamily: fonts.display800,
          fontSize: 18,
          color: colors.ink,
          fontVariant: ['tabular-nums'],
        }}
      >
        {formatNumber(value, locale)}
      </Text>
      {button('more')}
    </View>
  );
}

/**
 * One choice in a list: a tab to add to, a size, an option. A round mark for
 * pick-one, a square for pick-several; the detail sits under the label and
 * the trailing text (a price) after it.
 */
export function ChoiceRow({
  testID,
  label,
  detail,
  trailing,
  selected,
  multi,
  disabled,
  onPress,
  last,
  children,
}: {
  testID: string;
  label: string;
  detail?: string | null;
  trailing?: string | null;
  selected: boolean;
  multi?: boolean;
  disabled?: boolean;
  onPress: () => void;
  last?: boolean;
  /** Shown under the row while it is selected (a new tab's name field). */
  children?: ReactNode;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View style={{ borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.sub }}>
      <Pressable
        testID={testID}
        accessibilityRole={multi ? 'checkbox' : 'radio'}
        accessibilityState={{ checked: selected, disabled: !!disabled }}
        disabled={disabled}
        onPress={() => {
          tick();
          onPress();
        }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          minHeight: 52,
          paddingStart: space.l,
          paddingEnd: space.l,
          paddingTop: 10,
          paddingBottom: 10,
          backgroundColor: pressed ? colors.sub : 'transparent',
          opacity: disabled ? 0.5 : 1,
        })}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: multi ? 6 : 11,
            borderWidth: 2,
            borderColor: selected ? colors.blue : colors.line2,
            backgroundColor: selected ? colors.blue : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected ? <CheckIcon size={13} color={colors.card} strokeWidth={3} /> : null}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontFamily: fonts.body700, fontSize: 15, lineHeight: 20, color: colors.ink }}>{label}</Text>
          {detail ? (
            <Text numberOfLines={2} style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 17, color: colors.mut }}>
              {detail}
            </Text>
          ) : null}
        </View>
        {trailing ? (
          <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.mut2, fontVariant: ['tabular-nums'] }}>
            {trailing}
          </Text>
        ) : null}
      </Pressable>
      {selected && children ? (
        <View style={{ paddingStart: space.l, paddingEnd: space.l, paddingBottom: space.m }}>{children}</View>
      ) : null}
    </View>
  );
}

/**
 * ChecklistRow — one tickable line of a staff list (build-contracts-2026-09-23
 * §6.3): a daily checklist line, or a line of the driver's run. The box and the
 * text are one control, announced as a checkbox; whatever the screen passes as
 * `children` (a photo, a photo field, a note) sits under the text, outside the
 * control, so a button in it takes its own presses.
 *
 * CONTROLLED. The screen owns `checked` and decides what a press does: a line
 * that needs a photo may refuse a bare tick and say why in `flag`.
 *
 * TEST ID. The required `testID` names the control (`staff-checklist.item.<id>`,
 * `staff-shopping.run.<id>`); controls inside `children` carry their own.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../theme';
import { CheckIcon } from './icons';

export interface ChecklistRowProps {
  testID: string;
  label: string;
  /**
   * A short figure on the label's line, at its far end: how much of a run
   * line to buy ("5 packs"). Part of the control, and of what it announces.
   */
  aside?: string | null;
  checked: boolean;
  onToggle: () => void;
  /** Under the label once ticked: who and when. */
  meta?: string | null;
  /** Under the label in amber: what the line still needs ("Needs a photo"). */
  flag?: string | null;
  busy?: boolean;
  disabled?: boolean;
  /** Drops the divider under the last row of a card. */
  last?: boolean;
  children?: ReactNode;
}

const BOX = 24;

export function ChecklistRow({
  testID,
  label,
  aside,
  checked,
  onToggle,
  meta,
  flag,
  busy,
  disabled,
  last,
  children,
}: ChecklistRowProps) {
  const { colors, fonts } = useTheme();
  const { locale } = useLocale();
  const labelStyle = {
    fontFamily: fonts.body600,
    fontSize: 14,
    lineHeight: 20,
    color: checked ? colors.mut : colors.ink,
  };
  return (
    <View
      style={{
        paddingTop: space.sm,
        paddingBottom: space.sm,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.sub,
      }}
    >
      <Pressable
        testID={testID}
        accessibilityRole="checkbox"
        accessibilityLabel={aside ? `${label}${locale === 'ar' ? '، ' : ', '}${aside}` : label}
        accessibilityState={{ checked, disabled: !!(disabled || busy), busy: !!busy }}
        disabled={disabled || busy}
        onPress={onToggle}
        hitSlop={{ top: 6, bottom: 6 }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: space.sm,
          opacity: disabled ? 0.55 : pressed ? 0.7 : 1,
        })}
      >
        <View
          style={{
            width: BOX,
            height: BOX,
            marginTop: 1,
            borderRadius: radius.cell / 2,
            borderWidth: checked ? 0 : 2,
            borderColor: colors.line2,
            backgroundColor: checked ? brand.green : colors.card,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {busy ? (
            <ActivityIndicator size="small" color={checked ? brand.greenInk : colors.blue} />
          ) : checked ? (
            <CheckIcon size={15} color={brand.greenInk} strokeWidth={2.8} />
          ) : null}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          {aside ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s }}>
              <Text style={[labelStyle, { flexShrink: 1 }]}>{label}</Text>
              <Text style={[labelStyle, { fontFamily: fonts.body700 }]}>{aside}</Text>
            </View>
          ) : (
            <Text style={labelStyle}>{label}</Text>
          )}
          {flag ? (
            <Text style={{ fontFamily: fonts.body700, fontSize: 12, lineHeight: 17, color: colors.ambstrong }}>
              {flag}
            </Text>
          ) : null}
          {meta ? (
            <Text style={{ fontFamily: fonts.body400, fontSize: 12, lineHeight: 17, color: colors.mut }}>
              {meta}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {children ? (
        <View style={{ paddingStart: BOX + space.sm, marginTop: space.s, gap: space.s }}>{children}</View>
      ) : null}
    </View>
  );
}

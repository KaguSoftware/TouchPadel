/**
 * A form's optional fields, folded under "Add details" until asked for (Sait,
 * 2026-10-17: only the required fields up front). It stays open once anything
 * in it is filled or has an error (`keepOpen`), so nothing typed or wrong is
 * ever hidden.
 *
 * `testID` is REQUIRED: the toggle row carries it.
 */
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { radius, space, useTheme } from '../theme';
import { ChevronDownIcon, ChevronUpIcon } from './icons';

export function DetailsFold({
  testID,
  summary,
  keepOpen = false,
  children,
}: {
  testID: string;
  /** What is in it, after the title: "Note, photos". */
  summary?: string;
  /** Something in it is filled or wrong: shown open, and it cannot be closed. */
  keepOpen?: boolean;
  children: ReactNode;
}) {
  const { colors, fonts } = useTheme();
  const { t } = useLocale();
  const [opened, setOpened] = useState(false);
  const open = opened || keepOpen;
  const Chevron = open ? ChevronUpIcon : ChevronDownIcon;

  return (
    <View style={{ gap: space.s }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        disabled={keepOpen}
        onPress={() => setOpened((o) => !o)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.s,
          minHeight: 48,
          marginTop: space.s,
          paddingStart: space.m,
          paddingEnd: space.m,
          borderRadius: radius.cell,
          borderWidth: 1,
          borderColor: colors.line2,
          backgroundColor: pressed ? colors.sub : colors.card,
        })}
      >
        <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>
          {t(open ? 'staff.shell.hideDetails' : 'staff.shell.addDetails')}
        </Text>
        {summary && !open ? (
          <Text
            numberOfLines={1}
            style={{ flex: 1, fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut }}
          >
            {summary}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {keepOpen ? null : <Chevron size={14} color={colors.mut} />}
      </Pressable>
      {open ? children : null}
    </View>
  );
}

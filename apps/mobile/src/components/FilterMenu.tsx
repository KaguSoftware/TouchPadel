/**
 * Android: a round button in the title bar, drawn in React Native beside the
 * account avatar (a green dot while a choice other than the first is on), and
 * Compose's `DropdownMenu` anchored to it. The current choice carries a tick. iOS is `FilterMenu.ios.tsx`.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
// Compose's views under other names: the testID lint rule matches the app's own
// components by name, and these draw outside the RN tree.
import {
  DropdownMenu,
  DropdownMenuItem,
  Host,
  RNHostView,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import { brand, useTheme } from '../theme';
import { SlidersIcon } from './icons';
import type { FilterMenuProps } from './FilterMenu.types';

export type { FilterMenuOption, FilterMenuProps } from './FilterMenu.types';

/** AccountButton's size: the two sit side by side. */
const SIZE = 44;

export function FilterMenu<T extends string>({
  testID,
  label,
  options,
  value,
  onChange,
}: FilterMenuProps<T>) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const on = value !== options[0]?.value;
  const shown = on ? (options.find((o) => o.value === value)?.label ?? label) : label;
  return (
    <Host matchContents>
      <DropdownMenu expanded={open} onDismissRequest={() => setOpen(false)} color={colors.card}>
        <DropdownMenu.Trigger>
          <RNHostView matchContents>
            <View>
              <Pressable
                testID={testID}
                accessibilityRole="button"
                accessibilityLabel={shown}
                onPress={() => setOpen(true)}
                style={({ pressed }) => ({
                  width: SIZE,
                  height: SIZE,
                  borderRadius: SIZE / 2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? colors.sub : colors.card,
                  borderWidth: 1,
                  borderColor: colors.line,
                })}
              >
                <SlidersIcon size={18} color={colors.blue} />
                {on ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: 1,
                      end: 1,
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: brand.green,
                      borderWidth: 2,
                      borderColor: colors.page,
                    }}
                  />
                ) : null}
              </Pressable>
            </View>
          </RNHostView>
        </DropdownMenu.Trigger>
        <DropdownMenu.Items>
          {options.map((o) => (
            <DropdownMenuItem
              key={o.value}
              elementColors={{ textColor: colors.ink, trailingIconColor: colors.blue }}
              onClick={() => {
                setOpen(false);
                if (o.value !== value) onChange(o.value);
              }}
            >
              <DropdownMenuItem.Text>
                <ComposeText>{o.label}</ComposeText>
              </DropdownMenuItem.Text>
              {o.value === value ? (
                <DropdownMenuItem.TrailingIcon>
                  <ComposeText>✓</ComposeText>
                </DropdownMenuItem.TrailingIcon>
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
}

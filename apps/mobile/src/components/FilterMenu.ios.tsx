/**
 * iOS: one native round button in the title bar (Sait, 2026-10-20: "make the
 * button native UI kit"), SwiftUI's `Menu` whose label is the whole button: an
 * exact circle the account avatar's size beside it (a system button style pads
 * the label and came out oval), Liquid Glass on iOS 26 and a plain disc
 * before it, tinted brand blue while a choice other than the first is on. The menu is the system pull-down, an
 * inline `Picker` so the current choice carries the system tick.
 */
import { View } from 'react-native';
import { Host, Image, Menu, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  background,
  buttonStyle,
  contentShape,
  foregroundStyle,
  frame,
  glassEffect,
  menuIndicator,
  menuStyle,
  pickerStyle,
  shapes,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import { liquidGlass } from '../lib/liquidGlass';
import { brand, useTheme } from '../theme';
import type { FilterMenuProps } from './FilterMenu.types';

export type { FilterMenuOption, FilterMenuProps } from './FilterMenu.types';

/** AccountButton's size: the two sit side by side. */
const SIZE = 36;

export function FilterMenu<T extends string>({
  testID,
  label,
  options,
  value,
  onChange,
}: FilterMenuProps<T>) {
  const { colors, appearance } = useTheme();
  const on = value !== options[0]?.value;
  const shown = on ? (options.find((o) => o.value === value)?.label ?? label) : label;
  return (
    <View testID={testID}>
      <Host matchContents colorScheme={appearance === 'dark' ? 'dark' : 'light'}>
        <Menu
          label={
            <Image
              systemName="line.3.horizontal.decrease"
              size={15}
              modifiers={[
                foregroundStyle(on ? brand.white : colors.blue),
                frame({ width: SIZE, height: SIZE }),
                liquidGlass
                  ? glassEffect({
                      glass: {
                        variant: 'regular',
                        interactive: true,
                        tint: on ? brand.blue : undefined,
                      },
                      shape: 'circle',
                    })
                  : background(on ? brand.blue : colors.card, shapes.circle()),
                contentShape(shapes.circle()),
              ]}
            />
          }
          modifiers={[
            menuStyle('button'),
            buttonStyle('plain'),
            menuIndicator('hidden'),
            accessibilityLabel(shown),
          ]}
        >
          <Picker<string>
            selection={value}
            onSelectionChange={(next) => {
              if (next !== value) onChange(next as T);
            }}
            modifiers={[pickerStyle('inline')]}
          >
            {options.map((o) => (
              <SwiftText key={o.value} modifiers={[tag(o.value)]}>
                {o.label}
              </SwiftText>
            ))}
          </Picker>
        </Menu>
      </Host>
    </View>
  );
}

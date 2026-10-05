/**
 * A calendar day picked on a date wheel in a bottom sheet (Edit profile's date
 * of birth, owner 2026-10-04): `WheelSheet.ios.tsx`'s native SwiftUI sheet
 * with SwiftUI's `DatePicker` in its `.wheel` style, a prominent confirm
 * button and, when offered, a remove button. Android's half is
 * `DateWheelSheet.tsx`; props in `WheelPicker.types.ts`.
 *
 * The range holds the pick to `min..max`, but Apple's wheel still SHOWS the
 * days outside it, greyed, and bounces back off them; that look is the
 * owner's choice over three custom columns that listed only the range
 * (2026-10-04). The wheel works in the PHONE's zone, so days cross it through
 * `birthDateToLocalDate` / `localDateToBirthDate`, never UTC. Out of the RN
 * tree: no testID, like the other native sheets.
 */
import { useState } from 'react';
// SwiftUI's Button under another name: the testID lint rule matches the app's
// own `Button` by name, and a SwiftUI view has no RN node to carry an id.
import {
  BottomSheet,
  Button as SwiftButton,
  Group,
  Host,
  DatePicker,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  controlSize,
  environment,
  font,
  foregroundColor,
  foregroundStyle,
  frame,
  multilineTextAlignment,
  datePickerStyle,
  padding,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, useTheme } from '../theme';
import { tintColor } from './swiftCompat';
import { birthDateToLocalDate, localDateToBirthDate } from '../features/profile/birthDate';
import { type DateWheelSheetProps } from './WheelPicker.types';

/** Title, the wheel and up to two buttons. */
const SHEET_HEIGHT = 420;

export function DateWheelSheet({
  visible,
  title,
  message,
  value,
  min,
  max,
  confirmLabel,
  onConfirm,
  removeLabel,
  onRemove,
  onClose,
}: DateWheelSheetProps) {
  const { appearance, colors } = useTheme();
  const { locale } = useLocale();
  const scheme = appearance === 'dark' ? 'dark' : 'light';
  // The day on the wheel while the sheet is open; reset to `value` on each open.
  const [picked, setPicked] = useState(value);
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (visible) setPicked(value);
  }
  const shown = birthDateToLocalDate(picked) ?? birthDateToLocalDate(value);
  const start = birthDateToLocalDate(min) ?? undefined;
  const end = birthDateToLocalDate(max) ?? undefined;

  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }} colorScheme={scheme}>
      <BottomSheet isPresented={visible} onIsPresentedChange={(next) => !next && onClose()}>
        <Group
          modifiers={[
            presentationDetents([{ height: SHEET_HEIGHT }]),
            presentationDragIndicator('visible'),
          ]}
        >
          {/* The tint the button and the wheel's accents take. Brand blue, not the
              ink colour: in dark mode ink is near-white, and a prominent button
              drawn in it lost its white label. */}
          <Host useViewportSizeMeasurement colorScheme={scheme} seedColor={brand.blue}>
            <VStack
              spacing={8}
              modifiers={[
                // `.sheet` content does not inherit the presenter's environment
                // (see phone.ios-picker.tsx): the app's locale and appearance
                // are pushed in again here.
                environment({ key: 'locale', value: locale }),
                environment({ key: 'colorScheme', value: scheme }),
                padding({ top: 24, leading: 20, trailing: 20, bottom: 12 }),
              ]}
            >
              <Text modifiers={[font({ textStyle: 'title2', weight: 'bold' })]}>{title}</Text>
              {message ? (
                <Text
                  modifiers={[
                    font({ textStyle: 'footnote' }),
                    foregroundStyle('secondary'),
                    multilineTextAlignment('center'),
                  ]}
                >
                  {message}
                </Text>
              ) : null}
              <DatePicker
                selection={shown ?? undefined}
                range={{ start, end }}
                displayedComponents={['date']}
                onDateChange={(next) => setPicked(localDateToBirthDate(next))}
                modifiers={[
                  datePickerStyle('wheel'),
                  frame({ maxWidth: 10000 }),
                  padding({ bottom: 8 }),
                ]}
              />
              <SwiftButton
                onPress={() => onConfirm(picked)}
                // SwiftUI's own prominent button, tinted by the Host's
                // `seedColor` (brand blue): white label in both themes.
                modifiers={[buttonStyle('borderedProminent'), controlSize('large')]}
              >
                <Text modifiers={[frame({ maxWidth: 10000 }), font({ weight: 'semibold' })]}>
                  {confirmLabel}
                </Text>
              </SwiftButton>
              {removeLabel && onRemove ? (
                <SwiftButton
                  role="destructive"
                  onPress={onRemove}
                  // iOS's tinted button: red label on a light red fill, the
                  // same size as Save. The app's `danger` red on both the fill
                  // and the label, so it is red in both themes: the Host's
                  // seedColor (brand blue) and the system red cannot win.
                  modifiers={[
                    buttonStyle('bordered'),
                    controlSize('large'),
                    tintColor(colors.danger),
                  ]}
                >
                  <Text
                    modifiers={[
                      frame({ maxWidth: 10000 }),
                      font({ weight: 'semibold' }),
                      foregroundColor(colors.danger),
                    ]}
                  >
                    {removeLabel}
                  </Text>
                </SwiftButton>
              ) : null}
            </VStack>
          </Host>
        </Group>
      </BottomSheet>
    </Host>
  );
}

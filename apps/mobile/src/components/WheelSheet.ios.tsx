/**
 * The wheel sheet on iOS: a native SwiftUI `BottomSheet`, the country
 * picker's (`phone.ios-picker.tsx`), holding SwiftUI's own `.wheel` Picker,
 * the drum the date picker scrolls, and a prominent button. UIKit draws the
 * sheet, its grabber, the drag-to-dismiss and the wheel's haptics. Android's
 * half is `WheelSheet.tsx`; props in `WheelPicker.types.ts`.
 *
 * Out of the RN tree, like the country sheet: there is no RN node to hang a
 * testID from, so it takes none; the row that opens it carries one.
 */
// SwiftUI's Button under another name: the testID lint rule matches the app's
// own `Button` by name, and a SwiftUI view has no RN node to carry an id.
import {
  BottomSheet,
  Button as SwiftButton,
  Group,
  Host,
  Picker,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  clipped,
  controlSize,
  environment,
  font,
  foregroundStyle,
  frame,
  multilineTextAlignment,
  padding,
  pickerStyle,
  presentationDetents,
  presentationDragIndicator,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, useTheme } from '../theme';
import { type WheelSheetProps } from './WheelPicker.types';

/**
 * The wheel's own height. SwiftUI's is a fixed ~216 pt, centred on the pick,
 * so a three-option list sat in a band of empty rows below the title; this
 * crops it to the options plus a row's breath either side.
 */
const WHEEL_HEIGHT = 140;
/** Title, the wheel and the button, with the grabber's gap. */
const SHEET_HEIGHT = 330;

export function WheelSheet<T extends string>({
  visible,
  title,
  message,
  options,
  value,
  onChange,
  confirmLabel,
  onConfirm,
  onClose,
}: WheelSheetProps<T>) {
  const { appearance } = useTheme();
  const { locale } = useLocale();
  const scheme = appearance === 'dark' ? 'dark' : 'light';
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
              <Picker<T>
                selection={value}
                onSelectionChange={onChange}
                modifiers={[
                  pickerStyle('wheel'),
                  frame({ maxWidth: 10000, height: WHEEL_HEIGHT }),
                  clipped(),
                  padding({ bottom: 8 }),
                ]}
              >
                {options.map((o) => (
                  <Text key={o.value} modifiers={[tag(o.value)]}>
                    {o.label}
                  </Text>
                ))}
              </Picker>
              <SwiftButton
                onPress={onConfirm}
                // SwiftUI's own prominent button, tinted by the Host's
                // `seedColor` (brand blue): white label in both themes.
                modifiers={[buttonStyle('borderedProminent'), controlSize('large')]}
              >
                <Text modifiers={[frame({ maxWidth: 10000 }), font({ weight: 'semibold' })]}>
                  {confirmLabel}
                </Text>
              </SwiftButton>
            </VStack>
          </Host>
        </Group>
      </BottomSheet>
    </Host>
  );
}

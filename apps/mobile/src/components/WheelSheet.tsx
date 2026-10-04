/**
 * A short choice made on a wheel in a bottom sheet (Edit profile's gender,
 * owner 2026-10-04): the sheet the phone field's country picker opens, with a
 * wheel in place of its list and a button under it. iOS is native SwiftUI
 * (`WheelSheet.ios.tsx`); this file is Android's, a JS sheet like the country
 * picker's there (`CountryPickerJS` in `phone.tsx`), holding `WheelPicker`.
 * Closes on the scrim, the back button, or the caller after `onConfirm`.
 *
 * `testID` is REQUIRED: `${testID}.scrim` and `.wheel` (each row
 * `.wheel.<value>`); the confirm is a native Compose button and takes none.
 */
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../theme';
// Compose's Button and Text under other names: the testID lint rule matches
// the app's own `Button` by name, and these draw outside the RN tree.
import { Button as ComposeButton, Host, Text as ComposeText } from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import { WheelPicker } from './WheelPicker';
import type { WheelSheetProps } from './WheelPicker.types';

export type { WheelSheetProps } from './WheelPicker.types';

export function WheelSheet<T extends string>({
  testID,
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
  const { colors, fonts } = useTheme();
  const { t, dir } = useLocale();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, direction: dir, justifyContent: 'flex-end' }}>
        <Pressable
          testID={`${testID}.scrim`}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onClose}
          style={{
            position: 'absolute',
            top: 0,
            start: 0,
            end: 0,
            bottom: 0,
            backgroundColor: brand.scrim,
          }}
        />
        <View
          style={{
            backgroundColor: colors.card,
            borderTopStartRadius: radius.sheet,
            borderTopEndRadius: radius.sheet,
            paddingTop: space.m,
            paddingStart: space.xl,
            paddingEnd: space.xl,
            paddingBottom: insets.bottom + space.l,
            gap: space.s,
          }}
        >
          <View
            style={{
              width: 38,
              height: 4,
              borderRadius: radius.pill,
              backgroundColor: colors.line2,
              alignSelf: 'center',
              marginBottom: space.s,
            }}
          />
          <Text
            style={{
              fontFamily: fonts.display900,
              fontSize: 22,
              textTransform: 'uppercase',
              color: colors.ink,
              textAlign: 'center',
            }}
          >
            {title}
          </Text>
          {message ? (
            <Text
              style={{
                fontFamily: fonts.body400,
                fontSize: 13,
                lineHeight: 19,
                color: colors.mut,
                textAlign: 'center',
              }}
            >
              {message}
            </Text>
          ) : null}
          <WheelPicker<T>
            testID={`${testID}.wheel`}
            options={options}
            value={value}
            onChange={onChange}
          />
          {/* Material's own filled button (Compose), in the brand blue with a
              white label in both themes. Drawn natively, so it carries no
              testID; the sheet's scrim and wheel rows do. */}
          <Host matchContents={{ vertical: true }} style={{ marginTop: space.s }}>
            <ComposeButton
              onClick={onConfirm}
              colors={{ containerColor: brand.blue, contentColor: brand.white }}
              contentPadding={{ top: 14, bottom: 14 }}
              modifiers={[fillMaxWidth()]}
            >
              <ComposeText style={{ fontWeight: '600', fontSize: 16 }}>{confirmLabel}</ComposeText>
            </ComposeButton>
          </Host>
        </View>
      </View>
    </Modal>
  );
}

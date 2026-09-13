import { useRef, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { Text } from '../i18n/text';
import { MicroLabel } from './ui';
import { brand, radius, space, useTheme } from '../theme';

/**
 * The six-digit code field: one box per digit.
 *
 * WHY NOT SIX INPUTS. The obvious build gives each box its own TextInput and
 * moves focus on every keystroke. It is the one every OTP screen gets wrong:
 * backspace on an empty box has to reach backwards, a paste lands entirely in
 * box one, and iOS autofill fills only the focused input. So this is ONE
 * hidden TextInput holding the whole string, with six boxes DRAWN over it —
 * autofill, paste and backspace are then just ordinary text editing, and the
 * boxes are pure presentation.
 *
 * The input is invisible (opacity 0) rather than unmounted: it must stay
 * focusable and keep the system's autofill target. On Android an `opacity: 0`
 * input still shows a caret and a selection handle over the boxes, so the
 * caret is coloured transparent there.
 *
 * DIRECTION. A code is digits and always reads left-to-right, in Arabic too —
 * the boxes are laid out `row` and never mirrored (the RTL guard permits an
 * explicit `writingDirection: 'ltr'`, which is what a phone number field in
 * this app already does).
 */
export function CodeInput({
  label,
  value,
  onChangeText,
  length = 6,
  error,
  autoFocus,
  onSubmitEditing,
}: {
  label?: string;
  value: string;
  onChangeText: (next: string) => void;
  length?: number;
  error?: boolean;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
}) {
  const { colors, fonts } = useTheme();
  const ref = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  // Which box the next digit lands in — the caret, drawn as a ring.
  const caretAt = Math.min(value.length, length - 1);

  return (
    <View style={{ marginTop: space.sm }}>
      {label ? <MicroLabel style={{ marginBottom: 5 }}>{label}</MicroLabel> : null}
      <Pressable
        onPress={() => ref.current?.focus()}
        // One target for the whole row: tapping any box opens the keyboard,
        // which is what a guest expects from something that looks like a field.
        accessibilityRole="none"
        // `row` is NOT mirrored by RN under RTL (only `start`/`end` insets
        // are), so the boxes stay in reading order for the digits themselves.
        style={{ flexDirection: 'row', gap: 8 }}
      >
        {Array.from({ length }, (_, i) => {
          const char = value[i] ?? '';
          const filled = char !== '';
          // The ring follows the caret only while the field HAS focus; an
          // unfocused field must not look like it is waiting for a keystroke.
          const active = focused && i === caretAt && value.length < length;
          return (
            <View
              key={i}
              style={{
                flex: 1,
                height: 56,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.card,
                borderWidth: 2,
                borderColor: error
                  ? colors.redline
                  : active
                    ? brand.green
                    : filled
                      ? colors.line2
                      : colors.line,
                borderRadius: radius.cell,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.body600,
                  fontSize: 22,
                  lineHeight: 28,
                  color: colors.ink,
                  writingDirection: 'ltr',
                }}
              >
                {char}
              </Text>
            </View>
          );
        })}
      </Pressable>

      {/*
       * The real field, stretched over the boxes so the system's autofill
       * affordance ("From Messages") appears where the guest is looking.
       * `caretHidden` is iOS-only in effect; Android needs the transparent
       * caret and a zero-width selection colour as well.
       */}
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onSubmitEditing}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={length}
        autoFocus={autoFocus}
        caretHidden
        selectionColor="transparent"
        style={{
          position: 'absolute',
          top: label ? 22 : 0,
          start: 0,
          end: 0,
          height: 56,
          opacity: 0,
          // Android keeps a caret over an opacity-0 input unless the colour
          // itself is transparent.
          ...(Platform.OS === 'android' ? { color: 'transparent' } : null),
        }}
      />
    </View>
  );
}

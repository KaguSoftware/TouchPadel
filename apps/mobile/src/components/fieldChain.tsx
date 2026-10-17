/**
 * The keyboard's Next goes to the next field, and Done on the last one sends
 * (Sait, 2026-10-17), so a whole form fills without closing the keyboard.
 *
 *   const chain = useFieldChain(3, onSubmit);
 *   <Field {...chain.field(0)} … /> <Field {...chain.field(1, 'numeric')} … />
 *   {chain.bar}
 *
 * Only single-line fields join: a multiline field's return key is a new line.
 * A slot whose field is not on screen (folded, or not for this kind) is
 * skipped; Next goes to the next field that is mounted.
 *
 * iOS's number and decimal pads have no return key, so a numeric field there
 * gets a thin Next / Done bar over the pad (`chain.bar`, an
 * InputAccessoryView); Android's number pad carries the key itself.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { InputAccessoryView, Platform, Pressable, View } from 'react-native';
import type { TextInput, TextInputProps } from 'react-native';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { space, useTheme } from '../theme';

type ChainProps = Pick<
  TextInputProps,
  'returnKeyType' | 'submitBehavior' | 'onSubmitEditing' | 'onFocus' | 'inputAccessoryViewID'
> & {
  ref: (input: TextInput | null) => void;
};

export interface FieldChain {
  /** The props for the field in slot `index`; `'numeric'` for a number pad. */
  field: (index: number, kind?: 'numeric') => ChainProps;
  /** iOS's bar over the number pad; render it once on the page. */
  bar: ReactElement | null;
}

let nextChainId = 0;

export function useFieldChain(count: number, onDone?: () => void): FieldChain {
  const inputs = useRef<(TextInput | null)[]>([]);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  const [accessoryId] = useState(() => `field-chain-${++nextChainId}`);
  const [focused, setFocused] = useState(0);

  const advance = useCallback(
    (from: number) => {
      for (let i = from + 1; i < count; i++) {
        const input = inputs.current[i];
        if (input) {
          input.focus();
          return;
        }
      }
      inputs.current[from]?.blur();
      done.current?.();
    },
    [count],
  );

  const field = useCallback(
    (index: number, kind?: 'numeric'): ChainProps => {
      const last = index === count - 1;
      return {
        ref: (input) => {
          inputs.current[index] = input;
        },
        returnKeyType: last ? 'done' : 'next',
        // Keep the keyboard up between fields; the last one blurs as it sends.
        submitBehavior: last ? 'blurAndSubmit' : 'submit',
        onSubmitEditing: () => advance(index),
        onFocus: () => setFocused(index),
        inputAccessoryViewID: kind === 'numeric' && Platform.OS === 'ios' ? accessoryId : undefined,
      };
    },
    [count, advance, accessoryId],
  );

  const bar = useMemo(
    () =>
      Platform.OS === 'ios' ? (
        <ChainBar
          nativeID={accessoryId}
          last={focused >= count - 1}
          onPress={() => advance(focused)}
        />
      ) : null,
    [accessoryId, focused, count, advance],
  );

  return { field, bar };
}

function ChainBar({
  nativeID,
  last,
  onPress,
}: {
  nativeID: string;
  last: boolean;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  const { t } = useLocale();
  return (
    <InputAccessoryView nativeID={nativeID}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'flex-end',
          paddingHorizontal: space.l,
          paddingVertical: space.s,
          backgroundColor: colors.sub,
          borderTopWidth: 1,
          borderTopColor: colors.line,
        }}
      >
        <Pressable testID="field-chain.next" accessibilityRole="button" hitSlop={10} onPress={onPress}>
          <Text style={{ fontFamily: fonts.body800, fontSize: 15, color: colors.blue }}>
            {t(last ? 'common.done' : 'common.next')}
          </Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

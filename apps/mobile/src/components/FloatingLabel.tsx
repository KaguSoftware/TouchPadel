/**
 * A floating label for a `Field`: it rests inside the box where a placeholder
 * would, and glides up above it (shrinking, and cross-fading to the quiet label
 * colour) when the field is focused or holds anything, then back when it is
 * emptied and left. The room for the floated label opens above the box as it
 * rises (the box eases down, the form below with it) and closes again as it
 * settles, so there is no empty gap above a resting field.
 *
 * `FloatingLabel` wraps any field and takes `floated`; `FloatingField` is the
 * plain case: a `Field` that tracks its own focus and value. The label text is
 * the field's `placeholder`. Motion holds still under the OS "Reduce Motion".
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { useReduceMotion } from '../lib/useReduceMotion';
import { space, useTheme } from '../theme';
import { Field, LINE, type FieldProps } from './ui';

const LABEL_MS = 180;
/** Room above the box for the floated label. */
const LABEL_ROOM = 14;
/** The gap between the floated label and the box. */
const LABEL_GAP = 4;
const LABEL_SCALE = 0.9;
/** Field's box height (ui.tsx: 1 + 14 + LINE + 14 + 1). */
const BOX_H = 1 + 14 + LINE + 14 + 1;

export function FloatingLabel({
  label,
  floated,
  style,
  children,
}: {
  label: string;
  floated: boolean;
  /** Lands on the wrapper: the margin against the neighbour above. */
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { colors, fonts } = useTheme();
  const { dir } = useLocale();
  const reduceMotion = useReduceMotion();
  // ONE value drives both the label's lift and the room above the box. The room is a
  // layout value, so it must run on the JS thread; driving the lift from a separate
  // native-driver value let the two drift apart (and a LayoutAnimation elsewhere on the
  // screen could interrupt one of them), which left the label stuck half-way.
  const [lift] = useState(() => new Animated.Value(floated ? 1 : 0));
  const room = lift;
  useEffect(() => {
    lift.stopAnimation();
    if (reduceMotion) {
      lift.setValue(floated ? 1 : 0);
      return;
    }
    const target = floated ? 1 : 0;
    Animated.timing(lift, {
      toValue: target,
      duration: LABEL_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(({ finished }) => {
      // An interrupted run never leaves the label between its two resting places.
      if (!finished) return;
      lift.setValue(target);
    });
  }, [floated, reduceMotion, lift]);

  // Where the label rests (over the text's first line, the room still closed)
  // and how far up it goes, into the room that opens above the box.
  const restTop = space.sm + (BOX_H - LINE) / 2;
  // The label's centre ends LABEL_GAP above the box, whose top is then LABEL_ROOM + space.sm.
  const liftBy = LABEL_ROOM + space.sm - LABEL_GAP - (LINE * LABEL_SCALE) / 2 - LINE / 2 - restTop;
  const shiftBy = (dir === 'rtl' ? 1 : -1) * space.m;
  const text = { fontFamily: fonts.body700, fontSize: 15, lineHeight: LINE } as const;

  return (
    <Animated.View
      style={[
        style,
        { paddingTop: room.interpolate({ inputRange: [0, 1], outputRange: [0, LABEL_ROOM] }) },
      ]}
    >
      {children}
      {/* Two layers of one line, cross-faded as it rises. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: restTop,
          start: 2 + space.m,
          end: space.m,
          transform: [
            { translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, liftBy] }) },
            { translateX: lift.interpolate({ inputRange: [0, 1], outputRange: [0, shiftBy] }) },
            { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, LABEL_SCALE] }) },
          ],
          transformOrigin: dir === 'rtl' ? 'right center' : 'left center',
        }}
      >
        <Animated.View
          style={{ opacity: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}
        >
          <Text numberOfLines={1} style={[text, { color: colors.fnt2 }]}>
            {label}
          </Text>
        </Animated.View>
        <Animated.View style={{ position: 'absolute', top: 0, start: 0, end: 0, opacity: lift }}>
          <Text numberOfLines={1} style={[text, { color: colors.mut }]}>
            {label}
          </Text>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

/** A `Field` with a floating label (its `placeholder`); `style` is the wrapper's margin. */
export function FloatingField({
  placeholder,
  style,
  onFocus,
  onBlur,
  ...field
}: Omit<FieldProps, 'style' | 'label'> & { placeholder: string; style?: StyleProp<ViewStyle> }) {
  const [focused, setFocused] = useState(false);
  const floated = focused || String(field.value ?? '') !== '';
  return (
    <FloatingLabel label={placeholder} floated={floated} style={style}>
      <Field
        {...field}
        // Explicit, for the testID lint rule (it reads the JSX).
        testID={field.testID}
        accessibilityLabel={placeholder}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
      />
    </FloatingLabel>
  );
}

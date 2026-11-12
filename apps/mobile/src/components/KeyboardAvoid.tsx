/**
 * KeyboardAvoid — the app's one way to keep a pinned foot (a send bar, a
 * composer, a form's button) above the iOS keyboard. Use it instead of
 * React Native's KeyboardAvoidingView, which got two things wrong here
 * (Majed, 2026-11-12, on every screen with a bar):
 *
 * - It works from a `keyboardVerticalOffset` each page guessed (100, or
 *   56 + the status bar) for a header above it. The staff and coach bars are
 *   clear now (`clearBarOptions`): the page runs under them to the top of
 *   the window, so the guess pushed the bar 100+ pt above the keys. This
 *   measures the page in the window instead, so there is nothing to guess.
 * - Its 'keyboard' animation is linear on the New Architecture, so the page
 *   started slower than the keyboard. This animates on the keyboard's own
 *   duration and curve (`KEYBOARD_CURVE`).
 *
 * `footerPad` is the bottom padding the pinned bar keeps for the home
 * indicator; the keyboard covers it (all but `KEYBOARD_GAP`) instead of it
 * showing as a gap above the keys.
 *
 * Android resizes the window for the keyboard itself: a plain View there,
 * unless `androidBehavior` asks for React Native's view (FormScreen does).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  View,
  type StyleProp,
  type ViewInstance,
  type ViewStyle,
} from 'react-native';
import { KEYBOARD_CURVE, keyboardLift, keyboardTop } from './keyboardLift';

const EASING = Easing.bezier(...KEYBOARD_CURVE);

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** The pinned bar's own bottom padding (its safe-area room) while the keyboard is down. */
  footerPad?: number;
  androidBehavior?: 'height' | 'padding';
};

export function KeyboardAvoid({ children, style, footerPad = 0, androidBehavior }: Props) {
  if (Platform.OS === 'ios') {
    return (
      <IosKeyboardAvoid style={style} footerPad={footerPad}>
        {children}
      </IosKeyboardAvoid>
    );
  }
  if (androidBehavior) {
    return (
      <KeyboardAvoidingView style={[{ flex: 1 }, style]} behavior={androidBehavior}>
        {children}
      </KeyboardAvoidingView>
    );
  }
  return <View style={[{ flex: 1 }, style]}>{children}</View>;
}

function IosKeyboardAvoid({ children, style, footerPad }: Omit<Props, 'androidBehavior'> & { footerPad: number }) {
  const box = useRef<ViewInstance>(null);
  const [lift] = useState(() => new Animated.Value(0));
  const target = useRef(0);
  const pad = useRef(footerPad);
  useEffect(() => {
    pad.current = footerPad;
  }, [footerPad]);

  useEffect(() => {
    // `top` null: the keyboard is going away.
    const move = (top: number | null, duration: number) => {
      const node = box.current;
      if (!node) return;
      // The box's own frame: the padding below moves its content, not its edges.
      node.measureInWindow((_x, y, _w, h) => {
        const next = top === null ? 0 : keyboardLift({ viewBottom: y + h, keyboardTop: top, footerPad: pad.current });
        if (next === target.current) return;
        target.current = next;
        lift.stopAnimation();
        if (duration > 0) {
          Animated.timing(lift, { toValue: next, duration, easing: EASING, useNativeDriver: false }).start();
        } else {
          lift.setValue(next);
        }
      });
    };
    const top = (e: { screenY: number; height: number }) =>
      keyboardTop({ screenY: e.screenY, height: e.height, windowHeight: Dimensions.get('window').height });
    // willShow also fires when an open keyboard changes height (emoji, predictive row).
    const subs = [
      Keyboard.addListener('keyboardWillShow', (e) => move(top(e.endCoordinates), e.duration)),
      Keyboard.addListener('keyboardWillHide', (e) => move(null, e.duration)),
    ];
    // A page that opens with the keyboard already up (a field focused on the page before).
    const open = Keyboard.metrics();
    if (Keyboard.isVisible() && open) move(top(open), 0);
    return () => subs.forEach((s) => s.remove());
  }, [lift]);

  return (
    <Animated.View ref={box} style={[{ flex: 1 }, style, { paddingBottom: lift }]}>
      {children}
    </Animated.View>
  );
}

/** Whether the iOS keyboard is up (true from the moment it starts to rise). Android: always false. */
export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const subs = [
      Keyboard.addListener('keyboardWillShow', () => setShown(true)),
      Keyboard.addListener('keyboardWillHide', () => setShown(false)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);
  return shown;
}

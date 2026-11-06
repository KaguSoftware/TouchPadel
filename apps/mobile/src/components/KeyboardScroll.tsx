/**
 * KeyboardScroll — a ScrollView that keeps the focused field AND the button
 * under it above the keyboard.
 *
 * `automaticallyAdjustKeyboardInsets` (iOS) and the Android window resize
 * bring the focused INPUT clear of the keyboard, but the submit button that
 * follows it in the form stays underneath. A `Field` inside this scroll
 * reports its focus (`KeyboardScrollContext`), and after the system's own
 * scroll has settled this one scrolls a little further, only ever down, so
 * `REVEAL_BELOW` points of what comes after the field show as well. The
 * numbers are plain arithmetic in `keyboardReveal.ts` (vitest).
 *
 * A drop-in for `ScrollView`: same props, same `ref`. Not for horizontal
 * scrollers.
 */
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type Ref,
} from 'react';
import {
  Dimensions,
  Keyboard,
  Platform,
  ScrollView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  type ScrollViewInstance,
  type ViewInstance,
} from 'react-native';
import { revealOffset } from './keyboardReveal';

/** Room kept under a focused field: a 52 pt button and its gap. */
const REVEAL_BELOW = 88;
/** Lets the system's own scroll to the field finish before this one adds to it. */
const SETTLE_MS = 320;

export interface KeyboardScrollApi {
  reveal: (field: ViewInstance | null) => void;
}

export const KeyboardScrollContext = createContext<KeyboardScrollApi | null>(null);

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

export function KeyboardScroll({
  ref,
  children,
  onScroll,
  ...props
}: ScrollViewProps & { ref?: Ref<ScrollViewInstance>; children?: ReactNode }) {
  const scroll = useRef<ScrollViewInstance>(null);
  const offset = useRef(0);
  const keyboard = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        keyboard.current = Platform.OS === 'ios' ? e.endCoordinates.height : 0;
      },
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        keyboard.current = 0;
      },
    );
    return () => {
      show.remove();
      hide.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const reveal = useCallback((field: ViewInstance | null) => {
    if (!field) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const inner = scroll.current?.getInnerViewRef?.();
      const outer = scroll.current;
      if (!inner || !outer) return;
      // How much of THIS scroll the keyboard covers: none when the page was
      // already shortened above it (a pinned bar, Android's resize), all of
      // the keyboard when the scroll runs to the screen's foot.
      outer.measureInWindow((_wx, wy, _ww, wh) => {
        const keyboardTop = Dimensions.get('window').height - keyboard.current;
        const covered = Math.max(0, wy + wh - keyboardTop);
        field.measureLayout(
          inner as never,
          (_x, y, _w, h) => {
            const next = revealOffset({
              fieldBottom: y + h,
              below: REVEAL_BELOW,
              offset: offset.current,
              frame: wh,
              keyboard: covered,
            });
            if (next !== null) scroll.current?.scrollTo({ y: next, animated: true });
          },
          () => {},
        );
      });
    }, SETTLE_MS);
  }, []);

  const api = useMemo<KeyboardScrollApi>(() => ({ reveal }), [reveal]);

  return (
    <KeyboardScrollContext.Provider value={api}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        scrollEventThrottle={16}
        {...props}
        ref={(node) => {
          scroll.current = node;
          setRef(ref, node);
        }}
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
          offset.current = e.nativeEvent.contentOffset.y;
          onScroll?.(e);
        }}
      >
        {children}
      </ScrollView>
    </KeyboardScrollContext.Provider>
  );
}

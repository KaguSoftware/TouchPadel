/**
 * Section headers that stick a set distance below the list's top edge, not at
 * it: on the Join tab the night headers ("Tonight", "Tomorrow", "Thu 3 Oct")
 * stick under the pinned kind switch and chips, and the next night pushes the
 * one before it up and out from under them (owner, 2026-10-13).
 *
 * A `StickyHeaderComponent` for the list's ScrollView, the same contract as
 * React Native's own `ScrollViewStickyHeader` (it reports its layout to the
 * ScrollView, and takes the next header's place through `setNextHeaderY`),
 * with the stick point moved down by the offset from `StickyOffset`.
 */
import {
  Children,
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { Animated, type LayoutChangeEvent } from 'react-native';

/** How far below the list's top edge a header sticks. */
export const StickyOffset = createContext(0);

interface Props {
  children?: ReactNode;
  nextHeaderLayoutY?: number | null;
  onLayout: (event: LayoutChangeEvent) => void;
  scrollAnimatedValue: Animated.Value;
  nativeID?: string;
  ref?: Ref<{ setNextHeaderY: (y: number) => void }>;
}

type CellProps = { style?: unknown; onLayout?: (e: LayoutChangeEvent) => void };

export function StickyUnder({
  children,
  nextHeaderLayoutY,
  onLayout,
  scrollAnimatedValue,
  nativeID,
  ref,
}: Props) {
  const offset = useContext(StickyOffset);
  const [layout, setLayout] = useState<{ y: number; height: number } | null>(null);
  const [nextY, setNextY] = useState<number | null>(nextHeaderLayoutY ?? null);
  if (nextHeaderLayoutY != null && nextHeaderLayoutY !== nextY) setNextY(nextHeaderLayoutY);

  // The ScrollView hands each header the next one's place through its ref.
  const setRef = useCallback(
    (node: unknown) => {
      if (node && typeof node === 'object') {
        (node as { setNextHeaderY?: (y: number) => void }).setNextHeaderY = setNextY;
      }
      if (typeof ref === 'function') ref(node as never);
      else if (ref) (ref as { current: unknown }).current = node;
    },
    [ref],
  );

  const translateY = useMemo(() => {
    if (!layout) return 0;
    // Sticks once its top reaches `offset` below the list's top edge…
    const stick = layout.y - offset;
    // …and leaves with the next header as that one reaches its foot.
    const collide = nextY != null ? nextY - layout.height - offset : null;
    if (collide != null && collide >= stick) {
      return scrollAnimatedValue.interpolate({
        inputRange: [stick - 1, stick, collide, collide + 1],
        outputRange: [0, 0, collide - stick, collide - stick],
        extrapolate: 'clamp',
      });
    }
    return scrollAnimatedValue.interpolate({
      inputRange: [stick - 1, stick, stick + 1],
      outputRange: [0, 0, 1],
      extrapolateLeft: 'clamp',
      extrapolateRight: 'extend',
    });
  }, [layout, nextY, offset, scrollAnimatedValue]);

  const child = Children.only(children) as ReactElement<CellProps>;
  return (
    <Animated.View
      ref={setRef}
      collapsable={false}
      nativeID={nativeID}
      onLayout={(e) => {
        const { y, height } = e.nativeEvent.layout;
        setLayout({ y, height });
        onLayout(e);
        // The list's cell measures itself through this (scrollToLocation needs it).
        child.props.onLayout?.(e);
      }}
      style={[child.props.style as object, { zIndex: 10, transform: [{ translateY }] }]}
    >
      {cloneElement(child, { onLayout: undefined, style: { flex: 1 } })}
    </Animated.View>
  );
}

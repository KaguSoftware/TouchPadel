/**
 * Follow the bottom of a thread only while the owner is already at the bottom:
 * scrolling up during an answer must not be pulled back on the next token.
 */
import { useCallback, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollViewInstance } from 'react-native';

/** Within this many points of the end counts as "at the bottom". */
export const BOTTOM_SLACK = 48;

export function isNearBottom(
  m: { offsetY: number; viewHeight: number; contentHeight: number },
  slack: number = BOTTOM_SLACK,
): boolean {
  return m.contentHeight - (m.offsetY + m.viewHeight) <= slack;
}

export function useStickToBottom() {
  const ref = useRef<ScrollViewInstance>(null);
  const atBottom = useRef(true);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    atBottom.current = isNearBottom({
      offsetY: contentOffset.y,
      viewHeight: layoutMeasurement.height,
      contentHeight: contentSize.height,
    });
  }, []);
  // Not animated: an animated scroll reports positions short of the end on its way
  // and would read as the owner leaving the bottom.
  const onContentSizeChange = useCallback(() => {
    if (atBottom.current) ref.current?.scrollToEnd({ animated: false });
  }, []);
  /** A question was just asked: show it, and follow its answer. */
  const follow = useCallback(() => {
    atBottom.current = true;
    ref.current?.scrollToEnd({ animated: false });
  }, []);
  return { ref, onScroll, onContentSizeChange, follow };
}

/**
 * Follow the foot of a thread only while the reader is already there (the
 * phone's apps/mobile/src/features/assistant/stickToBottom.ts, 2026-11-12):
 * the thread used to be pulled to the bottom on every token, so the owner
 * could not scroll up to reread during a long answer. Scrolling up lets go;
 * scrolling back to the foot, or asking a question, follows again.
 */
import { useCallback, useRef } from 'react';

/** Within this many pixels of the end counts as "at the bottom". */
export const BOTTOM_SLACK = 48;

export function isNearBottom(m: { offsetY: number; viewHeight: number; contentHeight: number }, slack: number = BOTTOM_SLACK): boolean {
  return m.contentHeight - (m.offsetY + m.viewHeight) <= slack;
}

export function useStickToBottom<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const atBottom = useRef(true);
  /** The scroller's onScroll: remember whether the reader is at the foot. */
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (el) atBottom.current = isNearBottom({ offsetY: el.scrollTop, viewHeight: el.clientHeight, contentHeight: el.scrollHeight });
  }, []);
  /** Something new arrived: keep it in view, only if the reader was at the foot. */
  const stick = useCallback(() => {
    const el = ref.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, []);
  /** A question was just asked: show it and follow its answer. */
  const follow = useCallback(() => {
    atBottom.current = true;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  return { ref, onScroll, stick, follow };
}

/**
 * The zoom between a day's schedule and the month calendar.
 *
 * Not a literal zoom — the two levels are different components — but it moves
 * like one, so the change of level reads as a change of DISTANCE rather than a
 * change of screen:
 *
 *   * Out (day → month): the month arrives magnified around the square of the
 *     day you were on and settles back to size, as if the camera pulled away
 *     from that day until the rest of the month came into frame.
 *   * In (month → day): the day's schedule grows out of the square that was
 *     pressed.
 *
 * Only the ARRIVING level animates. The leaving one is already unmounted, and
 * animating both would mean holding two schedules in the DOM for the length of
 * the transition — on a desk station, for decoration.
 *
 * The Web Animations API rather than CSS classes, because the transform origin
 * is a measured point that differs on every press. A station that prefers
 * reduced motion gets a short cross-fade instead of the scale.
 */
import { useLayoutEffect, useRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react';

export type ZoomLevel = 'day' | 'month';

const DURATION_MS = 420;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** The centre of `cell`, as a transform-origin within `box`. */
function originWithin(box: HTMLElement, cell: HTMLElement): string {
  const b = box.getBoundingClientRect();
  const c = cell.getBoundingClientRect();
  if (b.width === 0 || b.height === 0) return '50% 50%';
  const x = c.left + c.width / 2 - b.left;
  const y = c.top + c.height / 2 - b.top;
  return `${x}px ${y}px`;
}

export function ZoomStage({
  level,
  focusDate,
  children,
  style,
}: {
  level: ZoomLevel;
  /** The day the month zooms out from: its square is the origin. */
  focusDate: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const shown = useRef(level);
  const pressedOrigin = useRef<string | null>(null);

  // Measured on the press, while the month is still on screen: by the time the
  // day level renders, the square it grew from is gone.
  function onClickCapture(e: MouseEvent<HTMLDivElement>) {
    const box = boxRef.current;
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-cal-date]');
    if (box && cell) pressedOrigin.current = originWithin(box, cell);
  }

  useLayoutEffect(() => {
    if (shown.current === level) return;
    shown.current = level;
    const box = boxRef.current;
    if (!box || typeof box.animate !== 'function') return;

    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      box.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear' });
      return;
    }

    let origin: string;
    let from: string;
    if (level === 'month') {
      const cell = box.querySelector<HTMLElement>(`[data-cal-date="${focusDate}"]`);
      origin = cell ? originWithin(box, cell) : '50% 50%';
      from = 'scale(2.6)';
    } else {
      origin = pressedOrigin.current ?? '50% 20%';
      from = 'scale(0.18)';
    }
    pressedOrigin.current = null;

    box.style.transformOrigin = origin;
    const anim = box.animate(
      [
        { transform: from, opacity: 0 },
        { opacity: 1, offset: 0.4 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      { duration: DURATION_MS, easing: EASE },
    );
    const reset = () => {
      box.style.transformOrigin = '';
    };
    anim.onfinish = reset;
    anim.oncancel = reset;
    return () => anim.cancel();
  }, [level, focusDate]);

  return (
    // The clip keeps a magnified month from spilling over the page header.
    <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', minBlockSize: 0, ...style }} onClickCapture={onClickCapture}>
      <div ref={boxRef} style={{ flex: 1, minBlockSize: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  );
}

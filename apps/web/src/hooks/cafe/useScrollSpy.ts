'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { scrollSpyPick, type SectionOffset } from './scrollSpy';

/**
 * Which category section owns the viewport, and the smooth jump the pills use.
 *
 * Measured from `offsetTop` rather than IntersectionObserver: a section can be
 * taller than the viewport (no intersection change for a whole screen of
 * scrolling) and the pills must still track it. A JUMP GUARD (800 ms) pins the
 * active id while a `scrollIntoView` animation runs, so the pill does not walk
 * through every category on the way down.
 */
const JUMP_GUARD_MS = 800;
/** Activation line: below the sticky pill rail. */
const ACTIVATION_OFFSET = 96;
const BOTTOM_EPSILON = 8;

export interface UseScrollSpy {
  activeId: string | null;
  jumpTo(id: string): void;
}

export function useScrollSpy(
  scrollRef: React.RefObject<HTMLElement | null>,
  ids: readonly string[],
  /** `id` → the section element (MenuStage registers them) */
  sectionId: (id: string) => string = (id) => `cat-${id}`,
): UseScrollSpy {
  const [activeId, setActiveId] = useState<string | null>(ids[0] ?? null);
  const guardUntil = useRef(0);
  const frame = useRef(0);

  useEffect(() => {
    setActiveId((prev) => (prev && ids.includes(prev) ? prev : (ids[0] ?? null)));
  }, [ids]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || ids.length === 0) return;

    const measure = (): SectionOffset[] =>
      ids
        .map((id) => {
          const el = document.getElementById(sectionId(id));
          if (!el) return null;
          const top = el.offsetTop;
          return { id, top, bottom: top + el.offsetHeight } satisfies SectionOffset;
        })
        .filter((s): s is SectionOffset => s !== null);

    const onScroll = () => {
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (Date.now() < guardUntil.current) return;
        const atBottom =
          scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - BOTTOM_EPSILON;
        const next = scrollSpyPick(measure(), {
          scrollTop: scroller.scrollTop,
          offset: ACTIVATION_OFFSET,
          atBottom,
        });
        setActiveId((prev) => (next === prev ? prev : next));
      });
    };

    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [scrollRef, ids, sectionId]);

  const jumpTo = useCallback(
    (id: string) => {
      guardUntil.current = Date.now() + JUMP_GUARD_MS;
      setActiveId(id);
      document
        .getElementById(sectionId(id))
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [sectionId],
  );

  return { activeId, jumpTo };
}

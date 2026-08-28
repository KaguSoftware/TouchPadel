'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { scrollSpyPick, type SectionOffset } from './scrollSpy';

/**
 * Which category section owns the viewport, and the smooth jump the pills use.
 *
 * Measured by hand rather than with an IntersectionObserver: a section can be
 * taller than the viewport (no intersection change for a whole screen of
 * scrolling) and the pills must still track it. A JUMP GUARD (800 ms) pins the
 * active id while the scroll animation runs, so the pill does not walk through
 * every category on the way down.
 *
 * THE TRIGGER IS THE CATEGORY HERO — the tinted band carrying the outlined
 * word and the line illustration, `[data-cat-hero]` in MenuStage — not the top
 * of the section. A category takes the rail the moment its hero reaches the top
 * of the reading area, i.e. sits under the sticky pill rail; until then the
 * previous category is still the one being read. A section with no band (an
 * operator category the design does not draw) falls back to its own top.
 *
 * `jumpTo` lands that same hero on that same line, so tapping a pill leaves the
 * spy agreeing with it: aligning the section top instead would park the hero
 * below the line and the rail would snap back to the previous category as soon
 * as the guard expired.
 */
const JUMP_GUARD_MS = 800;
/** Long enough for the smooth scroll AND the hero's 400 ms collapse to finish. */
const SETTLE_MS = 700;
/** Activation line: the bottom edge of the sticky pill rail (measured; this is the fallback). */
const RAIL_HEIGHT_FALLBACK = 52;
const BOTTOM_EPSILON = 8;

/** Live height of the sticky category rail — it is the top of the reading area. */
const railHeight = (): number =>
  document.querySelector<HTMLElement>('[data-cat-rail]')?.offsetHeight || RAIL_HEIGHT_FALLBACK;

/** A section's hero band, or the section itself when it does not carry one. */
const heroOf = (section: HTMLElement): HTMLElement =>
  section.querySelector<HTMLElement>('[data-cat-hero]') ?? section;

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
  const settle = useRef(0);

  useEffect(() => {
    setActiveId((prev) => (prev && ids.includes(prev) ? prev : (ids[0] ?? null)));
  }, [ids]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || ids.length === 0) return;

    /* Offsets are read off getBoundingClientRect against the scroller's own
       content origin: the hero band is nested inside the section, so offsetTop
       would be measured from whichever ancestor happens to be positioned. */
    const measure = (): SectionOffset[] => {
      const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
      return ids
        .map((id) => {
          const el = document.getElementById(sectionId(id));
          if (!el) return null;
          const box = el.getBoundingClientRect();
          const top = heroOf(el).getBoundingClientRect().top - origin;
          return { id, top, bottom: box.bottom - origin } satisfies SectionOffset;
        })
        .filter((s): s is SectionOffset => s !== null);
    };

    const onScroll = () => {
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (Date.now() < guardUntil.current) return;
        const atBottom =
          scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - BOTTOM_EPSILON;
        const next = scrollSpyPick(measure(), {
          scrollTop: scroller.scrollTop,
          offset: railHeight(),
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
      const scroller = scrollRef.current;
      const el = document.getElementById(sectionId(id));
      if (!scroller || !el) return;

      /** Where the scroller must sit for this hero to rest on the line. One
          pixel PAST it, so a fractional scrollTop cannot leave the hero a hair
          below the line and hand the rail back to the previous category. */
      const target = () => {
        const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
        return Math.max(0, heroOf(el).getBoundingClientRect().top - origin - railHeight() + 1);
      };

      scroller.scrollTo({ top: target(), behavior: 'smooth' });

      /* The first jump off the top of the page pulls the hero masthead out of
         the way, and its 400 ms collapse shortens the column ABOVE the target
         while the scroll is still flying — so the offset we just aimed at is
         not where the band ends up. Re-measure once everything has settled and
         close the gap. Later jumps (masthead already collapsed) measure equal
         and do nothing. */
      window.clearTimeout(settle.current);
      settle.current = window.setTimeout(() => {
        const top = target();
        if (Math.abs(top - scroller.scrollTop) <= 2) return;
        guardUntil.current = Date.now() + JUMP_GUARD_MS;
        scroller.scrollTo({ top, behavior: 'smooth' });
      }, SETTLE_MS);
    },
    [scrollRef, sectionId],
  );

  useEffect(() => () => window.clearTimeout(settle.current), []);

  return { activeId, jumpTo };
}

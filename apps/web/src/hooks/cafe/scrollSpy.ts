/**
 * Pure scroll-spy pick (unit-tested) — which category section owns the
 * viewport right now. Kept pure so the "last section wins at the bottom" and
 * "activation line, not the very top" rules are testable without a DOM.
 */

export interface SectionOffset {
  id: string;
  /** distance from the top of the scroll content to the section's start */
  top: number;
  /** distance to the section's end (top + height) */
  bottom: number;
}

export interface ScrollSpyInput {
  /** current scrollTop of the scroller */
  scrollTop: number;
  /** how far below the scroll edge the activation line sits (sticky pills height) */
  offset?: number;
  /** true when the scroller has reached its end — the last section must win */
  atBottom?: boolean;
}

/**
 * The active section id, or null when there are none.
 *
 * A section is active while the activation line (`scrollTop + offset`) sits
 * inside it; the LAST such section wins so an over-scrolled sticky header does
 * not stick to the previous category. Above the first section the first one is
 * active; at the very bottom the last one is, so short trailing categories can
 * still be reached.
 */
export function scrollSpyPick(
  sections: readonly SectionOffset[],
  { scrollTop, offset = 0, atBottom = false }: ScrollSpyInput,
): string | null {
  if (sections.length === 0) return null;
  if (atBottom) return sections[sections.length - 1]!.id;

  const line = scrollTop + offset;
  let active = sections[0]!.id;
  for (const s of sections) {
    if (s.top <= line) active = s.id;
    else break;
  }
  return active;
}

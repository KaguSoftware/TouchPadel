/**
 * Menu stage — one section per category, exactly as the design draws it:
 *
 *                  [بارد]      <- optional serve-temperature badge
 *   ┌──────────────────────┐
 *   │ قهوة            ☕   │  <- tinted band: the section heading, outlined, in
 *   └──────────────────────┘     the reading language + line illustration
 *   لاتيه            3000     <- rows: one price each, flush to the row's end
 *
 * The band tone is per section (`data-tone`): blue for the coffee/dairy half of
 * the menu, green for the fresh/healthy half.
 *
 * The illustration hangs off the band's trailing corner. In the Arabic design
 * that is the physical left, so it is pinned with inset-inline-END and the whole
 * composition mirrors cleanly in English.
 */
export const stageCss = `
.tp-menu-cat, .tp-stage { padding-block: 22px 6px; padding-inline: 24px; scroll-margin-block-start: 62px; }
.tp-stage:last-of-type { padding-block-end: 14px; }

.tp-stage__band { position: relative; overflow: hidden; display: flex; align-items: center; justify-content: space-between;
  gap: 14px; background: var(--tp-cafe-blue-tint); border-radius: 20px; padding-block: 20px; padding-inline: 18px;
  min-block-size: 96px; margin-block-start: 14px; }
.tp-stage__band[data-tone='green'] { background: var(--tp-cafe-green-tint); }
.tp-stage__word { font-family: var(--tp-font-display); font-weight: 800; font-size: 26px; line-height: 1.25; letter-spacing: 0.04em;
  color: transparent; -webkit-text-stroke: 1.3px var(--tp-accent); }
/* Arabic sections show the operator's Arabic name, so the band takes the
   Arabic face — and no caps tracking, which Arabic has no use for. */
[dir='rtl'] .tp-stage__word { font-family: var(--tp-font-arabic); font-weight: 900; letter-spacing: 0; }
.tp-stage__band[data-tone='green'] .tp-stage__word { -webkit-text-stroke-color: var(--tp-cafe-green); }
/* Long words step down so they never collide with the illustration. */
.tp-stage__word[data-len='long'] { font-size: 22px; }
.tp-stage__word[data-len='medium'] { font-size: 24px; }
/* Size, offsets and tilt come from the design per section (sectionArt.tsx sets
   them inline, including --tp-illo-rot); only the mirror lives here. */
.tp-stage__illo { position: absolute; rotate: var(--tp-illo-rot, -8deg); pointer-events: none; }
[dir='ltr'] .tp-stage__illo { rotate: calc(-1 * var(--tp-illo-rot, -8deg)); }

/* No size headers: every item is sold in one size, so each row carries a
   single price cell at its end and the rows start straight under the band. */
.tp-stage__rows { display: grid; gap: 3px; margin-block-start: 14px; }

.tp-menu-unavailable { text-align: center; padding-block: var(--tp-space-6); padding-inline: var(--tp-space-5); display: flex; flex-direction: column; align-items: center; gap: var(--tp-space-3); }
.tp-menu-unavailable h2 { font-family: var(--tp-font-arabic); font-weight: 800; font-size: var(--tp-fs-lg); }
.tp-menu-unavailable p { color: var(--tp-muted-fg); max-inline-size: 26rem; }
`;

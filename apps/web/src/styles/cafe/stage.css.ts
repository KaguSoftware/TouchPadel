/**
 * Menu stage — one section per category, exactly as the design draws it:
 *
 *   قهوة ~~~~~~  [بارد]      <- 900-weight blue heading, green rule, optional badge
 *   ┌──────────────────────┐
 *   │ COFFEE          ☕   │  <- tinted band: outlined Latin word + line illustration
 *   └──────────────────────┘
 *          MEDIUM   LARGE     <- size headers, in the SAME order as the price cells
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

.tp-stage__head { display: flex; align-items: flex-end; gap: 10px; }
.tp-stage__head h2 { font-family: var(--tp-font-arabic); font-weight: 900; font-size: 30px; line-height: 1; color: var(--tp-accent); }
[dir='ltr'] .tp-stage__head h2 { font-family: var(--tp-font-display); font-weight: 800; text-transform: uppercase; letter-spacing: var(--tp-tracking-caps); }
/* The hand-drawn green rule that underscores every heading. */
.tp-stage__rule { flex: none; block-size: 12px; margin-block-end: 4px; }
/* Placement only — the chip's colour comes from .tp-temp--hot / --cold. */
.tp-stage__badge { flex: none; margin-block-end: 4px; }

.tp-stage__band { position: relative; overflow: hidden; display: flex; align-items: center; justify-content: space-between;
  gap: 14px; background: var(--tp-cafe-blue-tint); border-radius: 20px; padding-block: 20px; padding-inline: 18px;
  min-block-size: 96px; margin-block-start: 14px; }
.tp-stage__band[data-tone='green'] { background: var(--tp-cafe-green-tint); }
.tp-stage__word { font-family: var(--tp-font-display); font-weight: 800; font-size: 26px; letter-spacing: 0.04em;
  color: transparent; -webkit-text-stroke: 1.3px var(--tp-accent); }
.tp-stage__band[data-tone='green'] .tp-stage__word { -webkit-text-stroke-color: var(--tp-cafe-green); }
/* Long words step down so they never collide with the illustration. */
.tp-stage__word[data-len='long'] { font-size: 22px; }
.tp-stage__word[data-len='medium'] { font-size: 24px; }
/* Size, offsets and tilt come from the design per section (sectionArt.tsx sets
   them inline, including --tp-illo-rot); only the mirror lives here. */
.tp-stage__illo { position: absolute; rotate: var(--tp-illo-rot, -8deg); pointer-events: none; }
[dir='ltr'] .tp-stage__illo { rotate: calc(-1 * var(--tp-illo-rot, -8deg)); }

/* Size headers. Emitted in the SAME DOM order as the price cells on each row,
   with no direction override, so header and column stay aligned in both
   reading directions (a fixed \`direction: ltr\` here would misalign in LTR). */
.tp-stage__cols { display: flex; gap: 8px; justify-content: flex-end; font-family: var(--tp-font-numeric);
  font-size: 13px; font-weight: 600; color: var(--tp-muted); margin-block: 14px 4px; margin-inline: 0; }
.tp-stage__cols span { inline-size: 52px; text-align: end; }
.tp-stage__rows { display: grid; gap: 3px; }

.tp-menu-unavailable { text-align: center; padding-block: var(--tp-space-6); padding-inline: var(--tp-space-5); display: flex; flex-direction: column; align-items: center; gap: var(--tp-space-3); }
.tp-menu-unavailable h2 { font-family: var(--tp-font-arabic); font-weight: 800; font-size: var(--tp-fs-lg); }
.tp-menu-unavailable p { color: var(--tp-muted-fg); max-inline-size: 26rem; }
`;

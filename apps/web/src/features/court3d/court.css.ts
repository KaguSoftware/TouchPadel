/**
 * Every rule the court needs: the stage (SVG fallback, live canvas, net-anchored
 * overlay) and the flat court's keyframes. Lane B's SiteStyles inlines this
 * string. Site rules: logical properties only, colours only through tokens,
 * z-index through --tp-site-z-*, and only transform / opacity animate.
 *
 * The keyframes are the design's own (`Touch Padel App.dc.html` tpball / tpshade
 * / tpp1–4, 6.6 s), generated from the same tables the app traced, so a number
 * lives in one place. Transforms on SVG children are in viewBox units.
 */

type Frame = readonly [pct: number, x: number, y: number, s: number, o?: number];

// Every leg: linear to the bounce, a soft ease into the landing, then a hold.
const LAND = 'cubic-bezier(.25,.62,.12,1)';
const LANDS = new Set([15, 40, 65, 90]);

const BALL: readonly Frame[] = [
  [0, 102.4, 92, 1],
  [9, 102.4, 208.6, 1.3],
  [15, 102.4, 278.6, 1.07],
  [21, 102.4, 304, 1],
  [25, 102.4, 304, 1],
  [34, 165.8, 187.4, 1.4],
  [40, 203.8, 117.4, 1.07],
  [46, 217.6, 92, 1],
  [50, 217.6, 92, 1],
  [59, 217.6, 208.6, 1.3],
  [65, 217.6, 278.6, 1.07],
  [71, 217.6, 304, 1],
  [75, 217.6, 304, 1],
  [84, 154.2, 187.4, 1.4],
  [90, 116.2, 117.4, 1.07],
  [96, 102.4, 92, 1],
  [100, 102.4, 92, 1],
];

/** The ground shadow: 7.1 units under the ball, shrinking and fading at the top of the arc. */
const SHADE_SCALE = [1, 0.58, 0.92, 1, 1, 0.58, 0.92, 1, 1, 0.58, 0.92, 1, 1, 0.58, 0.92, 1, 1];
const SHADE_OPACITY = [0.3, 0.12, 0.26, 0.3, 0.3, 0.12, 0.26, 0.3, 0.3, 0.12, 0.26, 0.3, 0.3, 0.12, 0.26, 0.3, 0.3];
const SHADE: readonly Frame[] = BALL.map(([pct, x, y], i) => [pct, x, y + 7.1, SHADE_SCALE[i]!, SHADE_OPACITY[i]!]);

/** Racket sway (tpp1..4): [pct, dx, dy]. */
const SWAY: readonly (readonly (readonly [number, number, number])[])[] = [
  [[0, 0, 0], [8, -3, -2], [46, 6, 10], [75, 2, 4], [92, -4, -1], [100, 0, 0]],
  [[0, 2, 2], [25, 6, -4], [46, -2, -1], [62, 4, -8], [100, 2, 2]],
  [[0, 0, 0], [21, -6, 9], [50, -2, 3], [71, -4, -2], [100, 0, 0]],
  [[0, -2, 0], [17, -8, -3], [25, -5, -1], [58, 3, 5], [100, -2, 0]],
];

const px = (n: number) => `${n}px`;

function flight(name: string, frames: readonly Frame[]): string {
  const body = frames
    .map(([pct, x, y, s, o]) => {
      const fn = pct === 100 ? '' : `animation-timing-function:${LANDS.has(pct) ? LAND : 'linear'};`;
      const op = o === undefined ? '' : `opacity:${o};`;
      return `  ${pct}% { transform: translate(${px(x)}, ${px(y)}) scale(${s}); ${op}${fn} }`;
    })
    .join('\n');
  return `@keyframes ${name} {\n${body}\n}`;
}

function sway(i: number): string {
  const body = SWAY[i]!.map(([pct, x, y]) => `  ${pct}% { transform: translate(${px(x)}, ${px(y)}); }`).join('\n');
  return `@keyframes tp-court-sway-${i + 1} {\n${body}\n}`;
}

const rest = (f: Frame) => `translate(${px(f[1])}, ${px(f[2])}) scale(${f[3]})`;

export const courtCss = `
/* ---- court3d: the stage ---- */
.tp-court-stage {
  position: relative;
  inline-size: 100%;
  block-size: 100%;
  isolation: isolate;
}
.tp-court-stage__visual {
  position: absolute;
  inset: 0;
}
.tp-court-stage__flat,
.tp-court-stage__gl {
  position: absolute;
  inset: 0;
}
/* The flat court drawn at the live court's footprint (84 % of the box height at
   rest), so the cross-fade reads as the same court turning real, not a jump. The
   illustration's own rule below (position: relative; block-size: 100%) comes later at
   the same specificity and would win: the insets would become a 6 % downward nudge and
   the net would sit below the CTA that is centred on the box. Both classes together
   out-rank it, so the flat court is absolutely placed, sized by its two insets, and its
   net (the viewBox's exact centre) lands on the box's centre, under the CTA. */
.tp-court-stage__flat { inset-block: 6%; }
.tp-court-stage__flat.tp-court-illustration { position: absolute; block-size: auto; }
.tp-court-stage__gl canvas {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  opacity: 0;
  transition: opacity var(--tp-site-dur-base) var(--tp-site-ease-out);
}
.tp-court-stage[data-court='live'] .tp-court-stage__gl canvas { opacity: 1; }
.tp-court-stage__flat { transition: opacity var(--tp-site-dur-base) var(--tp-site-ease-out); }
.tp-court-stage[data-court='live'] .tp-court-stage__flat { opacity: 0; }
/* Once the canvas owns the picture the flat court stops repainting. */
.tp-court-stage[data-court='live'] .tp-court-illustration * { animation-play-state: paused; }

/* Children ride the net tape: centred on the box (where the flat court's net is),
   then offset to the canvas's projected tape. Physical offsets on purpose: the
   canvas is a picture and is not mirrored in Arabic. */
.tp-court-stage__overlay {
  position: absolute;
  inset: 0;
  z-index: var(--tp-site-z-raised);
  display: grid;
  place-items: center;
  pointer-events: none;
}
.tp-court-stage__net {
  pointer-events: auto;
  transform: translate(var(--tp-court-net-dx, 0px), var(--tp-court-net-dy, 0px));
}
/* The one hand-off from the flat net to the projected one glides; after that the
   anchor follows the camera frame for frame. */
.tp-court-stage[data-net='settling'] .tp-court-stage__net {
  transition: transform var(--tp-site-dur-base) var(--tp-site-ease-out);
}

/* ---- court3d: the flat court ---- */
.tp-court-illustration {
  position: relative;
  inline-size: 100%;
  block-size: 100%;
}
.tp-court-illustration > svg {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
  overflow: visible;
}
.tp-court-illustration__turf {
  filter: drop-shadow(0 14px 20px var(--tp-site-court-cast)) drop-shadow(0 4px 7px var(--tp-site-court-cast-2));
}
.tp-court-illustration__ground { fill: var(--tp-site-court-turf); }
.tp-court-illustration__edge { stroke: var(--tp-site-court-turf-line); opacity: 0.45; }
.tp-court-illustration__line { stroke: var(--tp-site-court-line); }
.tp-court-illustration__tape { stroke: var(--tp-site-green); }
.tp-court-illustration__post { fill: var(--tp-site-court-line); }
.tp-court-illustration__face { fill: var(--tp-site-court-line); stroke: var(--tp-site-green); }
.tp-court-illustration__face--green { fill: var(--tp-site-green); stroke: var(--tp-site-court-racket-edge); }
.tp-court-illustration__dot { fill: var(--tp-site-green); opacity: 0.45; }
.tp-court-illustration__dot--green { fill: var(--tp-site-court-line); opacity: 0.7; }
.tp-court-illustration__grip { stroke: var(--tp-site-green); fill: none; }
.tp-court-illustration__racket { transform-box: fill-box; transform-origin: center; }
.tp-court-illustration__shadow { fill: var(--tp-site-court-shadow); opacity: 0.3; transform: ${rest(SHADE[0]!)}; }
.tp-court-illustration__halo { fill: var(--tp-site-court-ball); opacity: 0.28; transform: ${rest(BALL[0]!)}; }
.tp-court-illustration__ball {
  fill: var(--tp-site-court-ball);
  stroke: var(--tp-site-green);
  transform: ${rest(BALL[0]!)};
}

${flight('tp-court-ball', BALL)}
${flight('tp-court-shade', SHADE)}
${[0, 1, 2, 3].map(sway).join('\n')}

.tp-court-illustration__ball,
.tp-court-illustration__halo { animation: tp-court-ball 6.6s linear infinite; }
.tp-court-illustration__halo { animation-delay: -0.07s; }
.tp-court-illustration__shadow { animation: tp-court-shade 6.6s linear infinite; }
.tp-court-illustration__a1 { animation: tp-court-sway-1 6.6s ease-in-out infinite; }
.tp-court-illustration__a2 { animation: tp-court-sway-2 6.6s ease-in-out infinite; }
.tp-court-illustration__a3 { animation: tp-court-sway-3 6.6s ease-in-out infinite; }
.tp-court-illustration__a4 { animation: tp-court-sway-4 6.6s ease-in-out infinite; }

/* WCAG 2.2.2. Without JS nothing can pause the flat court, so it plays three quarters of
   its 6.6 s loop (4.95 s, under the five seconds that need no control) and holds that
   frame; once JS runs (data-js) it loops, and the stage's switch can stop it. */
.tp-court-stage:not([data-js]) .tp-court-illustration__ball,
.tp-court-stage:not([data-js]) .tp-court-illustration__halo,
.tp-court-stage:not([data-js]) .tp-court-illustration__shadow,
.tp-court-stage:not([data-js]) .tp-court-illustration__racket {
  animation-iteration-count: 0.75;
  animation-fill-mode: forwards;
}
.tp-court-stage[data-paused] .tp-court-illustration * { animation-play-state: paused; }

/* The pause switch: a 48px target at the stage's inline-end foot, a navy disc with a
   white glyph, solid (never glass). Hidden under reduced motion, where nothing moves. */
.tp-court-stage__pause {
  position: absolute;
  inset-block-end: 0;
  inset-inline-end: 0;
  z-index: var(--tp-site-z-raised);
  isolation: isolate;
  display: grid;
  place-items: center;
  inline-size: var(--tp-site-touch);
  block-size: var(--tp-site-touch);
  padding: 0;
  border: 0;
  border-radius: var(--tp-site-radius-pill);
  background: transparent;
  color: var(--tp-brand-white);
  cursor: pointer;
}
.tp-court-stage__pause::before {
  content: '';
  position: absolute;
  inset: 6px;
  z-index: var(--tp-site-z-below);
  border: 1.5px solid var(--tp-site-block-muted);
  border-radius: inherit;
  background: var(--tp-site-navy);
}
.tp-court-stage__pause svg { position: relative; inline-size: 0.875rem; block-size: 0.875rem; fill: currentColor; }

@media (prefers-reduced-motion: reduce) {
  .tp-court-stage__pause { display: none; }
  .tp-court-illustration__ball,
  .tp-court-illustration__halo,
  .tp-court-illustration__shadow,
  .tp-court-illustration__racket { animation: none; }
  .tp-court-stage__gl canvas,
  .tp-court-stage__flat,
  .tp-court-stage[data-net='settling'] .tp-court-stage__net { transition: none; }
}
`;

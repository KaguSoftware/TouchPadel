/**
 * The line drawing in the head of each workspace picker tile (Majed,
 * 2026-10-19: "make it actually reflect what it does in real life"). Each one
 * is the real thing that workspace runs at the club, drawn in the court-line
 * stroke so the set reads as one family:
 *
 *   management the whole venue from above: three courts, the shop, the cafe
 *   courtDesk  the booking board, one booking ticked as arrived
 *   cashier    a receipt, a card, a coin and a coffee on its saucer
 *   prep       order tickets hanging on the kitchen rail
 *   shop       the court's padel racket and a tube of balls
 *   team       the checklist handed to you, two done and two to go
 *
 * The drawing belongs to the workspace, not to its place in the grid, so the
 * kitchen looks like the kitchen for every role. It is drawn in a 300x160 box
 * and kept to the right of x=110, anchored to the inline end, so it never runs
 * under the workspace icon at the head's inline start. In Arabic the stylesheet
 * mirrors it (`.tp-ws-art`), which keeps it at the inline end there too.
 *
 * Decoration only: aria-hidden, no text, no colour of its own (the stroke is
 * set by `.tp-ws-art` in GlobalStyles).
 */
import type { WorkspaceKey } from '../lib/workspaces';

/** A rounded rectangle as a path. */
function rr(x: number, y: number, w: number, h: number, r: number): string {
  return (
    `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}` +
    `a${r} ${r} 0 0 1 -${r} ${r}h-${w - 2 * r}a${r} ${r} 0 0 1 -${r} -${r}` +
    `v-${h - 2 * r}a${r} ${r} 0 0 1 ${r} -${r}z`
  );
}

/** A circle as a path. */
function circ(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 -${2 * r} 0`;
}

function venue(): string {
  let d = 'M120 12H298V148H120ZM120 86H214M236 86H298';
  for (let i = 0; i < 3; i++) {
    const x = 132 + i * 34;
    d += `M${x} 22h26v54h-26zM${x} 49h26M${x} 35h26M${x} 63h26M${x + 13} 35V63`;
  }
  d += 'M236 22H288V76H236ZM242 36H282M242 50H282M242 64H282';
  for (const [x, y] of [[146, 108], [174, 108], [202, 108], [146, 132], [174, 132], [202, 132]] as const) d += circ(x, y, 6);
  return d + 'M232 100H288M232 100V138';
}

function bookingBoard(): string {
  let d = 'M126 14H296V150H126ZM126 32H296M168 14V150M211 14V150M253 14V150';
  // The art is stroked, not filled, so a row line stops at each booking it
  // passes under instead of running through it.
  d += 'M126 62H132M162 62H296M126 92H174M205 92H259M290 92H296M126 122H216M247 122H296';
  return (
    d + rr(132, 38, 30, 46, 4) + 'M139 61l5 5 9-10' + rr(174, 66, 31, 52, 4) +
    rr(216, 38, 31, 22, 4) + rr(216, 98, 31, 46, 4) + rr(259, 70, 31, 44, 4)
  );
}

function till(): string {
  let d = 'M130 10H196V140';
  for (let i = 0; i < 9; i++) d += 'l-3.667 6l-3.667 -6';
  d += 'V10M140 28H186M140 44H176M140 60H186M140 76H170M140 104H186M140 116H164';
  d += rr(212, 18, 62, 40, 5) + 'M212 30H274' + rr(220, 42, 12, 9, 2);
  d += 'M216 92H260V132a10 10 0 0 1 -10 10H226a10 10 0 0 1 -10 -10ZM260 100h6a9 9 0 0 1 0 18h-6M206 148H270';
  d += 'M230 84q-4 -6 0 -12t0 -12M246 84q-4 -6 0 -12t0 -12';
  return d + circ(287, 136, 9);
}

function ticketRail(): string {
  let d = 'M118 20H300M118 26H300';
  for (const [x, h] of [[130, 82], [186, 106], [242, 64]] as const) {
    d += `M${x} 26v${h}h46v-${h}M${x + 8} 42h30M${x + 8} 56h20M${x + 8} 70h26`;
    if (h > 80) d += `M${x + 8} 84h18`;
    if (h > 100) d += `M${x + 8} 98h28M${x + 8} 112h14`;
  }
  return d;
}

/**
 * The racket is the court's 3D one (features/floor/rally/racket.ts) seen face
 * on, traced from its model metres: the teardrop frame, the face opening, the
 * throat window, the 30 holes in rows of 4-5-6-6-5-4, the collar, the wrapped
 * grip and the butt cap. Model y runs up from the butt; 300 px a metre puts the
 * butt on the floor line and the crown near the top.
 */
function racket(): string {
  const s = 300;
  const p = (x: number, y: number) => `${+(196 + x * s).toFixed(1)} ${+(148 - y * s).toFixed(1)}`;
  const at = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return p(r * Math.cos(a), 0.32 + r * Math.sin(a));
  };
  const arc = (r: number) => `A${+(r * s).toFixed(1)} ${+(r * s).toFixed(1)} 0 1 0 `;
  // Frame: open at the neck, where the collar takes over.
  let d = `M${p(0.018, 0.125)}C${p(0.018, 0.165)} ${p(0.098, 0.205)} ${at(-20, 0.13)}` +
    `${arc(0.13)}${at(200, 0.13)}C${p(-0.098, 0.205)} ${p(-0.018, 0.165)} ${p(-0.018, 0.125)}`;
  // Face opening, the same teardrop the 3D frame cuts.
  d += `M${at(-25, 0.116)}${arc(0.116)}${at(205, 0.116)}` +
    `C${p(-0.0851, 0.226)} ${p(-0.05, 0.204)} ${p(0, 0.204)}C${p(0.05, 0.204)} ${p(0.0851, 0.226)} ${at(-25, 0.116)}Z`;
  d += `M${p(-0.046, 0.188)}L${p(0.046, 0.188)}Q${p(0.016, 0.168)} ${p(0, 0.156)}Q${p(-0.016, 0.168)} ${p(-0.046, 0.188)}Z`;
  [4, 5, 6, 6, 5, 4].forEach((n, i) => {
    const y = 148 - (0.32 + (i - 2.5) * 0.026) * s;
    for (let j = 0; j < n; j++) d += circ(196 + (j - (n - 1) / 2) * 0.03 * s, y, 1.9);
  });
  // Collar, grip with its wraps, butt cap.
  d += `M${p(-0.022, 0.125)}L${p(0.022, 0.125)}L${p(0.0195, 0.098)}L${p(-0.0195, 0.098)}Z`;
  d += `M${p(-0.0195, 0.098)}V${148 - 0.012 * s}M${p(0.0195, 0.098)}V${148 - 0.012 * s}`;
  for (const y of [0.028, 0.05, 0.072]) d += `M${p(-0.0195, y)}H${196 + 0.0195 * s}`;
  return d + `M${p(-0.021, 0.012)}H${196 + 0.021 * s}V148H${196 - 0.021 * s}Z`;
}

function shopWall(): string {
  return racket() + rr(250, 34, 30, 112, 7) + 'M250 50H280' + circ(265, 72, 11) + circ(265, 98, 11) + circ(265, 124, 11);
}

function checklist(): string {
  let d = rr(160, 16, 112, 136, 6) + rr(196, 8, 40, 16, 4);
  [40, 68, 96, 124].forEach((y, k) => {
    d += rr(174, y, 14, 14, 2) + `M198 ${y + 7}H${k % 2 ? 244 : 256}`;
    if (k < 2) d += `M177 ${y + 7}l3 3 6 -7`;
  });
  return d;
}

const ART: Record<WorkspaceKey, string> = {
  management: venue(),
  courtDesk: bookingBoard(),
  cashier: till(),
  prep: ticketRail(),
  shop: shopWall(),
  team: checklist(),
};

export function WorkspaceArt({ workspace }: { workspace: WorkspaceKey }) {
  return (
    <svg className="tp-ws-art" viewBox="0 0 300 160" preserveAspectRatio="xMaxYMid meet" aria-hidden="true" focusable="false">
      <path d={ART[workspace]} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

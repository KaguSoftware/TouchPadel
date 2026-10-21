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
 *   shop       a padel racket on its hook and a tube of balls
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
  d += 'M126 62H296M126 92H296M126 122H296';
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

function shopWall(): string {
  let d = 'M196 8V30M170 62a26 31 0 1 0 52 0a26 31 0 1 0 -52 0M186 91L191 108M206 91L201 108M191 108H201V148H191ZM191 120H201';
  const holes = [[186, 50], [196, 50], [206, 50], [181, 62], [191, 62], [201, 62], [211, 62], [186, 74], [196, 74], [206, 74]] as const;
  for (const [x, y] of holes) d += circ(x, y, 2.2);
  return d + rr(250, 34, 30, 112, 7) + 'M250 50H280' + circ(265, 72, 11) + circ(265, 98, 11) + circ(265, 124, 11);
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

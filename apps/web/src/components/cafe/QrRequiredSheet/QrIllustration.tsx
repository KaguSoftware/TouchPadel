/**
 * Hand-authored 21×21 "QR" illustration (UpperDeck QrIllustration): three
 * finder patterns plus deterministic noise. Purely decorative — it is not a
 * scannable code, and it never changes between server and client because the
 * noise comes from a fixed LCG, not Math.random.
 */

const SIZE = 21;
const FINDERS: readonly [number, number][] = [
  [0, 0],
  [SIZE - 7, 0],
  [0, SIZE - 7],
];

function inFinder(x: number, y: number): boolean {
  return FINDERS.some(([fx, fy]) => x >= fx - 1 && x <= fx + 7 && y >= fy - 1 && y <= fy + 7);
}

/** Deterministic modules: a tiny LCG, so SSR and hydration agree. */
function noiseModules(): [number, number][] {
  const out: [number, number][] = [];
  let seed = 0x2f6e2b1;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      if (inFinder(x, y)) continue;
      if ((seed >> 16) % 100 < 42) out.push([x, y]);
    }
  }
  return out;
}

const MODULES = noiseModules();

export function QrIllustration({ className = 'tp-qr-art' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
    >
      {FINDERS.map(([fx, fy]) => (
        <g key={`${fx}-${fy}`}>
          <rect x={fx} y={fy} width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
          <rect x={fx + 2} y={fy + 2} width="3" height="3" fill="currentColor" />
        </g>
      ))}
      {MODULES.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" />
      ))}
    </svg>
  );
}

/**
 * The masthead sweep from the approved menu design: three 38 px brand strokes
 * — green, sky, blue — rolling across the panel, with four outlined squares and
 * three dots riding the curve.
 *
 * Transcribed from the design file (brand/Touch Cafe Menu Final) with its
 * literal colours swapped for tokens. The whole group is drawn rotated 180°
 * about the panel centre, exactly as the design does, so the strokes enter from
 * the trailing edge and leave through the top.
 */
export function HeroArt() {
  return (
    <svg
      className="tp-hero__art"
      viewBox="0 0 400 320"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="rotate(180 200 160)">
        <path
          d="M 44 372 C 160 250 50 240 100 190 C 160 135 30 130 110 70 C 220 5 330 150 460 10"
          stroke="var(--tp-cafe-green-light)"
          strokeWidth="38"
          strokeLinecap="round"
        />
        <path
          d="M 29 357 C 145 235 35 225 85 175 C 145 120 15 115 95 55 C 205 -10 315 135 445 -5"
          stroke="var(--tp-cafe-sky)"
          strokeWidth="38"
          strokeLinecap="round"
        />
        <path
          d="M 14 342 C 130 220 20 210 70 160 C 130 105 0 100 80 40 C 190 -25 300 120 430 -20"
          stroke="var(--tp-accent)"
          strokeWidth="38"
          strokeLinecap="round"
        />
        <rect
          x="70"
          y="236"
          width="18"
          height="18"
          rx="5"
          stroke="var(--tp-cafe-green)"
          strokeWidth="3"
          fill="var(--tp-bg)"
          transform="rotate(-14 79 245)"
        />
        <rect
          x="196"
          y="146"
          width="16"
          height="16"
          rx="4"
          stroke="var(--tp-cafe-green)"
          strokeWidth="3"
          fill="var(--tp-bg)"
          transform="rotate(16 204 154)"
        />
        <rect
          x="118"
          y="112"
          width="17"
          height="17"
          rx="4"
          stroke="var(--tp-cafe-green)"
          strokeWidth="3"
          fill="var(--tp-bg)"
          transform="rotate(-10 126 120)"
        />
        <rect
          x="248"
          y="42"
          width="16"
          height="16"
          rx="4"
          stroke="var(--tp-cafe-green)"
          strokeWidth="3"
          fill="var(--tp-bg)"
          transform="rotate(20 256 50)"
        />
        <circle cx="92" cy="180" r="3" fill="var(--tp-cafe-green-light)" />
        <circle cx="176" cy="58" r="3" fill="var(--tp-cafe-green-light)" />
      </g>
    </svg>
  );
}

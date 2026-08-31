import { useId } from 'react';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Section furniture from the approved menu design: for every category, the
 * outlined Latin word that fills the tinted band, the band's tone, and the
 * hand-drawn line illustration that hangs off its trailing corner.
 *
 * Keyed by `name_en` — the operator can rename a category and the section
 * simply falls back to its own uppercased name on a blue band, which is a
 * correct-looking section rather than a hole.
 *
 * The artwork is transcribed from the design file
 * (apps/web/public/brand/Touch Cafe Menu Final (standalone).html) with its
 * literal colours swapped for the brand tokens, so a palette change moves the
 * illustrations with everything else. Every icon is drawn in a 64x64 box and
 * inherits the band's stroke weight from `SectionIllustration` below.
 */
export interface SectionArt {
  /** the outlined word, e.g. COFFEE */
  word: string;
  /** band tint */
  tone: 'blue' | 'green';
  /** word length bucket -> font size step (stage.css.ts) */
  len: 'short' | 'medium' | 'long';
  /**
   * Per-section placement, straight off the design: the illustration is a
   * different size and sits at a different tilt in every band. `end` is the
   * design's physical `left` — the trailing side in Arabic — so it is applied
   * as inset-inline-end and mirrors with the rest of the layout.
   */
  illo: { size: number; end: number; bottom: number; rot: number };
  art: ReactNode;
}

/**
 * Coffee is the one illustration that needs `url(#...)` references — a mask
 * cutting the iced glass to the hot cup's silhouette, and a clip holding the
 * liquid inside the glass. The same `art` node renders twice on a page (the
 * band illustration and the row thumbnail), so hardcoded ids would collide and
 * every reference would resolve to whichever copy came first. Hence a
 * component: `useId` gives each instance its own pair.
 */
function CoffeeArt() {
  const uid = useId();
  const cupCut = `tp-coffee-cut-${uid}`;
  const glassIn = `tp-coffee-glass-${uid}`;
  return (
    <>
      <defs>
        <mask id={cupCut} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect x="0" y="0" width="64" height="64" fill="#FFFFFF" />
          <g stroke="#000000" fill="none" strokeLinejoin="round" strokeLinecap="round">
            <path d="M 20.5 42.2 C 11.5 46 14.1 53.8 32 53.8 C 49.9 53.8 52.5 46 43.5 42.2" strokeWidth="5" />
            <path d="M 16.6 24.3 V 32 A 15.4 15.4 0 0 0 47.4 32 V 24.3 Z" fill="#000000" strokeWidth="6.2" />
            <ellipse cx="32" cy="24.3" rx="15.4" ry="5.1" fill="#000000" strokeWidth="6.2" />
          </g>
        </mask>
        <clipPath id={glassIn}>
          <path d="M 4.4 13.4 H 18.8 L 16.2 48.6 H 7 Z" />
        </clipPath>
      </defs>

      {/* iced coffee, behind — masked to the hot cup's silhouette */}
      <g stroke="var(--tp-accent)" strokeLinejoin="round" mask={`url(#${cupCut})`}>
        <path d="M 15.6 12 L 11.6 2.6" strokeWidth="2.8" strokeLinecap="round" />
        <path d="M 3 12 H 20.2 L 17.3 50 H 5.9 Z" fill="var(--tp-bg)" strokeWidth="2.8" />
        <g clipPath={`url(#${glassIn})`}>
          <path
            d="M 3.65 20.5 c 2.65 -2.2 5.3 -2.2 7.95 0 s 5.3 2.2 7.95 0 L 17.3 50 H 5.9 Z"
            fill="var(--tp-cafe-green)"
            fillOpacity=".22"
            stroke="none"
          />
          <path
            d="M 3.65 20.5 c 2.65 -2.2 5.3 -2.2 7.95 0 s 5.3 2.2 7.95 0"
            stroke="var(--tp-cafe-green)"
            strokeWidth="2.2"
          />
        </g>
        <rect x="7.4" y="24.2" width="6.6" height="6.6" rx="1.3" strokeWidth="1.6" opacity=".55" />
        <rect x="8.6" y="36.2" width="7" height="7" rx="1.4" strokeWidth="1.6" opacity=".55" />
      </g>

      {/* hot coffee */}
      <g stroke="var(--tp-cafe-green)" strokeLinecap="round">
        <path d="M 25 14.7 C 22.4 11.5 27.5 10.2 25.6 7" strokeWidth="2.9" />
        <path d="M 32 14 C 29.4 10.2 35.2 9 32.6 5.1" strokeWidth="3.2" />
        <path d="M 39 14.7 C 36.4 11.5 41.5 10.2 39.6 7" strokeWidth="2.9" />
      </g>
      <path d="M 20.5 42.2 C 11.5 46 14.1 53.8 32 53.8 C 49.9 53.8 52.5 46 43.5 42.2" strokeWidth="2.6" />
      <path d="M 23.7 43.5 C 19.8 46 22.4 49.9 32 49.9 C 41.6 49.9 44.2 46 40.3 43.5" strokeWidth="1.9" opacity=".45" />
      <path d="M 47.4 28.2 H 49.9 A 6.4 6.4 0 0 1 49.9 41 H 47.4" strokeWidth="3.8" />
      <path d="M 16.6 24.3 V 32 A 15.4 15.4 0 0 0 47.4 32 V 24.3 Z" fill="var(--tp-bg)" strokeWidth="3.8" />
      <ellipse cx="32" cy="24.3" rx="15.4" ry="5.1" fill="var(--tp-bg)" strokeWidth="3.8" />
      <ellipse cx="32" cy="24.3" rx="10.9" ry="3.2" fill="var(--tp-cafe-blue-tint)" stroke="none" />
    </>
  );
}

export const SECTION_ART: Record<string, SectionArt> = {
  "Coffee": {
    word: 'COFFEE',
    tone: 'blue',
    len: 'short',
    illo: { size: 108, end: -14, bottom: -14, rot: -10 },
    art: <CoffeeArt />,
  },
  "Smoothie": {
    word: 'SMOOTHIE',
    tone: 'green',
    len: 'medium',
    illo: { size: 104, end: -12, bottom: -12, rot: 8 },
    art: (
      <>
        <g transform="scale(0.6667)" strokeWidth="4.5">
          <path
            d="M30.4 54c4.4-3.6 8.8-3.6 13.2 0s8.8 3.6 13.2 0c2.9-1.2 5.9-1.4 8.8 0.2L63.1 84a5 5 0 0 1-5 4.6H38.4a5 5 0 0 1-5-4.6L30.4 54z"
            fill="var(--tp-cafe-green)"
            fillOpacity="0.38"
            stroke="none"
          />
          <path d="M30.4 54c4.4-3.6 8.8-3.6 13.2 0s8.8 3.6 13.2 0c2.9-1.2 5.9-1.4 8.8 0.2" stroke="var(--tp-cafe-green)" />
          <g transform="rotate(-45 48 75)" stroke="var(--tp-cafe-green)">
            <path d="M46 65 A10 10 0 0 0 46 85 Z" fill="var(--tp-cafe-green-tint)" strokeWidth="2.6" />
            <path d="M46 67.2 A7.8 7.8 0 0 0 46 82.8" strokeWidth="1.5" />
            <path d="M46 75 H38.7 M46 75 L40.8 69.8 M46 75 L40.8 80.2" strokeWidth="1.5" />
            <path d="M50 65 A10 10 0 0 1 50 85 Z" fill="var(--tp-cafe-green-tint)" strokeWidth="2.6" />
            <path d="M50 67.2 A7.8 7.8 0 0 1 50 82.8" strokeWidth="1.5" />
            <path d="M50 75 H57.3 M50 75 L55.2 69.8 M50 75 L55.2 80.2" strokeWidth="1.5" />
          </g>
          <path d="M22 36a26 19 0 0 1 52 0" fill="var(--tp-cafe-blue-tint)" />
          <path d="M48 50V5" />
          <path d="M22 36h52" />
          <path d="M26.5 36h43l-4.2 48.5a7 7 0 0 1-7 6.5H37.7a7 7 0 0 1-7-6.5z" />
        </g>
      </>
    ),
  },
  "Tea": {
    word: 'TEA',
    tone: 'blue',
    len: 'short',
    illo: { size: 106, end: -12, bottom: -14, rot: -8 },
    art: (
      <>
        <g transform="translate(3.43 0) scale(0.5714) translate(0 14)">
          <g stroke="var(--tp-cafe-green)" strokeLinecap="round" transform="translate(0 -15) scale(1 0.86) translate(0 2)">
            <path d="M39 23c-4-5 4-7 1-12" strokeWidth="4.5" />
            <path d="M50 22c-4-6 5-8 1-14" strokeWidth="5" />
            <path d="M61 23c-4-5 4-7 1-12" strokeWidth="4.5" />
          </g>
          <path d="M24 79C25.5 87.5 35.5 92 50 92C64.5 92 74.5 87.5 76 79" fill="var(--tp-cafe-blue-tint)" strokeWidth="5" strokeLinecap="round" />
          <ellipse cx="50" cy="79" rx="26" ry="8" fill="var(--tp-cafe-blue-tint)" strokeWidth="5" />
          <ellipse cx="50" cy="79" rx="17" ry="4.6" fill="var(--tp-accent)" fillOpacity=".2" stroke="none" />
          <path
            d="M31 22C31.5 30 36.5 32.5 36.5 39.5C36.5 48 32 53 32 61C32 69.5 37.5 74 41.5 77.5H58.5C62.5 74 68 69.5 68 61C68 53 63.5 48 63.5 39.5C63.5 32.5 68.5 30 69 22Z"
            fill="var(--tp-cafe-blue-tint)"
            stroke="none"
          />
          <path
            d="M31 22C31.5 30 36.5 32.5 36.5 39.5C36.5 48 32 53 32 61C32 69.5 37.5 74 41.5 77.5H58.5C62.5 74 68 69.5 68 61C68 53 63.5 48 63.5 39.5C63.5 32.5 68.5 30 69 22"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <ellipse cx="50" cy="22" rx="19" ry="6.5" fill="var(--tp-cafe-blue-tint)" strokeWidth="6" />
          <ellipse cx="50" cy="22" rx="13" ry="4" fill="var(--tp-accent)" fillOpacity=".2" stroke="none" />
        </g>
      </>
    ),
  },
  "Fresh Juice": {
    word: 'JUICE',
    tone: 'green',
    len: 'short',
    illo: { size: 104, end: -12, bottom: -12, rot: 8 },
    art: (
      <>
        <g transform="scale(0.6667)" strokeWidth="4.5">
          <path d="M49 36a11 11 0 0 1 22 0z" fill="var(--tp-cafe-green)" stroke="none" />
          <path d="M60 34.5V27M53.5 32 60 34.5M66.5 32 60 34.5" stroke="var(--tp-bg)" strokeWidth="2.4" />
          <path d="M38 35c-7.4 0-10.6-3.6-10.6-9.2 6.6-1.2 10.6 2.6 10.6 9.2z" fill="var(--tp-cafe-green)" stroke="none" />
          <path
            d="M30.4 54c4.4-3.6 8.8-3.6 13.2 0s8.8 3.6 13.2 0c2.9-1.2 5.9-1.4 8.8 0.2L63.1 84a5 5 0 0 1-5 4.6H38.4a5 5 0 0 1-5-4.6L30.4 54z"
            fill="var(--tp-cafe-green)"
            fillOpacity="0.38"
            stroke="none"
          />
          <path d="M30.4 54c4.4-3.6 8.8-3.6 13.2 0s8.8 3.6 13.2 0c2.9-1.2 5.9-1.4 8.8 0.2" stroke="var(--tp-cafe-green)" />
          <path d="M47 50.2L40.6 21l8.4-7" />
          <path d="M22 36h52" />
          <path d="M26.5 36h43l-4.2 48.5a7 7 0 0 1-7 6.5H37.7a7 7 0 0 1-7-6.5z" />
        </g>
      </>
    ),
  },
  "Frappuccino": {
    word: 'FRAPPUCCINO',
    tone: 'blue',
    len: 'long',
    illo: { size: 104, end: -12, bottom: -12, rot: -8 },
    art: (
      <>
        <path d="M 22 28 L 26 56 L 38 56 L 42 28" fill="var(--tp-bg)" />
        <path d="M 28 34 L 29.5 51 M 36 34 L 34.5 51" strokeWidth="1.3" opacity=".45" />
        <path d="M 20 28 L 44 28" />
        <path d="M 23 28 C 21 22 27 20 28.5 22.5 C 28 16 36 16 35.5 22 C 38.5 20 43 23 41 28 Z" fill="var(--tp-cafe-blue-tint)" />
        <path d="M 35.5 22 L 40 10 L 47 7" strokeWidth="3.2" />
        <circle cx="32" cy="16" r="2.4" fill="var(--tp-cafe-green-light)" stroke="none" />
      </>
    ),
  },
  "Cocktail": {
    word: 'COCKTAIL',
    tone: 'green',
    len: 'medium',
    illo: { size: 106, end: -12, bottom: -14, rot: 8 },
    art: (
      <>
        <path d="M 22.5 54.4 C 26 53.5 29.5 51.6 32 49 C 34.5 51.6 38 53.5 41.5 54.4 A 9.5 2.4 0 0 1 22.5 54.4 Z" fill="var(--tp-bg)" />
        <path d="M 32 33 L 32 49.4" />
        <path d="M 17 16 L 32 33 L 47 16 Z" fill="var(--tp-bg)" />
        {/* liquid: inset to the bowl's interior so it needs no clipPath — a
            document-unique id is impossible here, since the same node renders
            in both the band illustration and the row thumbnail. */}
        <path
          d="M 21 20 C 23.31 18.1 24.19 18.1 26.5 20 C 28.81 21.9 29.69 21.9 32 20 C 34.31 18.1 35.19 18.1 37.5 20 C 39.81 21.9 40.69 21.9 43 20 L 32 33 Z"
          fill="var(--tp-cafe-green)"
          fillOpacity=".38"
          stroke="none"
        />
        <path
          d="M 21 20 C 23.31 18.1 24.19 18.1 26.5 20 C 28.81 21.9 29.69 21.9 32 20 C 34.31 18.1 35.19 18.1 37.5 20 C 39.81 21.9 40.69 21.9 43 20"
          stroke="var(--tp-cafe-green)"
          strokeWidth="1.8"
        />
        <path d="M 17 16 L 32 33 L 47 16 Z" />
        <path d="M 15 16 L 49 16" />
        <path d="M 31 24 L 23.5 4" />
        <g transform="rotate(-20.6 26.1 11)">
          <ellipse cx="26.1" cy="11" rx="2.4" ry="3.1" fill="var(--tp-cafe-green)" stroke="var(--tp-cafe-green)" strokeWidth="1.8" />
          <ellipse cx="26.1" cy="8.7" rx="1.15" ry="0.8" fill="var(--tp-cafe-green-tint)" stroke="none" />
          <path d="M 24.3 10 C 24.1 11.5 24.5 12.6 25.3 13.3" stroke="var(--tp-cafe-green-light)" strokeWidth="1" />
        </g>
        <g transform="rotate(45 46 16)" stroke="var(--tp-cafe-green)">
          <path d="M 39 16 A 7 7 0 0 1 53 16 Z" fill="var(--tp-bg)" strokeWidth="2" />
          <path d="M 40.4 16 A 5.6 5.6 0 0 1 51.6 16 Z" fill="var(--tp-cafe-green)" fillOpacity=".3" strokeWidth="1.3" />
          <path d="M 46.89 15.35 L 50.53 12.71 M 46.34 14.95 L 47.73 10.67 M 45.66 14.95 L 44.27 10.67 M 45.11 15.35 L 41.47 12.71" strokeWidth="1.1" />
          <path d="M 44.9 16 A 1.1 1.1 0 0 1 47.1 16" strokeWidth="1.1" />
        </g>
      </>
    ),
  },
  "Milkshake": {
    word: 'MILKSHAKE',
    tone: 'blue',
    len: 'long',
    illo: { size: 102, end: -10, bottom: -10, rot: -8 },
    art: (
      <>
        <path
          d="M 20 20 C 21 31 25.6 39 26.4 45 C 26.7 47.2 27.9 48.2 30 48.2 L 34 48.2 C 36.1 48.2 37.3 47.2 37.6 45 C 38.4 39 43 31 44 20"
          fill="var(--tp-bg)"
        />
        <path d="M 29.4 48.2 C 30.2 51.5 29.8 54 29.2 56.4" />
        <path d="M 34.6 48.2 C 33.8 51.5 34.2 54 34.8 56.4" />
        <ellipse cx="32" cy="57.4" rx="9" ry="2.4" fill="var(--tp-bg)" />
        <path d="M 28.4 27 C 28.7 33.7 30.2 38.5 30.35 44" stroke="var(--tp-cafe-sky)" strokeWidth="1.8" />
        <path d="M 35.6 27 C 35.3 33.7 33.8 38.5 33.65 44" stroke="var(--tp-cafe-sky)" strokeWidth="1.8" />
        <path d="M 36 16 L 43 5 L 49.5 3" />
        <path d="M 20 20 C 18 13 25 11 27 14 C 27 7 37 7 37 14 C 39 11 46 13 44 20 Z" fill="var(--tp-bg)" />
        <circle cx="32" cy="6" r="2.6" fill="var(--tp-cafe-green-light)" stroke="none" />
      </>
    ),
  },
  "Milk Drinks": {
    word: 'MILK',
    tone: 'green',
    len: 'short',
    illo: { size: 104, end: -12, bottom: -12, rot: 8 },
    art: (
      <>
        <path
          d="M 20.6 28.5 L 24.6 54 C 24.8 55.3 25.6 56 27 56 L 37 56 C 38.4 56 39.2 55.3 39.4 54 L 43.4 28.5 Z"
          fill="var(--tp-cafe-blue-tint)"
          stroke="none"
        />
        <path d="M 20 28.5 L 24.6 54 C 24.8 55.3 25.6 56 27 56 L 37 56 C 38.4 56 39.2 55.3 39.4 54 L 44 28.5" />
        <path d="M 17 22.5 C 17 21.4 17.9 21 19 21 L 45 21 C 46.1 21 47 21.4 47 22.5 L 47 27 C 47 28.1 46.1 28.5 45 28.5 L 19 28.5 C 17.9 28.5 17 28.1 17 27 Z" fill="var(--tp-bg)" />
        <path
          d="M 20.5 21 L 20.5 17.6 C 20.5 15.8 21.8 14.8 24 14.8 L 26.8 14.8 C 26.8 12.6 28.2 11.8 30.4 11.8 C 32.6 11.8 34 12.6 34 14.8 L 40 14.8 C 42.2 14.8 43.5 15.8 43.5 17.6 L 43.5 21 Z"
          fill="var(--tp-bg)"
          stroke="none"
        />
        <path d="M 28.4 13.6 L 32.4 13.6" stroke="var(--tp-cafe-green)" strokeWidth="1.8" />
        <path d="M 20.5 21 L 20.5 17.6 C 20.5 15.8 21.8 14.8 24 14.8 L 26.8 14.8 C 26.8 12.6 28.2 11.8 30.4 11.8 C 32.6 11.8 34 12.6 34 14.8 L 40 14.8 C 42.2 14.8 43.5 15.8 43.5 17.6 L 43.5 21 Z" />
        <path d="M 19.5 24.8 L 44.5 24.8" stroke="var(--tp-cafe-green)" strokeWidth="2" />
      </>
    ),
  },
  "Desserts": {
    word: 'DESSERTS',
    tone: 'blue',
    len: 'medium',
    illo: { size: 100, end: -12, bottom: -4, rot: 8 },
    art: (
      <>
        <g transform="scale(0.6667)" strokeWidth="4.6">
          {/* cream */}
          <path d="M21 60 C17 51 23 44 30 43 C26 37 30 31 37 30 C34 25 39 19 44 18 C46 13 50 13 52 18 C57 19 62 25 59 30 C66 31 70 37 66 43 C73 44 79 51 75 60 Z" />
          {/* cherry */}
          <circle cx="48" cy="8" r="4.6" fill="var(--tp-cafe-green)" stroke="none" />
          {/* sprinkles */}
          <g stroke="var(--tp-cafe-green)" strokeWidth="4.2">
            <path d="M36.6 51.6 L41.4 54.4" />
            <path d="M58.6 55.3 L55.4 50.7" />
            <path d="M39.3 39.9 L44.7 38.1" />
            <path d="M55.4 37.2 L56.6 40.8" />
            <path d="M46.4 24.8 L51.6 29.2" />
          </g>
          {/* container: opaque mask, green ribs, then the blue outline on top */}
          <path d="M22 60 L29 84 Q30 88 35 88 H61 Q66 88 67 84 L74 60 Z" fill="var(--tp-bg)" stroke="none" />
          <g stroke="var(--tp-cafe-green)">
            <path d="M27 68 H69" />
            <path d="M29.5 76 H66.5" />
            <path d="M32 84 H64" />
          </g>
          <path d="M22 60 L29 84 Q30 88 35 88 H61 Q66 88 67 84 L74 60 Z" />
        </g>
      </>
    ),
  },
  "Signature": {
    word: 'SIGNATURE',
    tone: 'green',
    len: 'long',
    illo: { size: 104, end: -12, bottom: -12, rot: -8 },
    art: (
      <>
        {/* pot handle */}
        <path d="M 44 43.4 C 49.2 44.2 51.2 47.8 50.2 51.2 C 49.4 54 47.4 55.6 44.9 55.2" strokeWidth="2" />
        <path d="M 20.6 41 L 18.9 53.5 C 18.9 58 21.5 61 25.5 61 L 38.5 61 C 42.5 61 45.1 58 45.1 53.5 L 43.4 41 Z" fill="var(--tp-bg)" />
        <path
          d="M 19.7 49.3 C 23.7 46.7 28 46.7 32 49.3 C 36 51.9 40.3 51.9 44.3 49.3 L 45.1 53.5 C 45.1 58 42.5 61 38.5 61 L 25.5 61 C 21.5 61 18.9 58 18.9 53.5 Z"
          fill="var(--tp-cafe-green-tint)"
          stroke="none"
        />
        <path
          d="M 19.7 49.3 C 23.7 46.7 28 46.7 32 49.3 C 36 51.9 40.3 51.9 44.3 49.3"
          stroke="var(--tp-cafe-green)"
          strokeWidth="1.8"
        />
        <path d="M 20.6 41 L 18.9 53.5 C 18.9 58 21.5 61 25.5 61 L 38.5 61 C 42.5 61 45.1 58 45.1 53.5 L 43.4 41" />
        <path d="M 18.2 41 L 45.8 41" />
        {/* dripper handle */}
        <path d="M 43.8 20.7 C 50.9 25.3 42.9 38 35.8 33.4" strokeWidth="2" />
        <path d="M 17 13.2 L 47 13.2 L 45.5 18 L 18.5 18 Z" fill="var(--tp-bg)" />
        <path d="M 18.5 18 L 45.5 18 L 33 37 L 31 37 Z" fill="var(--tp-cafe-blue-tint)" />
        <path d="M 21.5 19 L 30.8 35.5 M 26 19 L 31.4 35.5 M 32 19 L 32 35.5 M 38 19 L 32.6 35.5 M 42.5 19 L 33.2 35.5" strokeWidth="1.1" />
        <path d="M 18.5 18 L 45.5 18 L 33 37 L 31 37 Z" />
        <path d="M 20.4 15.6 L 43.6 15.6" stroke="var(--tp-cafe-green)" strokeWidth="1.8" />
        <path d="M 31 37 L 31 40 L 33 40 L 33 37" fill="var(--tp-bg)" />
        {/* falling drops */}
        <path
          d="M 32 42.6 C 32.65 43.4 32.8 43.75 32.8 44 A 0.8 0.8 0 0 1 31.2 44 C 31.2 43.75 31.35 43.4 32 42.6 Z"
          fill="var(--tp-cafe-green)"
          stroke="none"
        />
        <path
          d="M 32 45.45 C 32.65 46.25 32.8 46.6 32.8 46.85 A 0.8 0.8 0 0 1 31.2 46.85 C 31.2 46.6 31.35 46.25 32 45.45 Z"
          fill="var(--tp-cafe-green)"
          stroke="none"
        />
      </>
    ),
  },
  "Mojito": {
    word: 'MOJITO',
    tone: 'blue',
    len: 'short',
    illo: { size: 104, end: -12, bottom: -12, rot: 8 },
    art: (
      <>
        <path d="M 22 16 L 24 56 L 40 56 L 42 16 Z" fill="var(--tp-bg)" stroke="none" />
        <path
          d="M 23 27 C 25 25.4 28 25.4 30 27 C 32 28.6 35 28.6 37 27 C 38.3 26.3 39.7 26.2 41 27 L 40 56 L 24 56 Z"
          fill="var(--tp-cafe-green)"
          fillOpacity=".38"
          stroke="none"
        />
        <path d="M 35 27.6 L 35 13 Q 35 10.9 33.5 9.4 L 28 3.9" />
        <path
          d="M 23 27 C 25 25.4 28 25.4 30 27 C 32 28.6 35 28.6 37 27 C 38.3 26.3 39.7 26.2 41 27"
          stroke="var(--tp-cafe-green)"
          strokeWidth="1.8"
        />
        {/* mint leaf */}
        <g transform="translate(78.5 0) scale(-1 1)">
          <path
            transform="translate(36.5 16) scale(1.35) translate(-36.5 -16)"
            d="M 36.5 16 c -4.93 0 -7.07 -2.4 -7.07 -6.13 c 4.4 -0.8 7.07 1.73 7.07 6.13 z"
            fill="var(--tp-cafe-green)"
            stroke="var(--tp-cafe-green)"
            strokeWidth="0.55"
          />
          <g transform="translate(36.5 16) scale(1.35) translate(-36.5 -16)" stroke="var(--tp-cafe-green-light)">
            <path d="M 35.7 15.05 Q 33 12.6 30.35 10.75" strokeWidth="0.75" />
            <path
              d="M 34.29 13.86 Q 35.1 13.3 34.95 12.6 M 33.03 12.78 Q 32.5 13.4 31.75 13.3 M 31.77 11.74 Q 32.6 11.2 32.45 10.5"
              strokeWidth="0.7"
            />
          </g>
        </g>
        {/* umbrella */}
        <g transform="translate(-24 -1)">
          <g transform="rotate(-45 46 16)" stroke="var(--tp-cafe-green)">
            <path d="M 39 16 A 7 7 0 0 1 53 16 Z" fill="var(--tp-bg)" strokeWidth="2" />
            <path d="M 40.4 16 A 5.6 5.6 0 0 1 51.6 16 Z" fill="var(--tp-cafe-green)" fillOpacity=".3" strokeWidth="1.3" />
            <path d="M 46.89 15.35 L 50.53 12.71 M 46.34 14.95 L 47.73 10.67 M 45.66 14.95 L 44.27 10.67 M 45.11 15.35 L 41.47 12.71" strokeWidth="1.1" />
            <path d="M 44.9 16 A 1.1 1.1 0 0 1 47.1 16" strokeWidth="1.1" />
          </g>
        </g>
        <path d="M 22 16 L 24 56 L 40 56 L 42 16 Z" />
      </>
    ),
  },
  "Healthy": {
    word: 'HEALTHY',
    tone: 'green',
    len: 'medium',
    illo: { size: 104, end: -12, bottom: -12, rot: -8 },
    art: (
      <>
        <path d="M 29 7 L 38 10.5 L 38 15" />
        <path d="M 21 15 L 43 15 L 41.5 21 L 22.5 21 Z" fill="var(--tp-cafe-blue-tint)" />
        <path d="M 22.5 21 L 26 56 L 38 56 L 41.5 21" fill="var(--tp-bg)" />
        <path
          d="M 24.2 31 L 25.2 41 L 38.8 41 L 39.8 31 Z"
          fill="var(--tp-cafe-green-tint)"
          stroke="var(--tp-cafe-green)"
          strokeWidth="1.8"
        />
        <path d="M 32 33.2 L 32 38.8 M 29.2 36 L 34.8 36" strokeWidth="2.6" />
        <path d="M 22.5 21 L 26 56 L 38 56 L 41.5 21" />
      </>
    ),
  },
  "Specialty Coffee": {
    word: 'SPECIALTY',
    tone: 'blue',
    len: 'long',
    illo: { size: 104, end: -12, bottom: -12, rot: -8 },
    art: (
      <>
        <g transform="translate(3.4 -7.52) scale(0.52)">
          {/* filter cone */}
          <path d="M28 20 L72 20 L56 46 L44 46 Z" fill="var(--tp-cafe-green-tint)" stroke="none" />
          <path d="M34 28 L66 28 M39 36 L61 36" stroke="var(--tp-cafe-green)" strokeWidth="3" opacity=".45" />
          <path d="M28 20 L72 20 L56 46 L44 46 Z" strokeWidth="6" />
          {/* cup */}
          <g transform="translate(0, 48)">
            <path d="M32 66C18 72 22 84 50 84C78 84 82 72 68 66" strokeWidth="4" />
            <path d="M37 68C31 72 35 78 50 78C65 78 69 72 63 68" strokeWidth="3" opacity=".45" />
            <path d="M74 44h4a10 10 0 0 1 0 20h-4" strokeWidth="6" />
            <path d="M26 38v12a24 24 0 0 0 48 0V38Z" fill="var(--tp-cafe-blue-tint)" stroke="none" />
            <path d="M26 38v12a24 24 0 0 0 48 0V38" strokeWidth="6" />
            <ellipse cx="50" cy="38" rx="24" ry="8" fill="var(--tp-cafe-blue-tint)" strokeWidth="6" />
            <ellipse cx="50" cy="38" rx="17" ry="5" fill="var(--tp-accent)" fillOpacity=".2" stroke="none" />
          </g>
          {/* drips */}
          <g fill="var(--tp-cafe-green)" stroke="none">
            <path d="M50 54 C45.5 59 46.5 64 50 64 C53.5 64 54.5 59 50 54 Z" />
            <path d="M50 66 C46.5 69.5 47.2 73 50 73 C52.8 73 53.5 69.5 50 66 Z" />
          </g>
        </g>
      </>
    ),
  },
};

/** The line illustration in a section band. Renders nothing for an unmapped category. */
export function SectionIllustration({ art }: { art: SectionArt | undefined }) {
  if (!art) return null;
  const { size, end, bottom, rot } = art.illo;
  return (
    <svg
      className="tp-stage__illo"
      viewBox="0 0 64 64"
      fill="none"
      stroke="var(--tp-accent)"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={
        {
          inlineSize: `${size}px`,
          blockSize: `${size}px`,
          insetInlineEnd: `${end}px`,
          insetBlockEnd: `${bottom}px`,
          '--tp-illo-rot': `${rot}deg`,
        } as CSSProperties
      }
      aria-hidden="true"
      focusable="false"
    >
      {art.art}
    </svg>
  );
}

/**
 * The same drawing at row scale — the menu-row thumbnail's placeholder until an
 * item carries its own photo. It is the band's illustration with the band's
 * placement dropped (no tilt, no corner offsets) and a heavier stroke, which is
 * what keeps a 64-unit line drawing legible inside a 46 px chip.
 */
export function CategoryIcon({
  art,
  className,
}: {
  art: SectionArt | undefined;
  className?: string;
}) {
  if (!art) return null;
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      stroke="var(--tp-accent)"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {art.art}
    </svg>
  );
}

/** Section art for a category, or undefined when the name is not one of the design's. */
export const sectionArtFor = (nameEn: string): SectionArt | undefined => SECTION_ART[nameEn];

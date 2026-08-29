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
  /** width in px of the green rule under the heading */
  rule: number;
  /**
   * Per-section placement, straight off the design: the illustration is a
   * different size and sits at a different tilt in every band. `end` is the
   * design's physical `left` — the trailing side in Arabic — so it is applied
   * as inset-inline-end and mirrors with the rest of the layout.
   */
  illo: { size: number; end: number; bottom: number; rot: number };
  art: ReactNode;
}

export const SECTION_ART: Record<string, SectionArt> = {
  "Coffee": {
    word: 'COFFEE',
    tone: 'blue',
    len: 'short',
    rule: 84,
    illo: { size: 108, end: -14, bottom: -14, rot: -10 },
    art: (
      <>
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
    ),
  },
  "Smoothie": {
    word: 'SMOOTHIE',
    tone: 'green',
    len: 'medium',
    rule: 84,
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
    rule: 84,
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
    rule: 64,
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
    rule: 74,
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
    rule: 84,
    illo: { size: 106, end: -12, bottom: -14, rot: 8 },
    art: (
      <>
        <ellipse cx="32" cy="55" rx="9" ry="2.5" fill="var(--tp-bg)" />
        <path d="M 32 44 L 32 52" />
        <path d="M 24 8 C 24 16 22 20 26 26 C 30 32 30 36 28 44 L 36 44 C 34 36 34 32 38 26 C 42 20 40 16 40 8 Z" fill="var(--tp-bg)" />
        <path d="M 27 26 L 37 26" stroke="var(--tp-cafe-green)" strokeWidth="1.8" />
        <circle cx="44" cy="7" r="4.5" fill="var(--tp-bg)" stroke="var(--tp-cafe-green)" strokeWidth="2" />
        <path d="M 44 3 L 44 11 M 40 7 L 48 7" stroke="var(--tp-cafe-green)" strokeWidth="1.3" />
        <path d="M 28 8 L 24 1" />
      </>
    ),
  },
  "Milkshake": {
    word: 'MILKSHAKE',
    tone: 'blue',
    len: 'long',
    rule: 74,
    illo: { size: 102, end: -10, bottom: -10, rot: -8 },
    art: (
      <>
        <path d="M 24 54 L 40 54" />
        <path d="M 32 46 L 32 52" />
        <path d="M 20 20 L 26 46 L 38 46 L 44 20" fill="var(--tp-bg)" />
        <path d="M 24 28 L 40 28" strokeWidth="1.3" opacity=".45" />
        <path d="M 20 20 C 18 13 25 11 27 14 C 27 7 37 7 37 14 C 39 11 46 13 44 20 Z" fill="var(--tp-cafe-blue-tint)" />
        <circle cx="32" cy="6" r="2.6" fill="var(--tp-cafe-green-light)" stroke="none" />
        <path d="M 38 14 L 43 3" />
      </>
    ),
  },
  "Milk Drinks": {
    word: 'MILK',
    tone: 'green',
    len: 'short',
    rule: 54,
    illo: { size: 104, end: -12, bottom: -12, rot: 8 },
    art: (
      <>
        <path d="M 21 34 C 26 31 31 37 36 34 C 39 32 41 33 43 33 L 43 52 C 43 54.5 41.5 56 39 56 L 25 56 C 22.5 56 21 54.5 21 52 Z" fill="var(--tp-cafe-blue-tint)" stroke="none" />
        <path d="M 27 8 L 37 8 L 37 14 C 41 18 43 22 43 28 L 43 52 C 43 54.5 41.5 56 39 56 L 25 56 C 22.5 56 21 54.5 21 52 L 21 28 C 21 22 23 18 27 14 Z" fill="none" />
        <path d="M 26.5 12 L 37.5 12" strokeWidth="1.6" />
        <path d="M 21 34 C 26 31 31 37 36 34 C 39 32 41 33 43 33" stroke="var(--tp-cafe-green)" strokeWidth="2" />
      </>
    ),
  },
  "Desserts": {
    word: 'DESSERTS',
    tone: 'blue',
    len: 'medium',
    rule: 84,
    illo: { size: 100, end: -12, bottom: -4, rot: 8 },
    art: (
      <>
        <ellipse cx="32" cy="54" rx="19" ry="4.5" fill="var(--tp-bg)" />
        <path d="M 15 50 L 32 18 L 49 50 Z" fill="var(--tp-bg)" />
        <path d="M 32 18 L 40 32 L 24 32 Z" fill="var(--tp-cafe-blue-tint)" stroke="none" />
        <path d="M 24 32 L 40 32" strokeWidth="1.8" />
        <path d="M 20 41 L 44 41" stroke="var(--tp-cafe-green)" strokeWidth="2" />
        <circle cx="32" cy="13" r="2.8" fill="var(--tp-cafe-green-light)" stroke="none" />
      </>
    ),
  },
  "Signature": {
    word: 'SIGNATURE',
    tone: 'green',
    len: 'long',
    rule: 74,
    illo: { size: 104, end: -12, bottom: -12, rot: -8 },
    art: (
      <>
        <path d="M 26 10 L 38 10 L 38 15" />
        <path d="M 21 15 L 43 15 L 41.5 21 L 22.5 21 Z" fill="var(--tp-cafe-blue-tint)" />
        <path d="M 22.5 21 L 26 56 L 38 56 L 41.5 21" fill="var(--tp-bg)" />
        <path d="M 24.2 31 L 25.2 41 L 38.8 41 L 39.8 31 Z" fill="var(--tp-cafe-green-tint)" stroke="var(--tp-cafe-green)" strokeWidth="1.8" />
        <path d="M 50 10 L 50 20 M 45 15 L 55 15" stroke="var(--tp-cafe-green)" strokeWidth="1.8" />
        <circle cx="47" cy="27" r="1.5" fill="var(--tp-cafe-green-light)" stroke="none" />
      </>
    ),
  },
  "Mojito": {
    word: 'MOJITO',
    tone: 'blue',
    len: 'short',
    rule: 84,
    illo: { size: 104, end: -12, bottom: -12, rot: 8 },
    art: (
      <>
        <path d="M 22 14 L 24 56 L 40 56 L 42 14 Z" fill="var(--tp-bg)" />
        <path d="M 23 28 L 24.8 54 L 39.2 54 L 41 28 Z" fill="var(--tp-cafe-blue-tint)" stroke="none" />
        <path d="M 23 28 L 41 28" strokeWidth="1.8" />
        <rect x="27" y="32" width="8" height="8" rx="2" fill="var(--tp-bg)" />
        <rect x="30" y="43" width="7" height="7" rx="2" fill="var(--tp-bg)" />
        <path d="M 32 14 L 32 4" stroke="var(--tp-cafe-green)" strokeWidth="2" />
        <path d="M 32 9 C 27 9 25 5 29 2 C 33 2 34 6 32 9 Z" fill="var(--tp-bg)" stroke="var(--tp-cafe-green)" strokeWidth="2" />
        <path d="M 32 9 C 37 9 39 5 35 2 C 31 2 30 6 32 9 Z" fill="var(--tp-bg)" stroke="var(--tp-cafe-green)" strokeWidth="2" />
        <circle cx="28" cy="47" r="1.3" stroke="var(--tp-cafe-green)" strokeWidth="1.4" />
      </>
    ),
  },
  "Healthy": {
    word: 'HEALTHY',
    tone: 'green',
    len: 'medium',
    rule: 84,
    illo: { size: 104, end: -12, bottom: -12, rot: -8 },
    art: (
      <>
        <path d="M 23 16 L 25 54 L 39 54 L 41 16 Z" fill="var(--tp-bg)" />
        <path d="M 24 30 L 25.2 52 L 38.8 52 L 40 30 Z" fill="var(--tp-cafe-green-tint)" stroke="none" />
        <path d="M 24 30 L 40 30" stroke="var(--tp-cafe-green)" strokeWidth="1.8" />
        <path d="M 22 16 L 42 16" />
        <path d="M 35 16 L 39 6" />
        <path d="M 48 8 C 40 10 37 18 44 22 C 52 22 54 12 48 8 Z" fill="var(--tp-bg)" stroke="var(--tp-cafe-green)" strokeWidth="2" />
        <path d="M 44 21 L 49 11" stroke="var(--tp-cafe-green)" strokeWidth="1.4" />
      </>
    ),
  },
  "Specialty Coffee": {
    word: 'SPECIALTY',
    tone: 'blue',
    len: 'long',
    rule: 64,
    illo: { size: 104, end: -12, bottom: -12, rot: -8 },
    art: (
      <>
        <path d="M 18 12 L 46 12 L 36 28 L 28 28 Z" fill="var(--tp-bg)" />
        <path d="M 22 17 L 42 17 M 25 22 L 39 22" strokeWidth="1.3" opacity=".45" />
        <path d="M 32 31 L 32 33 M 32 36 L 32 38" stroke="var(--tp-cafe-green)" strokeWidth="2" />
        <path d="M 21 42 L 24 54 L 40 54 L 43 42" fill="var(--tp-bg)" />
        <ellipse cx="32" cy="42" rx="11" ry="2.5" fill="var(--tp-bg)" />
        <path d="M 43 43 C 48 43 48 49 42 50" />
        <path d="M 25 50 L 39 50" stroke="var(--tp-cafe-green)" strokeWidth="1.8" />
      </>
    ),
  },
};

/** The design's green heading rule — one hand-drawn stroke, 100x12. */
export function SectionRule({ width }: { width: number }) {
  return (
    <svg
      className="tp-stage__rule"
      viewBox="0 0 100 12"
      style={{ inlineSize: `${width}px` }}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2 10 Q 50 -6 98 8"
        stroke="var(--tp-cafe-green-light)"
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

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

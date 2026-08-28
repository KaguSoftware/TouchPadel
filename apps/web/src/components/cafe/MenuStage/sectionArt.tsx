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
        <ellipse cx="32" cy="54" rx="20" ry="5" fill="var(--tp-bg)" />
        <path d="M 18 30 C 19 42 24 50 32 50 C 40 50 45 42 46 30" fill="var(--tp-bg)" />
        <path d="M 46 33 C 53 33 53 42 44 43" />
        <ellipse cx="32" cy="30" rx="14" ry="4" fill="var(--tp-bg)" />
        <ellipse cx="32" cy="30" rx="9.5" ry="2.5" fill="var(--tp-cafe-blue-tint)" strokeWidth="1.6" />
        <path d="M 26 22 C 23 18 29 15 26 10" stroke="var(--tp-cafe-green)" strokeWidth="2" />
        <path d="M 34 22 C 31 18 37 15 34 10" stroke="var(--tp-cafe-green)" strokeWidth="2" />
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
        <path d="M 21 26 L 25 56 L 39 56 L 43 26" fill="var(--tp-bg)" />
        <path d="M 21 26 A 11 10 0 0 1 43 26" fill="var(--tp-cafe-blue-tint)" />
        <path d="M 19 26 L 45 26" />
        <path d="M 34 20 L 37 8 L 43 6" />
        <circle cx="29" cy="37" r="2.2" stroke="var(--tp-cafe-green)" strokeWidth="1.8" />
        <circle cx="35" cy="45" r="2.2" stroke="var(--tp-cafe-green)" strokeWidth="1.8" />
        <circle cx="30" cy="50" r="1.5" stroke="var(--tp-cafe-green)" strokeWidth="1.8" />
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
        <ellipse cx="32" cy="56" rx="13" ry="3.5" fill="var(--tp-bg)" />
        <path d="M 23 14 C 23 24 28 27 28 33 C 28 39 23 42 23 50 L 41 50 C 41 42 36 39 36 33 C 36 27 41 24 41 14 Z" fill="var(--tp-bg)" />
        <path d="M 26 43 L 38 43" stroke="var(--tp-cafe-green)" strokeWidth="2" />
        <path d="M 32 10 C 29 7 35 5 32 1" stroke="var(--tp-cafe-green)" strokeWidth="2" />
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
        <path d="M 20 14 L 24 56 L 40 56 L 44 14 Z" fill="var(--tp-bg)" />
        <path d="M 22.4 30 L 24.6 54 L 39.4 54 L 41.6 30 Z" fill="var(--tp-cafe-blue-tint)" stroke="none" />
        <path d="M 22.5 30 L 41.5 30" strokeWidth="1.8" />
        <path d="M 36 14 L 41 4 L 47 3" stroke="var(--tp-cafe-green)" strokeWidth="2" />
        <circle cx="49" cy="14" r="7.5" fill="var(--tp-bg)" stroke="var(--tp-cafe-green)" strokeWidth="2" />
        <path d="M 49 8 L 49 20 M 43.5 14 L 54.5 14 M 45 10 L 53 18 M 45 18 L 53 10" stroke="var(--tp-cafe-green)" strokeWidth="1.4" />
        <circle cx="30" cy="40" r="1.5" strokeWidth="1.5" />
        <circle cx="34" cy="47" r="1.5" strokeWidth="1.5" />
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
        <path d="M 22 26 L 26 56 L 38 56 L 42 26" fill="var(--tp-bg)" />
        <path d="M 28 32 L 29.5 50 M 36 32 L 34.5 50" strokeWidth="1.3" opacity=".45" />
        <path d="M 22 26 C 20 20 26 18 28 20 C 27 13 37 13 36 20 C 38 18 44 20 42 26 Z" fill="var(--tp-cafe-blue-tint)" />
        <circle cx="32" cy="11" r="2.6" fill="var(--tp-cafe-green-light)" stroke="none" />
        <path d="M 37 16 L 41 5" />
        <path d="M 26 31 L 29 28.5 L 32 31 L 35 28.5 L 38 31" stroke="var(--tp-cafe-green)" strokeWidth="1.8" />
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

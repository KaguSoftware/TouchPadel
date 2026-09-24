/**
 * The site's photo grade (lib/site/photoGrade.ts; the SVG filters are drawn once per page
 * by components/landing/PhotoGrade.tsx): a blue-and-white duotone of exact Touch Blue
 * shades with the padel ball kept green (style reference §7, the duotone option with its
 * green accent), so stock and, later, Touch's own photos read as one set.
 *
 * - `.tp-photo` (print): black → navy → Touch Blue → light court blue → white. For photos
 *   nothing is written on.
 * - `.tp-photo--night`: the same ramp one stop down, capped at Touch Blue, for the photo
 *   the headline sits on: white type is never under 6.17:1 on it and the green line never
 *   under 3.48:1, whatever the photo.
 *
 * No gradient scrim, no blur, no glass. The frame's own ground is the navy, shown while
 * the image loads.
 */
export const sitePhotoCss = `
.tp-photo {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  background: var(--tp-site-navy);
}
.tp-photo__img { object-fit: cover; filter: url(#tp-photo-grade); }
.tp-photo--night .tp-photo__img { filter: url(#tp-photo-grade-night); }
.tp-photo-grade { position: absolute; inline-size: 0; block-size: 0; overflow: hidden; pointer-events: none; }
`;

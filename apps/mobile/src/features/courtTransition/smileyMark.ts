/**
 * The smiley tennis ball, as three.js vector geometry — the mark on the racket
 * face.
 *
 * The artwork is the brand's own, not a redraw: `docs/brand/stickers-5cm.pdf`
 * page 11 was lifted with pdftocairo, the outlines translated so the ink's
 * bounding box starts at (0, 0) and the coordinates rounded to 2 dp. The `d`
 * strings below are VERBATIM at that point and must never be re-traced,
 * simplified or "improved". Any change to the mark starts at the PDF again.
 *
 * WHAT WAS DROPPED, and why it is not artwork. The page is a die-cut STICKER:
 * its first 24 paths are a white halo — the same twelve shapes stroke-expanded
 * and painted underneath, so the sticker reads on any surface. A racket face is
 * not a sticker, so only the twelve coloured paths are here.
 *
 * FOUR COLOURS IN THE PDF, THREE ON THE RACKET. The extraction paints navy
 * (53, 78, 168), a light felt green (177, 222, 90), a cream seam (234, 242,
 * 216) and a deeper green (163, 208, 32) that survives in two slivers of 272
 * and 6 pixels at the size this was checked at — under a pixel on a phone. The
 * two greens are therefore one group here, and `racket.ts` maps the three that
 * remain onto colours the racket already wears rather than adding a hue: see
 * the decal there for which, and for why the navy is NOT the plate's own blue
 * (the PDF's navy against the plate is (53, 78, 168) against (51, 96, 171) —
 * the mark would have dissolved into the face).
 *
 * PAINT ORDER, IN THREE LAYERS AND NOT TWELVE. A flat vector illustration is an
 * ordered stack, and this one overlaps: the greens and creams are painted over
 * the windows of a navy silhouette, which is exactly what leaves the navy
 * showing as a ring, two eyes and a smile. Rendering that needs the order kept — but not twelve z
 * levels, because the overlaps were measured rather than assumed: paths 25-33
 * each cover part of the navy base and none touches another, path 34 touches
 * nothing at all, and only path 35 lands on a green. So the stack is INK, then
 * BALL and SEAM sharing one level, then INK_TOP: three layers, four draw calls,
 * and a decal thin enough to still sit under the perforations. The test
 * re-measures that rather than trusting this paragraph.
 *
 * PURE — three's curve/shape maths and nothing else, sharing `svgPath`'s
 * parser and its containment-depth nesting. No React, no react-native, no
 * material, mesh or scene code: the caller owns how the mark is filled, lit and
 * placed. That is what lets it be unit-tested under plain node.
 *
 * VERIFIED AGAINST THE DATA (not assumed): the extraction uses only the
 * absolute commands M, L, C and Z; the twelve paths hold 23 drawn subpaths, of
 * which 11 are counters — the felt's ten windows in the navy, and the left eye's
 * hole in the felt; and every path fills identically under three's even-odd
 * nesting and the PDF's own nonzero rule, which is what makes `groupSubpaths`
 * the right reader for this artwork as it was for the wordmark.
 */
import * as THREE from 'three';
import { groupSubpaths, parseSvgPath } from './svgPath';

/**
 * The extraction's frame, in its own units: the drawn ink's bounding box before
 * the coordinates were rounded. The mark is a ball, so it is very nearly square
 * — and its enclosing circle, not this box, is the shape the face has to hold.
 */
export const SMILEY_VIEWBOX = { width: 109.952, height: 110.868 } as const;

/**
 * LAYER 0 — the navy, painted first and then mostly painted over.
 *
 * Not a ring and some features: ONE disc with the felt's ten windows cut out of
 * it. Eleven subpaths, one enclosing the other ten, so the fill is the ball's
 * whole silhouette minus everything the green and cream later fill in — and the
 * navy that survives between those windows IS the ring, both eyes and the
 * smile. Draw this alone and you get the mark's line work; drop it and the
 * mark has no line work at all, because none of it is drawn anywhere else.
 */
export const SMILEY_INK_PATHS: readonly string[] = Object.freeze([
  // the navy line work: the ring, both eyes, the smile and every seam edge
  'M 28.2 78.65 C 28.2 78.56 28.12 78.48 28.03 78.48 C 27.93 78.48 27.85 78.56 27.85 78.65 C 27.85 78.75 27.93 78.83 28.03 78.83 C 28.12 78.83 28.2 78.75 28.2 78.65 M 48.91 106.23 C 53.41 106.81 57.74 106.53 62.19 106.16 C 65.96 105.84 69.31 104.81 72.79 103.48 C 75.07 102.62 77.13 101.77 79.26 100.52 C 81.87 98.98 84.52 97.66 86.78 95.57 C 91.64 91.1 96.68 86.41 99 80.03 C 99.85 77.68 100.72 75.4 101.73 73.11 C 102.14 72.16 102.81 71.25 102.51 70.15 L 95.91 70.01 L 88.86 69.06 C 87.31 73.03 84.67 76.04 82.27 79.36 C 78.86 84.1 74.76 87.57 69.69 90.35 C 67.1 91.78 64.85 93.07 61.68 93.16 L 52.64 93.4 C 46.07 93.58 35.77 86.5 31.08 81.84 C 30.14 80.91 29.67 79.56 28.34 79.04 C 28.99 81.31 30.2 82.96 30.91 84.99 C 32.38 89.23 33.59 96.8 32.88 101.24 C 35.75 103.15 45.78 105.84 48.91 106.23 M 23.46 94.72 C 23.23 92.22 22.77 90.3 22.08 88.3 C 20.93 85.9 20.33 83.28 18.75 81.13 L 16.88 78.59 C 14.03 74.73 10.37 71.59 6.05 69.06 C 6.34 71.2 7.41 72.64 7.99 74.48 C 10.4 80.97 14.77 88.13 20.35 92.3 C 21.38 93.15 22.1 94.27 23.46 94.72 M 92.3 68.06 C 91.67 67.55 91.1 66.71 90.28 66.25 C 89.87 66.18 89.42 67.35 89.74 67.62 C 90.45 68.2 91.4 68.1 92.3 68.06 M 20.2 68.15 L 18.11 63.02 C 17.35 64.03 17.14 64.56 16.34 65.23 Z M 103.42 68.8 C 103.5 66.52 104.82 64.13 104.55 62.36 C 100.84 62.44 97.41 62.4 93.86 62.1 C 94.07 64.37 94.33 66.28 93.74 68.25 C 95.77 68.87 100.89 68.85 103.42 68.8 M 31.49 100.61 C 31.92 99.32 31.58 98.26 31.55 97.11 C 31.44 93.47 31.15 89.84 29.82 86.43 C 28.71 83.57 27.82 80.7 26.14 78.13 C 23.16 73.6 19.19 68.71 14.71 65.66 L 11.39 63.39 C 9.37 62.01 7.21 61.16 4.89 60.06 C 4.46 62.32 4.25 64.5 5.07 66.68 C 7.29 68.22 9.71 69.46 11.74 71.28 L 14.96 74.17 C 16.02 75.12 16.85 76.29 17.77 77.41 C 22.17 82.73 24.46 89.23 25.03 96.1 C 27.01 97.9 28.95 99.5 31.49 100.61 M 92.82 59.55 C 92.83 59.86 93.05 60.28 93.19 60.5 C 93.45 60.87 103.42 61.22 104.87 60.88 C 105.88 56.87 105.1 44.64 103.65 41.28 L 101.17 35.53 C 100.23 33.34 99.32 31.21 98.08 29.21 L 95.01 24.25 C 93.25 21.43 87 14.69 83.95 12.86 C 83.3 12.48 82.39 12.32 81.77 11.71 C 79.28 9.24 77.22 9.07 73.66 7.87 C 72.51 7.48 71.1 6.28 69.88 7.01 C 67.64 8.37 64.67 13.82 63.85 16.73 C 61.98 23.35 62.31 30.24 64.16 36.93 L 64.5 29.14 C 64.58 27.31 66.15 25.48 67.44 24.26 C 68.42 24.02 70 24 70.86 24.34 C 72.14 24.85 74.22 28.93 74.26 30.29 C 74.34 33.37 74.44 36.39 74.34 39.5 C 74.27 41.74 72.81 47.23 70.41 48.41 C 71.2 49.88 72.53 50.4 73.57 51.46 C 77.19 55.15 81.78 57.55 86.74 58.99 C 87.39 57.71 86.2 53.87 87 53.25 C 89.49 51.37 92.65 56.9 92.82 59.55 M 86.58 60.81 C 85.76 60.18 84.49 59.78 83.61 59.45 C 74.09 55.85 70.55 50.11 68.95 49.04 C 66.3 47.27 65.35 45.17 64.44 42.22 C 62.92 37.35 61.35 32.71 61.26 27.47 C 61.16 21.76 61.83 16.16 64.68 11.15 C 65.7 9.35 67.14 7.98 68.35 6.11 C 65.82 6.18 61.43 3.62 60.84 5.92 C 58.73 9.19 55.94 15.24 55.83 19.23 C 53.94 29.02 55.52 38.82 60.32 47.57 C 65.51 57.02 74.67 63.74 85.14 66.51 C 85.73 66.11 87.38 61.43 86.58 60.81 M 47.57 87.2 C 51.94 88.26 53.68 88.03 57.73 87.9 C 62.71 87.74 65.83 87.76 69.66 84.76 L 73.83 81.49 C 77.17 78.87 80.06 75.81 82.16 72.06 C 82.91 70.73 84.07 69.73 84.53 68.01 C 79.6 66.42 72.76 63.47 69.01 60.13 L 65.51 57.01 C 64.51 56.11 63.71 54.96 62.83 53.95 C 59 49.56 55.46 41.77 54.54 36.04 C 54.45 35.46 54.01 34.81 53.99 34.35 L 53.69 28.03 C 53.43 22.31 53.69 16.57 56.22 11.46 L 59.48 4.87 C 58.65 4.45 57.82 4.33 57 4.34 C 45.41 4.41 50.62 3.39 39.37 6.61 C 35.63 7.68 32.46 9.33 29.19 11.28 C 26.12 13.11 23.09 14.88 20.81 17.63 C 19.1 19.67 17.21 21.42 15.72 23.6 C 12.63 28.14 7.9 38.25 6.32 43.48 C 4.4 49.8 4.46 51.66 4.8 58.01 C 4.84 58.71 6.26 58.94 6.76 59.16 C 7.8 59.62 8.66 60.21 9.62 60.73 L 13.8 62.98 C 13.78 57.85 16.46 52.67 21.78 53.09 C 21.21 55.93 20.8 58.75 21.83 61.25 C 22.97 63.97 24.18 66.64 26.02 68.88 L 30.52 74.36 C 34.71 79.46 40.75 85.54 47.57 87.2 M 63.84 110.27 C 51.61 111.79 41.77 110.51 30.59 105.24 C 24.96 102.59 20.1 99.11 15.67 94.76 C 14.07 93.19 12.55 91.89 11.3 89.97 C 10.44 88.67 9.44 87.44 8.41 86.19 C 5.94 81.93 4.27 77.35 2.69 72.66 C -0.22 63.98 -0.27 60.64 0.25 51.57 L 0.52 46.85 C 0.68 44.05 3.69 35.67 5.01 33.03 C 6.78 29.48 8.26 25.88 10.73 22.76 L 14.04 18.58 L 16.23 16.1 C 19.25 12.66 22.29 9.56 26.36 7.44 L 31.79 4.61 C 36.74 2.04 42.06 0.7 47.64 0.61 C 50.07 -0.05 52.41 0.04 54.92 0.01 C 59.76 -0.06 64.6 0.26 69.22 1.71 C 72.35 2.69 80.68 5.39 83 6.98 C 87.56 10.11 92.07 13.21 95.74 17.38 C 101.91 24.4 106.16 32.67 108.76 41.52 C 108.82 44.05 109.28 46.19 109.52 48.61 L 109.76 51.09 C 110.34 56.9 109.53 64.32 108.12 70 C 107.78 71.37 107.16 72.7 106.67 74.05 C 105.16 78.16 103.25 82.04 101.17 85.88 C 101.02 86.18 97.25 91.43 96.75 92.07 C 93.17 96.64 84.92 103.8 79.69 105.74 L 75.82 107.17 C 71.83 108.66 68.08 109.75 63.84 110.27',
]);

/**
 * LAYER 1 — the felt: the green fields laid over the navy, with the seams'
 * curves cut out of them. Both of the PDF's greens are here (see the header).
 */
export const SMILEY_BALL_PATHS: readonly string[] = Object.freeze([
  // the felt, the big left field — the left eye punched out of it
  'M 37.47 48.12 C 39.42 49.26 41.16 48.11 42.12 46.48 C 44.05 43.24 44.99 39.84 44.53 36.05 C 43.98 31.42 44.6 26.78 38.61 24.32 C 35.75 24.37 34.3 30.18 34.29 31.9 L 34.25 39.64 C 34.23 42.15 35.41 46.91 37.47 48.12 M 47.57 87.2 C 40.75 85.54 34.71 79.46 30.52 74.36 L 26.02 68.88 C 24.18 66.64 22.97 63.97 21.83 61.25 C 20.8 58.75 21.21 55.93 21.78 53.09 C 16.46 52.67 13.78 57.85 13.8 62.99 L 9.63 60.73 C 8.66 60.21 7.8 59.62 6.76 59.16 C 6.26 58.94 4.84 58.71 4.8 58.01 C 4.46 51.66 4.4 49.8 6.32 43.48 C 7.9 38.25 12.63 28.14 15.72 23.6 C 17.21 21.42 19.1 19.67 20.81 17.63 C 23.1 14.88 26.12 13.11 29.19 11.28 C 32.46 9.33 35.63 7.68 39.37 6.61 C 50.63 3.39 45.41 4.41 57 4.34 C 57.82 4.33 58.65 4.45 59.48 4.87 L 56.22 11.46 C 53.69 16.56 53.43 22.31 53.69 28.03 L 53.99 34.35 C 54.01 34.81 54.45 35.46 54.54 36.04 C 55.46 41.77 59 49.56 62.83 53.95 C 63.71 54.97 64.51 56.11 65.51 57.01 L 69.01 60.13 C 72.76 63.47 79.6 66.42 84.53 68.01 C 84.07 69.73 82.91 70.73 82.16 72.06 C 80.06 75.81 77.17 78.87 73.83 81.49 L 69.66 84.76 C 65.83 87.76 62.71 87.74 57.73 87.9 C 53.68 88.03 51.94 88.26 47.57 87.2',
  // the felt, upper right, notched round the right eye
  'M 92.82 59.55 C 92.65 56.9 89.49 51.36 87 53.25 C 86.2 53.87 87.39 57.71 86.74 58.99 C 81.78 57.55 77.19 55.15 73.57 51.46 C 72.53 50.4 71.2 49.88 70.41 48.41 C 72.81 47.23 74.27 41.74 74.34 39.5 C 74.44 36.39 74.34 33.37 74.26 30.29 C 74.22 28.93 72.14 24.85 70.86 24.34 C 70 24 68.42 24.02 67.44 24.26 C 66.15 25.48 64.58 27.31 64.5 29.14 L 64.16 36.93 C 62.31 30.24 61.98 23.35 63.85 16.73 C 64.67 13.82 67.64 8.37 69.88 7.01 C 71.1 6.28 72.51 7.48 73.66 7.87 C 77.22 9.07 79.28 9.24 81.77 11.71 C 82.39 12.32 83.3 12.48 83.95 12.86 C 87 14.69 93.25 21.43 95.01 24.26 L 98.08 29.21 C 99.32 31.21 100.23 33.34 101.17 35.53 L 103.65 41.28 C 105.1 44.64 105.88 56.87 104.87 60.88 C 103.42 61.22 93.45 60.88 93.19 60.5 C 93.05 60.28 92.83 59.86 92.82 59.55',
  // the felt, the band below the smile
  'M 48.91 106.23 C 45.78 105.84 35.75 103.15 32.88 101.24 C 33.59 96.8 32.38 89.23 30.91 84.99 C 30.2 82.96 28.99 81.31 28.34 79.04 C 29.67 79.56 30.14 80.91 31.08 81.84 C 35.77 86.5 46.07 93.58 52.64 93.4 L 61.68 93.16 C 64.85 93.07 67.1 91.78 69.69 90.35 C 74.76 87.57 78.86 84.1 82.27 79.36 C 84.67 76.04 87.31 73.03 88.86 69.06 L 95.91 70.01 L 102.51 70.15 C 102.81 71.25 102.14 72.16 101.73 73.11 C 100.72 75.4 99.85 77.68 99 80.03 C 96.68 86.41 91.64 91.1 86.78 95.57 C 84.52 97.66 81.87 98.98 79.26 100.52 C 77.13 101.76 75.07 102.62 72.79 103.48 C 69.31 104.81 65.96 105.84 62.19 106.16 C 57.74 106.53 53.41 106.81 48.91 106.23',
  // the felt, the wedge inside the lower-left seam
  'M 23.46 94.72 C 22.1 94.27 21.38 93.15 20.35 92.3 C 14.77 88.13 10.4 80.97 7.99 74.48 C 7.41 72.65 6.34 71.2 6.05 69.06 C 10.37 71.59 14.03 74.73 16.88 78.59 L 18.75 81.13 C 20.33 83.28 20.93 85.9 22.08 88.3 C 22.77 90.3 23.23 92.22 23.46 94.72',
  // the felt, a sliver at the lower-left seam's end (the PDF's deeper green)
  'M 20.2 68.16 L 16.34 65.23 C 17.14 64.56 17.35 64.03 18.11 63.02',
  // the felt, a 6-pixel speck — kept because the extraction is verbatim
  'M 28.2 78.65 C 28.2 78.75 28.12 78.83 28.03 78.83 C 27.93 78.83 27.85 78.75 27.85 78.65 C 27.85 78.56 27.93 78.48 28.03 78.48 C 28.12 78.48 28.2 78.56 28.2 78.65',
]);

/**
 * LAYER 1 — the seams, in the same pass as the felt: measured, each covers part
 * of the navy base and none of them touches the felt, so they cost no z of
 * their own.
 */
export const SMILEY_SEAM_PATHS: readonly string[] = Object.freeze([
  // the seam, the long right sweep
  'M 86.58 60.81 C 87.38 61.43 85.73 66.12 85.14 66.51 C 74.67 63.74 65.51 57.02 60.32 47.57 C 55.52 38.82 53.94 29.02 55.83 19.23 C 55.94 15.24 58.73 9.19 60.84 5.93 C 61.43 3.62 65.82 6.18 68.35 6.11 C 67.14 7.98 65.7 9.35 64.68 11.15 C 61.83 16.16 61.16 21.76 61.26 27.47 C 61.35 32.7 62.92 37.35 64.44 42.22 C 65.35 45.17 66.3 47.27 68.95 49.04 C 70.55 50.11 74.09 55.85 83.61 59.45 C 84.49 59.78 85.76 60.18 86.58 60.81',
  // the seam, the lower-left hook
  'M 31.49 100.61 C 28.95 99.5 27.01 97.9 25.03 96.1 C 24.46 89.23 22.17 82.73 17.77 77.41 C 16.85 76.29 16.02 75.12 14.96 74.17 L 11.74 71.28 C 9.71 69.46 7.29 68.22 5.07 66.68 C 4.25 64.5 4.46 62.32 4.89 60.06 C 7.21 61.16 9.37 62.01 11.39 63.39 L 14.71 65.66 C 19.19 68.71 23.16 73.6 26.14 78.14 C 27.82 80.7 28.71 83.57 29.82 86.43 C 31.15 89.84 31.44 93.47 31.55 97.11 C 31.58 98.26 31.92 99.32 31.49 100.61',
  // the seam, a chip at the smile's right tip
  'M 103.42 68.8 C 100.89 68.85 95.77 68.87 93.74 68.25 C 94.33 66.28 94.07 64.37 93.86 62.1 C 97.41 62.41 100.84 62.44 104.55 62.36 C 104.82 64.13 103.5 66.52 103.42 68.8',
  // the seam, a speck below the smile's right tip
  'M 92.3 68.06 C 91.4 68.1 90.45 68.2 89.74 67.62 C 89.42 67.35 89.87 66.18 90.28 66.25 C 91.1 66.71 91.67 67.55 92.3 68.06',
]);

/**
 * LAYER 2 — the one navy shape the felt does not sit under. The big left field
 * carries the left eye as a counter and this fills it back in, a hair wider
 * than the hole, so it has to be drawn after. It is the whole reason this file
 * has a third layer.
 */
export const SMILEY_INK_TOP_PATHS: readonly string[] = Object.freeze([
  // the left eye, painted back over the felt
  'M 37.47 48.12 C 35.41 46.91 34.23 42.15 34.25 39.64 L 34.29 31.9 C 34.3 30.18 35.75 24.37 38.61 24.32 C 44.6 26.78 43.98 31.42 44.53 36.05 C 44.99 39.84 44.05 43.24 42.12 46.48 C 41.16 48.11 39.42 49.26 37.47 48.12',
]);

/**
 * The minimal circle enclosing the ink, in artwork units — the shape the face
 * actually has to contain, and for a ball that circle is the mark itself rather
 * than a box drawn round it. `buildSmileyShapes` scales by this, so the caller
 * answers the only question a round face asks: how big a circle may the ink
 * fill?
 */
export const SMILEY_CIRCLE = { cx: 54.329, cy: 55.674, r: 56.524 } as const;

/**
 * Artwork space → three's: centred on the ink's enclosing circle and y-flipped,
 * so the mark stands upright with that circle on the origin. SVG's y points
 * DOWN from a top-left origin and three's points UP; `scale` is metres per
 * artwork unit.
 */
const place =
  (scale: number) =>
  (p: THREE.Vector2): THREE.Vector2 =>
    new THREE.Vector2((p.x - SMILEY_CIRCLE.cx) * scale, (SMILEY_CIRCLE.cy - p.y) * scale);

/** Rebuild a subpath through `f`, curve for curve, so beziers survive the move. */
const mapPath = (path: THREE.Path, f: (p: THREE.Vector2) => THREE.Vector2): THREE.Path => {
  const out = new THREE.Path();
  for (const curve of path.curves) {
    if (curve instanceof THREE.CubicBezierCurve)
      out.curves.push(
        new THREE.CubicBezierCurve(f(curve.v0), f(curve.v1), f(curve.v2), f(curve.v3)),
      );
    else if (curve instanceof THREE.LineCurve)
      out.curves.push(new THREE.LineCurve(f(curve.v1), f(curve.v2)));
    else
      throw new Error(
        `smileyMark: parseSvgPath emitted a ${curve.type}, which mapPath cannot move`,
      );
  }
  out.currentPoint.copy(f(path.currentPoint));
  return out;
};

/**
 * The mark, ready for `new THREE.ShapeGeometry(shapes, n)`: its ink enclosed by
 * a circle of exactly `radius` centred on (0, 0), standing upright in three's
 * y-up space.
 *
 * The four groups come back separately because they are three colours and three
 * PAINT LAYERS — draw them in the order declared here, `ink` under `ball` and
 * `seam`, `inkTop` over both, and the ball reassembles. All are in the same
 * frame: no offset of the caller's own.
 */
export const buildSmileyShapes = (
  radius: number,
): { ink: THREE.Shape[]; ball: THREE.Shape[]; seam: THREE.Shape[]; inkTop: THREE.Shape[] } => {
  const f = place(radius / SMILEY_CIRCLE.r);
  const build = (data: readonly string[]): THREE.Shape[] =>
    groupSubpaths(data.flatMap((d) => parseSvgPath(d)).map((path) => mapPath(path, f)));
  return {
    ink: build(SMILEY_INK_PATHS),
    ball: build(SMILEY_BALL_PATHS),
    seam: build(SMILEY_SEAM_PATHS),
    inkTop: build(SMILEY_INK_TOP_PATHS),
  };
};

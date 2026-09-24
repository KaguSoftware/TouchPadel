/**
 * The court on the web (contract: docs/design/web-site/contracts-2026-09-23.md §3 Lane A).
 *
 *  - CourtStage: 'use client'. The live three.js court over the flat court, with
 *    children riding the net. three.js loads with a dynamic import after mount.
 *  - CourtIllustration: server-safe flat court (SVG + CSS keyframes).
 *  - courtCss: every rule both need; SiteStyles inlines it.
 *
 * Nothing here imports three.js statically: courtCanvas.ts and the copied scene
 * modules are reached only through CourtStage's `import()`.
 */
export { CourtStage } from './CourtStage';
export type { CourtStageProps } from './CourtStage';
export { CourtIllustration } from './CourtIllustration';
export { courtCss } from './court.css';

/** Keyframes, the brand loader, and the reduced-motion collapse. */
export const motionCss = `
@keyframes tp-slide-up { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes tp-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes tp-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes tp-slide-down { from { transform: translateY(0); opacity: 1; } to { transform: translateY(24px); opacity: 0; } }
/* Bottom sheets travel their own full height, so they enter from off-screen and
   leave the same way rather than nudging. Kept separate from tp-slide-up/-down,
   which the toast and the small cards still use for a short hop. */
@keyframes tp-sheet-in { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes tp-sheet-out { from { transform: translateY(0); } to { transform: translateY(100%); } }
/* A removed basket line slides out and collapses the space it held, so the rows
   below travel up into the gap rather than snapping. The row's own height is
   measured and pinned in px before this runs (BasketLineRow), because an auto
   height has nothing to animate from. */
@keyframes tp-row-out {
  0% { opacity: 1; transform: translateX(0); }
  35% { opacity: 0; transform: translateX(-10%); }
  100% { opacity: 0; transform: translateX(-10%);
    block-size: 0; padding-block: 0; margin-block: 0; border-block-end-width: 0; }
}
@keyframes tp-stamp-slam { 0% { transform: scale(2.4); opacity: 0; } 60% { transform: scale(0.94); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
@keyframes tp-bean-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(0.82); opacity: 0.7; } }
@keyframes tp-spin-ring { to { transform: rotate(360deg); } }
@keyframes tp-arrow-draw { to { stroke-dashoffset: 0; } }
@keyframes tp-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }

.tp-fade-in { animation: tp-fade-in var(--tp-dur-base) both; }
.tp-slide-up { animation: tp-slide-up var(--tp-dur-base) var(--tp-ease-out) both; }

/* Loader: bean pulse inside a rotating arc ring */
.tp-loader { position: relative; display: inline-grid; place-items: center; inline-size: var(--tp-loader-size, 3rem); block-size: var(--tp-loader-size, 3rem); }
.tp-loader[data-size='xs'] { --tp-loader-size: 1.25rem; }
.tp-loader[data-size='sm'] { --tp-loader-size: 2rem; }
.tp-loader[data-size='md'] { --tp-loader-size: 3rem; }
.tp-loader[data-size='lg'] { --tp-loader-size: 5rem; }
.tp-loader[data-tone='onLight'] { color: var(--tp-accent); }
.tp-loader[data-tone='onDark'] { color: var(--tp-brand-white); }
.tp-loader__ring { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; animation: tp-spin-ring 1.2s linear infinite; }
.tp-loader__bean { animation: tp-bean-pulse 1.6s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; scroll-behavior: auto !important; }
  .tp-loader__ring { animation: none; }
  .tp-loader__bean { animation: none; }
  .tp-hero__media video { display: none; }
  .tp-hero__media img[data-poster] { display: block; }
}
`;

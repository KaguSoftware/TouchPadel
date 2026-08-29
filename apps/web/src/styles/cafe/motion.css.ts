/** Keyframes, the brand loader, and the reduced-motion collapse. */
export const motionCss = `
@keyframes tp-slide-up { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes tp-fade-in { from { opacity: 0; } to { opacity: 1; } }
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

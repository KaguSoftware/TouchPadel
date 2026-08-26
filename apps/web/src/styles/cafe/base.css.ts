/**
 * Base: resets, the fixed-viewport app shell, a11y + form defaults, and the
 * shared primitives (container, buttons, chips, banners, boot state).
 * CSS LOGICAL PROPERTIES ONLY; colours only via var(--tp-*).
 */
export const baseCss = `
*, *::before, *::after { box-sizing: border-box; }
/* Blue ground behind the fixed shell, so a rubber-band overscroll never
   flashes white against the blue crown. It has to live on html AND body AND
   .tp-app below: the bounce happens inside .tp-app__scroll, which is
   transparent, so what actually shows through is .tp-app — NOT the document.
   html/body are painted too for the browser's own top-of-document bounce. */
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; block-size: 100%; background: var(--tp-accent); }
body { margin: 0; min-block-size: 100dvh; overscroll-behavior-block: none; -webkit-tap-highlight-color: transparent;
  background: var(--tp-accent); }
img, video { max-inline-size: 100%; block-size: auto; }
h1, h2, h3, h4, p, figure { margin-block: 0; }
button { font: inherit; cursor: pointer; color: inherit; }
a { color: var(--tp-accent); }
input, textarea, select { font-size: max(16px, 1rem); font-family: inherit; }
:focus-visible { outline: 3px solid var(--tp-accent); outline-offset: 2px; }
:focus:not(:focus-visible) { outline: none; }
[hidden] { display: none !important; }

.tp-visually-hidden { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* Fixed-viewport shell: the document never scrolls; .tp-app__scroll does. */
/* Blue, not --tp-bg: the scroller in front carries the page ground, so the
   only thing this surface shows is the rubber-band gutter past its edges. */
.tp-app { position: fixed; inset: 0; display: flex; flex-direction: column; background: var(--tp-accent); color: var(--tp-fg); overflow: hidden; }
/* Carries the PAGE ground so content never sits on the shell's blue; only the
   rubber-band gutter beyond this box exposes it. */
.tp-app__scroll { flex: 1 1 auto; min-block-size: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; overflow-anchor: none; -webkit-overflow-scrolling: touch;
  background: var(--tp-bg);
  padding-block-end: calc(var(--tp-ticker-h) + env(safe-area-inset-bottom)); }
.tp-app[inert] { pointer-events: none; }

.tp-container { inline-size: 100%; max-inline-size: var(--tp-column-w); margin-inline: auto; padding-inline: var(--tp-space-4); }

/* buttons */
.tp-btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--tp-space-2);
  padding-block: 0.65rem; padding-inline: 1.25rem; border-radius: var(--tp-radius-pill); border: 1px solid transparent;
  font-weight: 700; text-decoration: none; min-block-size: 2.75rem; transition: transform var(--tp-dur-fast) var(--tp-ease-out), opacity var(--tp-dur-fast); }
.tp-btn:active { transform: scale(0.97); }
.tp-btn--primary { background: var(--tp-accent); color: var(--tp-accent-contrast); }
.tp-btn--secondary { background: var(--tp-accent-2); color: var(--tp-accent-2-contrast); }
.tp-btn--ghost { background: transparent; color: var(--tp-accent); border-color: var(--tp-accent); }
.tp-btn--onblue { background: var(--tp-brand-white); color: var(--tp-accent); }
.tp-btn[disabled] { opacity: 0.45; cursor: not-allowed; }
.tp-btn--block { inline-size: 100%; }

/* cards / chips */
.tp-card { background: var(--tp-surface); border: 1px solid var(--tp-border); border-radius: var(--tp-radius-md); padding: var(--tp-space-4); }
.tp-chips { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-block-start: 0.4rem; }
.tp-chip { font-size: var(--tp-fs-xs); padding-block: 0.1rem; padding-inline: 0.55rem; border-radius: var(--tp-radius-pill);
  background: var(--tp-accent-2); color: var(--tp-accent-2-contrast); font-weight: 600; }
.tp-chip--muted { background: var(--tp-muted); color: var(--tp-fg); }
.tp-chip--blue { background: var(--tp-cafe-blue-tint); color: var(--tp-accent); }

/* banners / notices — status colours are tokens now (was raw hex) */
.tp-banner { padding-block: var(--tp-space-3); padding-inline: var(--tp-space-4); border-radius: var(--tp-radius-sm); font-size: 0.9rem; margin-block: var(--tp-space-3); }
.tp-banner--warn { background: var(--tp-warn-bg); color: var(--tp-warn-fg); border: 1px solid var(--tp-warn-border); }
.tp-banner--info { background: var(--tp-surface); border: 1px solid var(--tp-border); color: var(--tp-muted-fg); }
.tp-banner--error { background: var(--tp-error-bg); color: var(--tp-danger); border: 1px solid var(--tp-error-border); }
.tp-banner--success { background: var(--tp-success-bg); color: var(--tp-success); border: 1px solid var(--tp-success); }

/* centered boot / error / empty states */
.tp-boot { min-block-size: 60dvh; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: var(--tp-space-4); text-align: center; padding-block: var(--tp-space-6); padding-inline: var(--tp-space-5); }
.tp-boot h1 { font-family: var(--tp-font-display); font-size: var(--tp-fs-xl); font-weight: var(--tp-fw-display); text-transform: uppercase; letter-spacing: var(--tp-tracking-caps); line-height: var(--tp-lh-tight); }
.tp-boot p { color: var(--tp-muted-fg); max-inline-size: 26rem; }
.tp-eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: var(--tp-tracking-eyebrow); font-weight: 700; color: var(--tp-muted-fg); }
`;

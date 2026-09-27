/**
 * Site base: the `.tp-site` frame, type, the two-weight display headline, buttons, focus,
 * the brand pieces (lockup, ball, pattern, squiggle, café mark, icons), the open pill,
 * and the two "on a dark block" re-scopes. Everything is scoped under `.tp-site`, so none
 * of it can reach the café menu that shares the document.
 */
export const siteBaseCss = `
.tp-site {
  position: relative;
  display: flex;
  flex-direction: column;
  min-block-size: 100dvh;
  background: var(--tp-site-hero-bg);
  color: var(--tp-fg);
  font-family: var(--tp-font-body);
  font-size: var(--tp-site-fs-md);
  font-weight: var(--tp-site-fw-body);
  line-height: var(--tp-site-lh-body);
  overflow-x: clip;
  font-kerning: normal;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-tap-highlight-color: transparent;
}
/* Resets carry no specificity (:where), so any component class beats them. */
:where(.tp-site) *, :where(.tp-site) *::before, :where(.tp-site) *::after { box-sizing: border-box; }
:where(.tp-site) :where(h1, h2, h3, p, ul, ol, dl, dd, figure) { margin: 0; }
:where(.tp-site) :where(ul, ol) { padding: 0; list-style: none; }
:where(.tp-site) a { color: inherit; }
:where(.tp-site) svg { flex: none; }
.tp-site ::selection { background: var(--tp-site-green); color: var(--tp-site-green-ink); }
.tp-site-main { display: block; flex: 1 0 auto; }
.tp-site-main:focus { outline: none; }
.tp-num { font-variant-numeric: tabular-nums; }
.tp-site-sr {
  position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap;
}

/* Focus: a 2px ring off the element, the ground showing through the gap (style
   reference §9). Sections on a dark or blue block re-scope the ring to white. */
.tp-site :focus-visible { outline: 2px solid var(--tp-site-ring); outline-offset: 3px; }
.tp-site :focus:not(:focus-visible) { outline: none; }

.tp-site-skip {
  position: absolute;
  inset-block-start: 0.75rem;
  inset-inline-start: var(--tp-site-gutter);
  z-index: var(--tp-site-z-skip);
  padding-block: 0.75rem;
  padding-inline: 1.25rem;
  border-radius: var(--tp-site-radius-btn);
  background: var(--tp-site-green);
  color: var(--tp-site-green-ink);
  font-weight: var(--tp-site-fw-label);
  text-decoration: none;
  transform: translateY(-300%);
}
.tp-site-skip:focus-visible { transform: none; }

/* A section standing on the poster black, the brand navy, Touch Blue or a photo (and the
   home page's header while it floats over the hero photo): every token that names ink,
   accent, status or ring turns to the dark-ground version, whatever the page's mode. */
.tp-on-dark, .tp-on-blue,
.tp-site[data-page='home'] .tp-site-header[data-scrolled='false']:not([data-menu='open']) {
  --tp-fg: var(--tp-brand-white);
  --tp-muted-fg: var(--tp-brand-gray);
  --tp-site-green-text: var(--tp-brand-green);
  --tp-site-warn-fg: var(--tp-site-warn-fg-on-dark);
  --tp-accent: var(--tp-brand-white);
  --tp-site-ink-2: var(--tp-site-block-muted);
  --tp-site-display-1: var(--tp-brand-white);
  --tp-site-display-2: var(--tp-brand-green);
  --tp-site-ring: var(--tp-brand-white);
  --tp-site-lockup-ink: var(--tp-brand-white);
  --tp-site-lockup-swoosh-end: var(--tp-brand-white);
  --tp-site-accent-hover: var(--tp-site-block-muted);
  --tp-site-tint: var(--tp-site-navy-card);
  color: var(--tp-fg);
}
.tp-on-dark { --tp-accent-contrast: var(--tp-site-navy); }
/* On Touch Blue the brand gray is only 3.28:1, so secondary ink is the light gray step. */
.tp-on-blue { --tp-muted-fg: var(--tp-site-block-muted); --tp-accent-contrast: var(--tp-brand-blue); --tp-site-tint: var(--tp-site-block-deep); }

/* Display: the deck's two-weight headline. Line one regular, line two black and in the
   accent colour. Latin is set in capitals by CSS, tight; Arabic (no case) keeps its
   letters untouched and a taller line so ج ح ي never clip. */
.tp-display {
  font-family: var(--tp-font-display);
  font-weight: var(--tp-site-fw-display);
  line-height: var(--tp-site-lh-display);
  letter-spacing: var(--tp-site-track-display);
  text-transform: uppercase;
  color: var(--tp-site-display-1);
  text-wrap: balance;
}
.tp-display__l1, .tp-display__l2 { display: block; }
.tp-display__l1 { font-weight: 400; }
.tp-display__l2 { font-weight: var(--tp-site-fw-display); color: var(--tp-site-display-2); }
[dir='rtl'] .tp-display { text-transform: none; letter-spacing: 0; line-height: var(--tp-site-lh-display-ar); }
/* Every display block is sized to its own column (container units): --tp-fit is
   100 / the longest line's width in em, measured in Lama Sans Black, so the longest
   line fills the column and the rest follow. --tp-cap keeps a wide screen from shouting. */
.tp-fit { container-type: inline-size; }
.tp-fit .tp-display { font-size: min(calc(var(--tp-fit, 11) * 1cqi), var(--tp-cap, 8rem)); }

/* Buttons. Hover fades a fill in by opacity alone (a layer under the label), so nothing
   but opacity and transform ever animates, and nothing moves the layout. */
.tp-site-btn {
  position: relative;
  isolation: isolate;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.6em;
  min-block-size: var(--tp-site-touch);
  max-inline-size: 100%;
  padding-block: 0.75rem;
  padding-inline: 1.5rem;
  border: 1.5px solid transparent;
  border-radius: var(--tp-site-radius-btn);
  background: transparent;
  font-family: var(--tp-font-body);
  font-size: 0.9375rem;
  font-weight: var(--tp-site-fw-label);
  line-height: 1.15;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  transition: transform var(--tp-site-dur-fast) var(--tp-site-ease-out);
}
.tp-site-btn::before {
  content: '';
  position: absolute;
  inset: -1.5px;
  z-index: var(--tp-site-z-below);
  border-radius: inherit;
  background: var(--tp-btn-hover, transparent);
  opacity: 0;
  transition: opacity var(--tp-site-dur-fast) var(--tp-site-ease-out);
}
@media (hover: hover) { .tp-site-btn:hover::before { opacity: 1; } }
.tp-site-btn:active { transform: scale(0.97); }
.tp-site-btn .tp-icon { inline-size: 1.2em; block-size: 1.2em; }
[dir='rtl'] .tp-site-btn { text-transform: none; letter-spacing: 0; font-size: 1rem; }
.tp-site-btn--go { background: var(--tp-site-green); color: var(--tp-site-green-ink); --tp-btn-hover: var(--tp-site-green-hover); }
.tp-site-btn--primary { background: var(--tp-accent); color: var(--tp-accent-contrast); --tp-btn-hover: var(--tp-site-accent-hover); }
.tp-site-btn--ghost { color: var(--tp-fg); border-color: var(--tp-muted-fg); --tp-btn-hover: var(--tp-site-tint); }
/* The fill covers the border's box, but the rim still antialiases past it, so the outline
   fades out as the fill fades in. Doubled class to outrank section overrides (.tp-front). */
.tp-site-btn.tp-site-btn--ghost { transition: transform var(--tp-site-dur-fast) var(--tp-site-ease-out), border-color var(--tp-site-dur-fast) var(--tp-site-ease-out); }
@media (hover: hover) { .tp-site-btn.tp-site-btn--ghost:hover { border-color: transparent; } }
/* Touch Blue in both modes (the app's own blue button), deepening on hover: 6.2:1 white. */
.tp-site-btn--blue { background: var(--tp-site-block); color: var(--tp-brand-white); --tp-btn-hover: var(--tp-site-block-deep); }
.tp-site-btn--sm { padding-inline: 1rem; font-size: 0.8125rem; }
[dir='rtl'] .tp-site-btn--sm { font-size: 0.9375rem; }
.tp-site-btn--lg { min-block-size: 3.5rem; padding-inline: 1.75rem; font-size: 1rem; }
.tp-site-btn--xl { min-block-size: 4rem; padding-inline: 2rem; border-radius: 18px; font-size: 1.0625rem; letter-spacing: 0.09em; }
[dir='rtl'] .tp-site-btn--lg, [dir='rtl'] .tp-site-btn--xl { font-size: 1.125rem; letter-spacing: 0; }

.tp-site-iconbtn {
  position: relative;
  isolation: isolate;
  display: inline-grid;
  place-items: center;
  inline-size: var(--tp-site-touch);
  block-size: var(--tp-site-touch);
  padding: 0;
  border: 0;
  border-radius: var(--tp-site-radius-pill);
  background: transparent;
  color: var(--tp-fg);
  cursor: pointer;
}
.tp-site-iconbtn::before {
  content: '';
  position: absolute;
  inset: 4px;
  z-index: var(--tp-site-z-below);
  border-radius: inherit;
  background: var(--tp-site-tint);
  opacity: 0;
  transition: opacity var(--tp-site-dur-fast) var(--tp-site-ease-out);
}
@media (hover: hover) { .tp-site-iconbtn:hover::before { opacity: 1; } }
.tp-site-iconbtn .tp-icon { inline-size: 1.375rem; block-size: 1.375rem; }

/* Icons: 24 grid, stroke 2, round. Directional ones mirror in RTL; objects never. */
.tp-icon { display: block; inline-size: 1.25em; block-size: 1.25em; }
[dir='rtl'] .tp-icon--dir { transform: scaleX(-1); }

/* The lockup: its two variable colours are tokens, so it follows every ground. */
.tp-lockup { display: block; block-size: 100%; inline-size: auto; aspect-ratio: 72.55 / 26.78; overflow: visible; }
.tp-lockup__stop-start { stop-color: var(--tp-brand-green); }
.tp-lockup__stop-end { stop-color: var(--tp-site-lockup-swoosh-end); }
.tp-lockup__word { fill: var(--tp-site-lockup-ink); }
.tp-ball__seam { fill: var(--tp-brand-white); }
.tp-ball__felt { fill: var(--tp-brand-green); }
.tp-ballmark { display: block; inline-size: 1em; block-size: 1em; }

/* The court-line pattern: green bands, flat caps, cropped by its box, never mirrored. */
.tp-pattern { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; pointer-events: none; opacity: var(--tp-site-pattern-opacity); }
.tp-pattern__bands { stroke: var(--tp-site-pattern); fill: none; }
.tp-on-dark .tp-pattern, .tp-on-blue .tp-pattern { opacity: var(--tp-site-pattern-opacity-on-dark); }
/* Where the bands carry no text (behind the court, the events poster, whose letters
   are knocked out of them) they are the exact Padel Green: at 0.45 green
   over blue mixes into a teal (retired) and over black into an olive. */
.tp-club__field .tp-pattern, .tp-events .tp-events__pattern { opacity: 1; }

/* The title squiggle sits on the leading edge, so it mirrors in Arabic. */
.tp-squiggle { display: block; inline-size: 5.5rem; block-size: 0.6rem; overflow: visible; }
.tp-squiggle path { fill: none; stroke: var(--tp-site-green); stroke-width: 3.5; stroke-linecap: round; vector-effect: non-scaling-stroke; }
[dir='rtl'] .tp-squiggle { transform: scaleX(-1); }

/* The café mark: Touch Blue tile, Padel Green bean and smile, white split. */
.tp-cafemark { display: block; }
.tp-cafemark__tile { fill: var(--tp-brand-blue); }
.tp-cafemark__bean { fill: var(--tp-brand-green); }
.tp-cafemark__split { stroke: var(--tp-brand-white); }
.tp-cafemark__smile { stroke: var(--tp-brand-green); }

/* "● Open now · 09:00–02:00". Green means live; the words carry the state too. */
.tp-open {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem 0.55rem;
  min-block-size: 2rem;
  font-size: var(--tp-site-fs-sm);
  font-weight: 700;
  color: var(--tp-site-ink-2);
}
.tp-open__dot { inline-size: 0.625rem; block-size: 0.625rem; border-radius: var(--tp-site-radius-pill); background: var(--tp-muted-fg); }
.tp-open[data-status='open'] .tp-open__dot { background: var(--tp-site-green-text); }
.tp-open[data-status='open'] .tp-open__lead { color: var(--tp-fg); }
.tp-open[data-status='closed'] .tp-open__dot { background: var(--tp-site-warn-fg); }
.tp-open__sep { opacity: 0.6; }
.tp-open__hours { font-variant-numeric: tabular-nums; }

/* The venue's hours: one line when every day is the same, else the week. */
.tp-hours-list { font-variant-numeric: tabular-nums; }
.tp-hours-list__window { font-weight: 700; }
.tp-hours-list--week { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1rem; }
.tp-hours-list--week div { display: contents; }
.tp-hours-list--week dt { color: var(--tp-muted-fg); }

@media (prefers-reduced-motion: reduce) {
  .tp-site-btn, .tp-site-btn.tp-site-btn--ghost, .tp-site-btn::before, .tp-site-iconbtn::before { transition: none; }
  .tp-site-btn:active { transform: none; }
}
`;

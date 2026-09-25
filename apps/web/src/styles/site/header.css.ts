/**
 * Site header: sticky, laid over the first section (a negative block-end margin the
 * height of the bar, which every page's first block pads back), transparent while the
 * home page sits on its photo and solid with a hairline once the page scrolls under it.
 * The solid ground is a layer that fades by opacity; it is on by default, so no JS means
 * a readable solid bar.
 *
 * Phone first: the bar holds the lockup (34px tall) and the menu toggle at the inline
 * end (desktop adds the language pill after "Book a court"); the section links, "Book a court", the language and the theme live in a
 * full-height sheet under the bar (the mobile block at the end of this file). At 64rem the panel dissolves into the bar (`display: contents`) and the
 * lockup grows to 46px, so the club's own mark is the first thing the eye lands on and
 * its wordmark stands taller than the nav labels beside it (it used to be the quietest
 * thing in the bar: 8px caps against the links' 11px). The lockup's box includes the
 * swoosh's descender, so its clear space is the bar's own padding around it, more than
 * one ball diameter. Without JS the panel is a second row of the bar, always open.
 */
export const siteHeaderCss = `
.tp-site-header {
  position: sticky;
  inset-block-start: 0;
  z-index: var(--tp-site-z-header);
  isolation: isolate;
  margin-block-end: calc(-1 * var(--tp-site-header-h));
  color: var(--tp-fg);
}
.tp-site-header::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: var(--tp-site-z-below);
  background: var(--tp-site-header-bg);
  box-shadow: inset 0 -1px 0 var(--tp-site-header-border);
  transition: opacity var(--tp-site-dur-base) var(--tp-site-ease-out);
}
.tp-site-header[data-scrolled='false']:not([data-menu='open'])::before { opacity: 0; }
.tp-site-header__inner {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  block-size: var(--tp-site-header-h);
  max-inline-size: var(--tp-site-max);
  margin-inline: auto;
  padding-inline: var(--tp-site-gutter);
}
.tp-site-header__brand {
  display: flex;
  align-items: center;
  block-size: var(--tp-site-touch);
  padding-block: 7px;
  margin-inline: -2px auto;
  border-radius: var(--tp-site-radius-sm);
}
.tp-site-header__book { flex: none; white-space: nowrap; }
.tp-site-header__book.tp-site-btn--sm { padding-inline: 0.875rem; }

/* The panel: a solid sheet under the bar with the four links as big rows, then the
   language and the theme. */
.tp-site-menu {
  position: absolute;
  inset-block-start: 100%;
  inset-inline: 0;
  display: none;
  flex-direction: column;
  gap: 0.75rem;
  padding-block: 0.5rem 1.25rem;
  padding-inline: var(--tp-site-gutter);
  background: var(--tp-site-header-bg);
  box-shadow: inset 0 -1px 0 var(--tp-site-header-border), var(--tp-site-shadow-lift);
  color: var(--tp-fg);
}
.tp-site-header[data-menu='open'] .tp-site-menu { display: flex; }
.tp-site-nav__list { display: grid; }
.tp-site-nav__link {
  display: flex;
  align-items: center;
  min-block-size: 3.25rem;
  padding-inline: 0.25rem;
  border-radius: var(--tp-site-radius-sm);
  font-size: var(--tp-site-fs-lg);
  font-weight: 700;
  text-decoration: none;
  white-space: nowrap;
}
.tp-site-nav__list li + li { border-block-start: 1px solid var(--tp-site-header-border); }
.tp-site-tools { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.tp-site-nav__lang { font-family: var(--tp-font-arabic); }
.tp-site-tools .tp-site-nav__lang { min-block-size: var(--tp-site-touch); font-size: var(--tp-site-fs-md); }

/* No JS: no toggle, and the panel is a wrapped second row of the bar. */
.tp-site-header:not([data-js]) .tp-site-menu-toggle { display: none; }
.tp-site-header:not([data-js]) .tp-site-header__inner { flex-wrap: wrap; block-size: auto; min-block-size: var(--tp-site-header-h); padding-block: 0.5rem; }
.tp-site-header:not([data-js]) .tp-site-menu {
  position: static;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  order: 1;
  flex-basis: 100%;
  padding: 0;
  background: none;
  box-shadow: none;
}
.tp-site-header:not([data-js]) .tp-site-nav__list { display: flex; flex-wrap: wrap; }
.tp-site-header:not([data-js]) .tp-site-nav__list li + li { border: 0; }
.tp-site-header:not([data-js]) .tp-site-nav__link { min-block-size: var(--tp-site-touch); padding-inline: 0.5rem; font-size: var(--tp-site-fs-sm); }

@media (hover: hover) {
  .tp-site-nav__link:hover { text-decoration-line: underline; text-decoration-thickness: 2px; text-underline-offset: 0.35em; }
}

@media (min-width: 64rem) {
  .tp-site-header__inner { gap: 0.25rem; }
  .tp-site-header__brand { block-size: 3.25rem; padding-block: 3px; }
  .tp-site-menu-toggle { display: none; }
  .tp-site-menu,
  .tp-site-header[data-menu='open'] .tp-site-menu,
  .tp-site-header:not([data-js]) .tp-site-menu { display: contents; }
  .tp-site-nav__list, .tp-site-header:not([data-js]) .tp-site-nav__list { display: flex; gap: 0.125rem; }
  .tp-site-nav__list li + li { border: 0; }
  .tp-site-nav__link,
  .tp-site-header:not([data-js]) .tp-site-nav__link,
  .tp-site-tools .tp-site-nav__lang {
    min-block-size: var(--tp-site-touch);
    padding-inline: 0.75rem;
    font-size: 0.9375rem;
  }
  .tp-site-tools { gap: 0; margin-inline-start: 0.25rem; }
  .tp-site-header__book { margin-inline-start: 0.5rem; }
  .tp-site-header__book.tp-site-btn--sm { padding-inline: 1.125rem; }
  /* The bar's language pill, after "Book a court"; the sheet's link stands down. */
  .tp-site-tools .tp-site-nav__lang { display: none; }
  .tp-site-header__lang {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 0.5rem;
    min-block-size: var(--tp-site-touch);
    margin-inline-start: 0.5rem;
    padding-inline: 1rem;
    border: 1.5px solid color-mix(in srgb, currentColor 32%, transparent);
    border-radius: 999px;
    font-family: var(--tp-font-arabic);
    font-size: 0.9375rem;
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
    transition: background-color 150ms ease;
  }
  .tp-site-header__lang .tp-icon { inline-size: 1.1em; block-size: 1.1em; flex: none; color: var(--tp-site-green-text); }
}
@media (min-width: 64rem) and (hover: hover) {
  .tp-site-header__lang:hover { background: var(--tp-site-tint); }
}
@media (min-width: 64rem) and (max-width: 72rem) {
  .tp-site-nav__link, .tp-site-tools .tp-site-nav__lang { padding-inline: 0.5rem; }
  .tp-site-header__lang { padding-inline: 0.75rem; }
}
/* Below 64rem the language lives in the sheet (or, without JS, in the panel's row). */
@media (max-width: 63.99rem) { .tp-site-header__lang { display: none; } }

/* Phone-sheet extras (the links' arrows, the language pill's globe, the theme's printed
   label): in the markup at every width, shown only in the sheet below. */
.tp-site-nav__arrow, .tp-site-nav__lang .tp-icon, .tp-theme-toggle__text, .tp-site-menu__book { display: none; }

/* The toggle's icon: two court lines that cross into an X when the sheet opens. */
.tp-burger { position: relative; display: block; inline-size: 22px; block-size: 14px; }
.tp-burger > span {
  position: absolute;
  inset-inline: 0;
  block-size: 2px;
  border-radius: 2px;
  background: currentColor;
  transition: transform var(--tp-site-dur-base) var(--tp-site-ease-out);
}
.tp-burger > span:first-child { inset-block-start: 2px; }
.tp-burger > span:last-child { inset-block-end: 2px; }
.tp-site-menu-toggle[aria-expanded='true'] .tp-burger > span:first-child { transform: translateY(4px) rotate(45deg); }
.tp-site-menu-toggle[aria-expanded='true'] .tp-burger > span:last-child { transform: translateY(-4px) rotate(-45deg); }

/* Phone and tablet, with JS: the bar is the lockup and the toggle (at the inline end,
   where a thumb looks for it); the green button lives in the sheet, not the bar (without
   JS it stays in the bar, since there is no sheet). The menu is a full-height sheet:
   the four links as big display rows with their arrows, then a full-width green "Book a
   court" and the language and the theme as two labelled pills at the foot. The page under it does not scroll. */
@media (max-width: 63.99rem) {
  .tp-site-header[data-js] .tp-site-header__book { display: none; }
  .tp-site-menu-toggle { order: 2; margin-inline-end: -0.625rem; }

  html:has(.tp-site-header[data-js][data-menu='open']) { overflow: hidden; }

  .tp-site-header[data-js] .tp-site-menu {
    position: fixed;
    inset-block: var(--tp-site-header-h) 0;
    inset-inline: 0;
    gap: 2rem;
    padding-block: 0.5rem max(1.5rem, env(safe-area-inset-bottom));
    overflow-y: auto;
    overscroll-behavior: contain;
    box-shadow: none;
  }
  .tp-site-header[data-js][data-menu='open'] .tp-site-menu { animation: tp-site-sheet-in var(--tp-site-dur-base) var(--tp-site-ease-out); }

  .tp-site-header[data-js] .tp-site-nav__link {
    justify-content: space-between;
    gap: 1rem;
    min-block-size: 4.5rem;
    padding-inline: 0.125rem;
    font-family: var(--tp-font-display);
    font-weight: var(--tp-site-fw-display);
    font-size: clamp(1.875rem, 1.4rem + 2.4vw, 2.5rem);
    line-height: 1;
    letter-spacing: -0.01em;
    text-transform: uppercase;
    white-space: normal;
  }
  [dir='rtl'] .tp-site-header[data-js] .tp-site-nav__link { letter-spacing: 0; text-transform: none; line-height: var(--tp-site-lh-display-ar); }
  .tp-site-header[data-js] .tp-site-nav__link:hover { text-decoration: none; }
  .tp-site-header[data-js] .tp-site-nav__link:active { color: var(--tp-site-green-text); }
  .tp-site-header[data-js] .tp-site-nav__arrow { display: block; flex: none; inline-size: 1.5rem; block-size: 1.5rem; color: var(--tp-site-green-text); }

  .tp-site-header[data-js][data-menu='open'] .tp-site-nav__list li {
    animation: tp-site-row-in 420ms var(--tp-site-ease-out) backwards;
  }
  .tp-site-header[data-js] .tp-site-nav__list li:nth-child(2) { animation-delay: 40ms; }
  .tp-site-header[data-js] .tp-site-nav__list li:nth-child(3) { animation-delay: 80ms; }
  .tp-site-header[data-js] .tp-site-nav__list li:nth-child(4) { animation-delay: 120ms; }

  .tp-site-header[data-js] .tp-site-menu__book { display: flex; margin-block-start: auto; }
  .tp-site-header[data-js] .tp-site-tools {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    margin-block-start: -1.25rem;
  }
  .tp-site-header[data-js] .tp-site-tools > * {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    inline-size: 100%;
    block-size: auto;
    min-block-size: 3.25rem;
    padding-inline: 1rem;
    border: 1.5px solid var(--tp-site-header-border);
    border-radius: var(--tp-site-radius-btn);
    font-size: var(--tp-site-fs-sm);
    font-weight: 700;
    white-space: nowrap;
  }
  .tp-site-header[data-js] .tp-site-tools .tp-site-iconbtn::before { inset: 0; }
  .tp-site-header[data-js] .tp-site-tools .tp-icon { display: block; flex: none; inline-size: 1.25rem; block-size: 1.25rem; }
  .tp-site-header[data-js] .tp-theme-toggle__text { display: inline; font-family: var(--tp-font-body); }
}

@keyframes tp-site-sheet-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes tp-site-row-in { from { opacity: 0; transform: translateY(0.75rem); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  .tp-site-header::before, .tp-burger > span { transition: none; }
  .tp-site-header[data-js][data-menu='open'] .tp-site-menu,
  .tp-site-header[data-js][data-menu='open'] .tp-site-nav__list li { animation: none; }
}
`;

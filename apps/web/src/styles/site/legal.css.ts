/**
 * The legal pages (/privacy, /terms, /support, /delete-account) as readable documents in
 * the site family: one column at the site's measure on the page ground, a real title
 * (the old sheet sized it with an operator-only token, so the h1 rendered at body size),
 * the related-pages nav as a row of pills inside the document, generous section rhythm,
 * and the delete-account form restyled on the site tokens. Every class the pages and
 * DeleteAccountForm use is kept.
 */
export const siteLegalCss = `
.tp-legal {
  max-inline-size: calc(var(--tp-site-measure) + 2 * var(--tp-site-gutter));
  margin-inline: auto;
  padding-block: calc(var(--tp-site-header-h) + clamp(2rem, 6vw, 4.5rem)) clamp(4rem, 9vw, 7rem);
  padding-inline: var(--tp-site-gutter);
  color: var(--tp-fg);
  font-size: var(--tp-site-fs-md);
  line-height: 1.7;
}
.tp-legal__header { display: grid; gap: 0.875rem; padding-block-end: clamp(1.75rem, 4vw, 2.5rem); border-block-end: 1px solid var(--tp-border); }
.tp-legal__nav { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-block-end: clamp(1.25rem, 4vw, 2.25rem); }
.tp-legal__nav a {
  display: inline-flex;
  align-items: center;
  min-block-size: var(--tp-site-touch);
  padding-inline: 1rem;
  border: 1.5px solid var(--tp-border);
  border-radius: var(--tp-site-radius-pill);
  font-size: var(--tp-site-fs-sm);
  font-weight: 700;
  line-height: 1.2;
  text-decoration: none;
  color: var(--tp-fg);
}
@media (hover: hover) { .tp-legal__nav a:hover { border-color: var(--tp-muted-fg); } }
.tp-legal__nav a[aria-current='page'] { border-color: var(--tp-accent); background: var(--tp-accent); color: var(--tp-accent-contrast); }
.tp-legal__eyebrow { font-size: var(--tp-site-fs-xs); font-weight: var(--tp-site-fw-label); letter-spacing: var(--tp-site-track-label); text-transform: uppercase; color: var(--tp-muted-fg); }
[dir='rtl'] .tp-legal__eyebrow { letter-spacing: 0; font-size: var(--tp-site-fs-sm); }
.tp-legal__title {
  font-family: var(--tp-font-display);
  font-size: clamp(2.25rem, 1.35rem + 3.8vw, 4.25rem);
  font-weight: var(--tp-site-fw-display);
  line-height: 0.98;
  letter-spacing: var(--tp-site-track-display);
  text-transform: uppercase;
  text-wrap: balance;
}
[dir='rtl'] .tp-legal__title { text-transform: none; letter-spacing: 0; line-height: var(--tp-site-lh-display-ar); }
.tp-legal__squiggle { margin-block-start: 0.125rem; }
.tp-legal__updated { font-size: var(--tp-site-fs-sm); color: var(--tp-muted-fg); }
.tp-legal__intro { font-size: var(--tp-site-fs-lg); line-height: 1.6; color: var(--tp-site-ink-2); }
.tp-legal__section { display: grid; gap: 1rem; margin-block-start: clamp(2.25rem, 5vw, 3.25rem); scroll-margin-block-start: calc(var(--tp-site-header-h) + 1.5rem); }
.tp-legal__heading {
  font-family: var(--tp-font-display);
  font-size: var(--tp-site-fs-xl);
  font-weight: var(--tp-site-fw-display);
  line-height: 1.15;
  letter-spacing: -0.01em;
}
[dir='rtl'] .tp-legal__heading { letter-spacing: 0; line-height: 1.4; }
.tp-legal__subtitle { margin-block-start: 0.5rem; font-size: var(--tp-site-fs-lg); font-weight: var(--tp-site-fw-label); line-height: 1.3; }
.tp-legal ul { display: grid; gap: 0.625rem; padding-inline-start: 1.25rem; list-style: disc; }
.tp-legal li::marker { color: var(--tp-site-green-text); }
.tp-legal__section a:not([class]), .tp-legal__intro a { color: var(--tp-accent); font-weight: 600; text-decoration-thickness: 1px; text-underline-offset: 0.2em; }
.tp-legal strong { font-weight: 700; }
.tp-legal__phone, .tp-legal__email { direction: ltr; unicode-bidi: isolate; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--tp-accent); }
.tp-legal__hours { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1.5rem; max-inline-size: 24rem; font-variant-numeric: tabular-nums; }
.tp-legal__hours div { display: contents; }
.tp-legal__hours dt { color: var(--tp-muted-fg); }

/* /delete-account: the sign-in and confirmation form, on the site's tokens. */
.tp-legal__form { display: grid; gap: 1rem; padding: clamp(1rem, 3vw, 1.5rem); border: 1px solid var(--tp-border); border-radius: var(--tp-site-radius-md); background: var(--tp-surface); }
.tp-legal__methods { display: flex; flex-wrap: wrap; gap: 0.5rem 1.25rem; margin: 0; padding: 0; border: 0; }
.tp-legal__methods legend { margin-block-end: 0.5rem; padding: 0; font-weight: 700; }
.tp-legal__method { display: inline-flex; align-items: center; gap: 0.5rem; min-block-size: var(--tp-site-touch); }
.tp-legal__method input { inline-size: 1.25rem; block-size: 1.25rem; accent-color: var(--tp-accent); }
.tp-legal__field { display: grid; gap: 0.375rem; font-weight: 700; }
.tp-legal__input {
  inline-size: 100%;
  min-block-size: var(--tp-site-touch);
  padding-block: 0.625rem;
  padding-inline: 0.875rem;
  border: 1.5px solid var(--tp-site-border-strong);
  border-radius: var(--tp-site-radius-sm);
  background: var(--tp-site-hero-bg);
  color: var(--tp-fg);
  font: inherit;
  font-weight: 400;
}
.tp-legal__input:focus-visible { border-color: var(--tp-site-ring); }
.tp-legal__actions { display: flex; flex-wrap: wrap; gap: 0.75rem; }
.tp-legal .tp-btn {
  min-block-size: var(--tp-site-touch);
  padding-inline: 1.5rem;
  border-radius: var(--tp-site-radius-btn);
  font-weight: var(--tp-site-fw-label);
  transition: transform var(--tp-site-dur-fast) var(--tp-site-ease-out);
}
.tp-legal .tp-btn--primary { background: var(--tp-accent); color: var(--tp-accent-contrast); }
.tp-legal .tp-btn--ghost { border: 1.5px solid var(--tp-muted-fg); background: transparent; color: var(--tp-fg); }
.tp-legal .tp-legal__danger { background: var(--tp-danger); color: var(--tp-danger-contrast); }
.tp-legal__error { padding-block: 0.75rem; padding-inline: 1rem; border: 1px solid var(--tp-site-error-border); border-radius: var(--tp-site-radius-sm); background: var(--tp-site-error-bg); color: var(--tp-site-error-fg); }
@media (prefers-reduced-motion: reduce) {
  .tp-legal .tp-btn { transition: none; }
}
`;

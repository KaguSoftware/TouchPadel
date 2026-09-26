/**
 * Footer — the design's arched blue cap: an ellipse-cornered blue field that
 * closes the column, centred, with the display-face strapline, the venue line
 * and a green rule. The venue's hours and phone keep their place inside it.
 * It closes on a quiet link row (home, support, privacy, terms): body-size
 * links at full contrast (no opacity on text a guest has to read), each a 44 px
 * target, with a focus ring in the field's own foreground because the global
 * accent ring would vanish into the blue.
 */
export const footerCss = `
.tp-footer { margin-block-start: 24px; background: var(--tp-accent); color: var(--tp-accent-contrast);
  border-start-start-radius: 999px; border-start-end-radius: 999px;
  padding-block: 34px 30px; padding-inline: 28px; text-align: center; position: relative; overflow: hidden;
  font-size: var(--tp-fs-sm); }
/* The design's cap is a shallow ellipse (999px / 60px), not a half-circle. */
@supports (border-start-start-radius: 1px 1px) {
  .tp-footer { border-start-start-radius: 999px 60px; border-start-end-radius: 999px 60px; }
}
.tp-footer a { color: inherit; }
.tp-footer__inner { position: relative; display: grid; justify-items: center; gap: var(--tp-space-4); }
.tp-footer__strapline { font-family: var(--tp-font-display); font-weight: 700; font-size: 16px; }
.tp-footer__venue { font-size: 13px; opacity: 0.7; margin-block-start: 4px; }
.tp-footer__rule { inline-size: 90px; block-size: 12px; margin-block-start: 12px; }
.tp-footer__title { font-family: var(--tp-font-display); font-weight: 700; text-transform: uppercase;
  letter-spacing: var(--tp-tracking-eyebrow); font-size: var(--tp-fs-xs); opacity: 0.65; margin-block-end: 0.35rem; }
.tp-hours { display: grid; grid-template-columns: auto 1fr; gap: 0.35rem 1.25rem; text-align: start; }
.tp-hours dt { font-weight: 600; }
.tp-hours dd { margin-inline-start: 0; text-align: end; font-variant-numeric: tabular-nums; font-family: var(--tp-font-numeric); }
.tp-hours [data-today='true'] { font-weight: 800; }
.tp-footer__phone { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; font-family: var(--tp-font-numeric); }
.tp-footer__links { display: flex; flex-wrap: wrap; justify-content: center; column-gap: var(--tp-space-2);
  margin-block-start: var(--tp-space-2); padding-block-start: var(--tp-space-3);
  border-block-start: 1px solid color-mix(in srgb, currentColor 35%, transparent); inline-size: 100%; }
.tp-footer__links a { display: inline-flex; align-items: center; min-block-size: 44px; padding-inline: var(--tp-space-2);
  font-weight: 600; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
.tp-footer__links a:focus-visible { outline-color: var(--tp-accent-contrast); }
.tp-fixture { color: var(--tp-muted-fg); font-style: italic; }
`;

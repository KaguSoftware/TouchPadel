/**
 * /{locale}/account (loyalty, plan §5.2): one column at the site's measure, like the legal
 * pages, with the member card on top. The QR brings its own white paper and quiet zone (the
 * svg's `QR_PAPER` rect), so it stays black on white on the night ground too; the frame only
 * rounds its corners.
 */
export const siteAccountCss = `
.tp-acct {
  max-inline-size: calc(var(--tp-site-measure) + 2 * var(--tp-site-gutter));
  margin-inline: auto;
  padding-block: calc(var(--tp-site-header-h) + clamp(2rem, 6vw, 4.5rem)) clamp(4rem, 9vw, 7rem);
  padding-inline: var(--tp-site-gutter);
  display: grid;
  gap: clamp(1.25rem, 3vw, 1.75rem);
  color: var(--tp-fg);
  font-size: var(--tp-site-fs-md);
  line-height: 1.6;
}
.tp-acct__header { display: grid; gap: 0.75rem; }
.tp-acct__eyebrow { font-size: var(--tp-site-fs-xs); font-weight: var(--tp-site-fw-label); letter-spacing: var(--tp-site-track-label); text-transform: uppercase; color: var(--tp-muted-fg); }
[dir='rtl'] .tp-acct__eyebrow { letter-spacing: 0; font-size: var(--tp-site-fs-sm); }
.tp-acct__title {
  font-family: var(--tp-font-display);
  font-size: clamp(2.25rem, 1.35rem + 3.8vw, 4.25rem);
  font-weight: var(--tp-site-fw-display);
  line-height: 0.98;
  letter-spacing: var(--tp-site-track-display);
  text-transform: uppercase;
  text-wrap: balance;
}
[dir='rtl'] .tp-acct__title { text-transform: none; letter-spacing: 0; line-height: var(--tp-site-lh-display-ar); }
.tp-acct__intro, .tp-acct__lead { font-size: var(--tp-site-fs-lg); color: var(--tp-site-ink-2); }
.tp-acct__h2 { font-family: var(--tp-font-display); font-size: var(--tp-site-fs-xl); font-weight: var(--tp-site-fw-display); line-height: 1.15; }
[dir='rtl'] .tp-acct__h2 { line-height: 1.4; }
.tp-acct__muted { font-size: var(--tp-site-fs-sm); color: var(--tp-muted-fg); }
.tp-acct__panel, .tp-acct__card {
  display: grid;
  gap: 0.875rem;
  padding: clamp(1rem, 3vw, 1.5rem);
  border: 1px solid var(--tp-border);
  border-radius: var(--tp-site-radius-md);
  background: var(--tp-surface);
}
.tp-acct__signed-in { display: grid; gap: clamp(1.25rem, 3vw, 1.75rem); }
.tp-acct__hello { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; }

/* The member card: the QR on white paper, the countdown, the code and the phone. */
.tp-acct__card { justify-items: center; text-align: center; }
.tp-acct__qr-frame { inline-size: min(100%, 18rem); overflow: hidden; border-radius: var(--tp-site-radius-sm); }
.tp-acct__qr { display: block; inline-size: 100%; block-size: auto; }
.tp-acct__countdown { inline-size: min(100%, 18rem); block-size: 0.375rem; overflow: hidden; border-radius: var(--tp-site-radius-pill); background: var(--tp-border); }
.tp-acct__countdown-bar { display: block; block-size: 100%; background: var(--tp-accent); transition: inline-size 1s linear; }
.tp-acct__code, .tp-acct__say { display: grid; gap: 0.125rem; }
.tp-acct__label { font-size: var(--tp-site-fs-sm); color: var(--tp-muted-fg); }
.tp-acct__code-value { font-family: var(--tp-font-mono); font-size: var(--tp-site-fs-lg); font-weight: 700; letter-spacing: 0.12em; }
.tp-acct__phone { font-size: var(--tp-site-fs-xl); font-weight: 800; font-variant-numeric: tabular-nums; }

/* Points, rewards and history. */
.tp-acct__balance { font-family: var(--tp-font-display); font-size: clamp(2rem, 1.5rem + 2vw, 3rem); font-weight: var(--tp-site-fw-display); line-height: 1.1; }
.tp-acct__tier { font-weight: 700; color: var(--tp-site-green-text); }
.tp-acct__list { display: grid; }
.tp-acct__row { display: flex; justify-content: space-between; gap: 1rem; padding-block: 0.625rem; border-block-end: 1px solid var(--tp-border); }
.tp-acct__row:last-child { border-block-end: 0; }
.tp-acct__row [data-sign='minus'] { color: var(--tp-muted-fg); }
.tp-acct__date { color: var(--tp-muted-fg); font-size: var(--tp-site-fs-sm); }

/* The sign-in. */
.tp-acct__form { display: grid; gap: 1rem; }
.tp-acct__methods { display: flex; flex-wrap: wrap; gap: 0.5rem 1.25rem; margin: 0; padding: 0; border: 0; }
.tp-acct__methods legend { margin-block-end: 0.5rem; padding: 0; font-weight: 700; }
.tp-acct__method { display: inline-flex; align-items: center; gap: 0.5rem; min-block-size: var(--tp-site-touch); }
.tp-acct__method input { inline-size: 1.25rem; block-size: 1.25rem; accent-color: var(--tp-accent); }
.tp-acct__field { display: grid; gap: 0.375rem; font-weight: 700; }
.tp-acct__input {
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
.tp-acct__input:focus-visible { border-color: var(--tp-site-ring); }
.tp-acct__error { padding-block: 0.75rem; padding-inline: 1rem; border: 1px solid var(--tp-site-error-border); border-radius: var(--tp-site-radius-sm); background: var(--tp-site-error-bg); color: var(--tp-site-error-fg); }
.tp-acct__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: var(--tp-site-touch);
  padding-inline: 1.5rem;
  border: 1.5px solid var(--tp-muted-fg);
  border-radius: var(--tp-site-radius-btn);
  background: transparent;
  color: var(--tp-fg);
  font: inherit;
  font-weight: var(--tp-site-fw-label);
  text-decoration: none;
  cursor: pointer;
  transition: transform var(--tp-site-dur-fast) var(--tp-site-ease-out);
}
.tp-acct__btn:active { transform: scale(0.98); }
.tp-acct__btn:disabled { opacity: 0.6; cursor: default; }
.tp-acct__btn--primary { border-color: var(--tp-accent); background: var(--tp-accent); color: var(--tp-accent-contrast); }
.tp-acct__back { justify-self: start; }
.tp-acct__oauth { display: grid; gap: 0.625rem; }
.tp-acct__or { text-align: center; color: var(--tp-muted-fg); font-size: var(--tp-site-fs-sm); }
.tp-acct__link { color: var(--tp-accent); font-weight: 600; text-underline-offset: 0.2em; }
@media (prefers-reduced-motion: reduce) {
  .tp-acct__btn, .tp-acct__countdown-bar { transition: none; }
}
`;

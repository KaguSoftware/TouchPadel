/**
 * `#faq`, "Your first visit": the page-title treatment (900 caps + the green squiggle,
 * style reference §4.2 A) on one side, sticky on wide screens; the questions on the
 * other, each a native `<details>` on a hairline, its whole row the target. The plus
 * turns a quarter into a cross when open; the answer rises in (motion.css.ts).
 */
export const siteFaqCss = `
.tp-faq { background: var(--tp-site-hero-bg); padding-block: var(--tp-site-section-pad); }
.tp-faq__inner {
  display: grid;
  gap: clamp(2rem, 5vw, 3rem);
  max-inline-size: var(--tp-site-max);
  margin-inline: auto;
  padding-inline: var(--tp-site-gutter);
}
.tp-faq__head { display: grid; gap: 1rem; align-content: start; }
.tp-faq__title {
  font-family: var(--tp-font-display);
  font-size: var(--tp-site-fs-2xl);
  font-weight: var(--tp-site-fw-display);
  line-height: 0.95;
  letter-spacing: var(--tp-site-track-display);
  text-transform: uppercase;
  color: var(--tp-site-display-1);
  text-wrap: balance;
}
[dir='rtl'] .tp-faq__title { text-transform: none; letter-spacing: 0; line-height: var(--tp-site-lh-display-ar); }
.tp-faq__list { border-block-start: 1px solid var(--tp-border); }
.tp-faq__item { border-block-end: 1px solid var(--tp-border); }
.tp-faq__q {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.25rem;
  min-block-size: 4rem;
  padding-block: 1rem;
  padding-inline: 0.75rem;
  font-size: var(--tp-site-fs-lg);
  font-weight: 700;
  line-height: 1.3;
  list-style: none;
  cursor: pointer;
}
.tp-faq__q::-webkit-details-marker { display: none; }
.tp-faq__q:focus-visible { outline-offset: 0; border-radius: var(--tp-site-radius-sm); }
.tp-faq__mark {
  flex: none;
  inline-size: 1.75rem;
  block-size: 1.75rem;
  color: var(--tp-site-green-text);
  transition: transform var(--tp-site-dur-base) var(--tp-site-ease-out);
}
.tp-faq__item[open] .tp-faq__mark { transform: rotate(45deg); }
.tp-faq__a {
  max-inline-size: 58ch;
  padding-block-end: 1.5rem;
  /* In line with the question, so the focus ring never touches its first letter. */
  padding-inline: 0.75rem 3rem;
  color: var(--tp-site-ink-2);
  text-wrap: pretty;
}
@media (hover: hover) {
  .tp-faq__q:hover span { text-decoration-line: underline; text-decoration-thickness: 2px; text-underline-offset: 0.3em; }
}
@media (min-width: 60rem) {
  .tp-faq__inner { grid-template-columns: minmax(0, 0.75fr) minmax(0, 1.25fr); column-gap: clamp(3rem, 7vw, 7rem); }
  .tp-faq__head { position: sticky; inset-block-start: calc(var(--tp-site-header-h) + 2.5rem); align-self: start; }
}
@media (prefers-reduced-motion: reduce) {
  .tp-faq__mark { transition: none; }
}
`;

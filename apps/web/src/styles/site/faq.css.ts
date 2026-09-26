/**
 * `#faq`, "Your first visit": the page-title treatment (900 caps + the green squiggle,
 * style reference §4.2 A) and a lead line on one side; the
 * questions on the other as a stack of numbered cards, each a native `<details>` whose
 * whole row is the target.
 *
 * A closed card sits on the band ground with the card shadow; hover lifts it a little.
 * Opening it floods it Touch Blue (a layer under the content fading in, so only opacity
 * and transform ever animate) and re-scopes its ink to the dark-ground set, the number
 * turns green and the green plus chip turns a quarter into a cross. The answer rises in
 * (motion.css.ts). The poster-black "still wondering?" card, court-line bands behind it
 * and the green WhatsApp button, follows the stack on a phone; on a wide screen it sits in
 * the title's column, under the title and stretched down to the last question (grid areas; the source order stays title,
 * questions, card, so the tab order matches a phone's).
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
.tp-faq__lead {
  max-inline-size: 30ch;
  margin-block-start: 0.5rem;
  font-size: var(--tp-site-fs-lg);
  line-height: 1.45;
  color: var(--tp-site-ink-2);
  text-wrap: pretty;
}

.tp-faq__list { display: grid; gap: 0.75rem; }
.tp-faq__item {
  position: relative;
  isolation: isolate;
  border-radius: var(--tp-site-radius-md);
  background: var(--tp-site-band-bg);
  box-shadow: var(--tp-site-shadow-card);
  transition: transform var(--tp-site-dur-base) var(--tp-site-ease-out);
}
/* The Touch Blue flood, under the content. */
.tp-faq__item::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: var(--tp-site-z-below);
  border-radius: inherit;
  background: var(--tp-site-block);
  opacity: 0;
  transition: opacity var(--tp-site-dur-base) var(--tp-site-ease-out);
}
.tp-faq__item[open]::before { opacity: 1; }
.tp-faq__item[open] {
  --tp-fg: var(--tp-brand-white);
  --tp-site-ink-2: var(--tp-site-block-muted);
  --tp-site-ring: var(--tp-brand-white);
  color: var(--tp-fg);
}

.tp-faq__q {
  display: flex;
  align-items: center;
  gap: clamp(0.875rem, 2.5vw, 1.5rem);
  min-block-size: 4.5rem;
  padding-block: 1.125rem;
  padding-inline: clamp(1rem, 3vw, 1.75rem);
  border-radius: inherit;
  font-size: var(--tp-site-fs-lg);
  font-weight: 700;
  line-height: 1.3;
  list-style: none;
  cursor: pointer;
}
.tp-faq__q::-webkit-details-marker { display: none; }
.tp-faq__q:focus-visible { outline-offset: 3px; }
.tp-faq__n {
  flex: none;
  /* A fixed column, so the answer can line up with the question text below it. */
  inline-size: 3rem;
  font-family: var(--tp-font-numeric);
  font-size: clamp(1.5rem, 1.1rem + 1.4vw, 2.125rem);
  font-weight: var(--tp-site-fw-display);
  line-height: 1;
  letter-spacing: var(--tp-site-track-display);
  color: var(--tp-site-display-2);
}
.tp-faq__item[open] .tp-faq__n { color: var(--tp-brand-green); }
.tp-faq__qtext { flex: 1; min-inline-size: 0; text-wrap: balance; }
.tp-faq__mark {
  flex: none;
  display: grid;
  place-items: center;
  inline-size: 2.5rem;
  block-size: 2.5rem;
  border-radius: var(--tp-site-radius-pill);
  background: var(--tp-site-green);
  color: var(--tp-site-green-ink);
  transition: transform var(--tp-site-dur-base) var(--tp-site-ease-out);
}
.tp-faq__mark .tp-icon { inline-size: 1.25rem; block-size: 1.25rem; }
.tp-faq__item[open] .tp-faq__mark { transform: rotate(135deg); }
.tp-faq__a {
  max-inline-size: 58ch;
  padding-block: 0 1.5rem;
  /* In line with the question text: past the number and its gap. */
  padding-inline: calc(clamp(1rem, 3vw, 1.75rem) + 3rem + clamp(0.875rem, 2.5vw, 1.5rem)) clamp(1rem, 3vw, 1.75rem);
  font-size: var(--tp-site-fs-md);
  color: var(--tp-site-ink-2);
  text-wrap: pretty;
}

/* "Still wondering?": the poster black, the court-line bands behind, the green button. */
.tp-faq__ask {
  position: relative;
  isolation: isolate;
  overflow: clip;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem 1.5rem;
  min-block-size: 13rem;
  padding-block: clamp(1.75rem, 4vw, 2.5rem);
  padding-inline: clamp(1.25rem, 3vw, 2rem);
  border-radius: var(--tp-site-radius-md);
  background: var(--tp-site-poster);
}
.tp-faq__pattern { z-index: var(--tp-site-z-below); opacity: var(--tp-site-pattern-opacity-on-dark); }
.tp-faq__ask-title {
  font-family: var(--tp-font-display);
  font-size: var(--tp-site-fs-xl);
  font-weight: var(--tp-site-fw-display);
  line-height: 1.05;
  letter-spacing: var(--tp-site-track-display);
  text-transform: uppercase;
  color: var(--tp-site-display-1);
  text-wrap: balance;
}
[dir='rtl'] .tp-faq__ask-title { text-transform: none; letter-spacing: 0; line-height: var(--tp-site-lh-display-ar); }

@media (hover: hover) {
  .tp-faq__item:not([open]):hover { transform: translateY(-3px); }
  .tp-faq__item:not([open]):hover .tp-faq__mark { transform: rotate(90deg); }
}
@media (min-width: 60rem) {
  .tp-faq__inner {
    grid-template-columns: minmax(0, 0.75fr) minmax(0, 1.25fr);
    grid-template-rows: auto 1fr;
    grid-template-areas: 'head list' 'ask list';
    column-gap: clamp(3rem, 7vw, 7rem);
  }
  .tp-faq__head { grid-area: head; }
  .tp-faq__list { grid-area: list; }
  /* Down to the last question's edge: the title at the top, the button at the foot. */
  .tp-faq__ask { grid-area: ask; flex-direction: column; align-items: flex-start; justify-content: space-between; min-block-size: 18rem; }
}
@media (prefers-reduced-motion: reduce) {
  .tp-faq__item, .tp-faq__item::before, .tp-faq__mark { transition: none; }
  .tp-faq__item:not([open]):hover, .tp-faq__item:not([open]):hover .tp-faq__mark { transform: none; }
}
`;

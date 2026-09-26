/**
 * "A ball in play": quick arrival, a small settle, no bounce. Four movements only, all
 * on transform / opacity / clip-path:
 *  - load: the hero's lines rise and fade in, staggered by --tp-site-stagger (pure CSS,
 *    so it runs without JS);
 *  - reveal: each `[data-reveal]` block rises in once as it enters (Reveal.tsx arms it;
 *    before that, and without JS, everything is simply visible);
 *  - the poster words wipe in along the reading direction, one after another;
 *  - an opened FAQ answer rises into place.
 * Under prefers-reduced-motion all of it is gone and the page is still.
 */
export const siteMotionCss = `
@keyframes tp-site-rise {
  from { opacity: 0; transform: translateY(0.6em); }
  to { opacity: 1; transform: none; }
}

.tp-rise {
  animation: tp-site-rise var(--tp-site-dur-reveal) var(--tp-site-ease-out) both;
  animation-delay: calc(var(--tp-i, 0) * var(--tp-site-stagger));
}

.tp-site[data-reveal='on'] [data-reveal] {
  transition:
    opacity var(--tp-site-dur-reveal) var(--tp-site-ease-out),
    transform var(--tp-site-dur-reveal) var(--tp-site-ease-out);
}
.tp-site[data-reveal='on'] [data-reveal]:not([data-revealed]) { opacity: 0; transform: translateY(2.5rem); }

/* Poster words: a wipe from the reading edge, one after another. The WORDS BLOCK is what
   is observed (a word wiped out of view by its own clip-path never "intersects"), so the
   block itself stays put and its words carry the movement. */
.tp-events__word { clip-path: inset(-20% -8% -20% -8%); }
.tp-site[data-reveal='on'] .tp-events__words[data-reveal] { opacity: 1; transform: none; }
.tp-site[data-reveal='on'] .tp-events__words[data-reveal] .tp-events__word { transition: clip-path 900ms var(--tp-site-ease-out); }
.tp-site[data-reveal='on'] .tp-events__words[data-reveal]:not([data-revealed]) .tp-events__word { clip-path: inset(-20% 108% -20% -8%); }
[dir='rtl'] .tp-site[data-reveal='on'] .tp-events__words[data-reveal]:not([data-revealed]) .tp-events__word { clip-path: inset(-20% -8% -20% 108%); }
.tp-site[data-reveal='on'] .tp-events__word--hit { transition-delay: 110ms; }
.tp-site[data-reveal='on'] .tp-events__word--win { transition-delay: 220ms; }

.tp-faq__item[open] .tp-faq__a { animation: tp-site-rise var(--tp-site-dur-base) var(--tp-site-ease-out) both; }

@media (prefers-reduced-motion: reduce) {
  .tp-rise, .tp-faq__item[open] .tp-faq__a { animation: none; }
  .tp-site [data-reveal], .tp-events__word { transition: none; clip-path: none; }
  .tp-site[data-reveal='on'] [data-reveal]:not([data-revealed]) { opacity: 1; transform: none; clip-path: none; }
}
`;

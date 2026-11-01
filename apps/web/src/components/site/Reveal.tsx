'use client';

import { useEffect } from 'react';

/**
 * One observer for the whole page: every `[data-reveal]` element inside `.tp-site` rises
 * and fades in once, the first time it enters the viewport. Rendered once by SiteShell.
 *
 * Progressive: the server HTML has everything visible. Only once this has run does the
 * wrapper get `data-reveal="on"`, which is what lets CSS hide what has not been seen
 * yet, and anything already on screen at that moment is marked revealed FIRST, so the
 * first screen never blinks out and back. Under `prefers-reduced-motion` it does
 * nothing at all, so nothing is ever hidden.
 */
export function RevealObserver() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.tp-site');
    if (!root || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const pending = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    const reveal = (el: Element) => el.setAttribute('data-revealed', '');
    const fold = window.innerHeight * 0.92;
    const later = pending.filter((el) => {
      if (el.getBoundingClientRect().top < fold) {
        reveal(el);
        return false;
      }
      return true;
    });
    root.setAttribute('data-reveal', 'on');

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          reveal(entry.target);
          io.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
    );
    for (const el of later) io.observe(el);
    return () => io.disconnect();
  }, []);
  return null;
}

/**
 * Header scroll state: `data-scrolled` on `.tp-site-header` once the page has moved,
 * so the header can sit transparent over the hero (on home, until the hero has finished) and turn solid above content. The
 * listener is passive and only schedules a frame. No JS: the attribute never appears
 * and the header stays solid, which is readable everywhere.
 */
export function HeaderScrollState() {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>('.tp-site-header');
    if (!header) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      // The bar stays transparent until the hero it sits over has scrolled under it: the home
      // hero, or a coach link's photo tile. That tile is a card beside the text from 48rem (and
      // absent on a page with no coach), so there the bar is solid from the top.
      const kind = header.getAttribute('data-hero');
      const hero =
        kind === 'true'
          ? document.querySelector<HTMLElement>('.tp-front')
          : kind === 'tile'
            ? document.querySelector<HTMLElement>('.tp-clink__photo')
            : null;
      const solidTop =
        kind === 'tile' && (!hero || window.matchMedia('(min-width: 48rem)').matches);
      const from = hero ? hero.offsetTop + hero.offsetHeight - header.offsetHeight : 8;
      header.setAttribute('data-scrolled', solidTop || window.scrollY > from ? 'true' : 'false');
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}

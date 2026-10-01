'use client';

import { useEffect } from 'react';

/**
 * Smooth, steady `#faq` cards.
 *
 * Steady: the list reserves the height of every question closed plus the tallest answer,
 * so opening any card (the longest included) never changes the section's size and nothing
 * below it moves. Measured again when the list's width changes or the fonts arrive.
 *
 * Smooth: native `<details>` snaps; this takes over the summary click and animates the
 * card's height between its closed (summary only) and open size, the other open card
 * folding shut at the same time. With JS the shared `name` comes off and this keeps the
 * accordion exclusive itself, since the browser would otherwise snap the last card shut
 * the moment another opens. While a card folds shut it carries `data-closing`, so its blue
 * flood and cross turn back as it shrinks, not after. Under `prefers-reduced-motion` the
 * height is still reserved but the cards stay plain `<details>`.
 *
 * Progressive: without JS the cards are plain `<details>` sharing one `name`, so the
 * browser still keeps one open, and the list simply grows with the open answer.
 */
export function FaqMotion() {
  useEffect(() => {
    const list = document.querySelector<HTMLElement>('#faq .tp-faq__list');
    if (!list) return;
    const items = Array.from(list.querySelectorAll<HTMLDetailsElement>('details.tp-faq__item'));

    // The tallest answer, read by opening each closed card for one synchronous layout
    // (no frame is painted in between, so nothing flashes).
    const reserve = () => {
      let closedTotal = 0;
      let tallest = 0;
      for (const d of items) {
        const summary = d.querySelector('summary');
        const answer = d.querySelector<HTMLElement>('.tp-faq__a');
        if (!summary || !answer) continue;
        closedTotal += summary.offsetHeight;
        const wasOpen = d.open;
        if (!wasOpen) d.open = true;
        tallest = Math.max(tallest, answer.offsetHeight);
        if (!wasOpen) d.open = false;
      }
      const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
      list.style.minBlockSize = `${Math.ceil(closedTotal + gap * (items.length - 1) + tallest)}px`;
    };

    let width = 0;
    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(([entry]) => {
            const w = entry?.contentRect.width ?? 0;
            if (w === width) return;
            width = w;
            reserve();
          });
    resize?.observe(list);
    reserve();
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) reserve();
    });

    const cleanups: (() => void)[] = [];
    const animates =
      typeof Element.prototype.animate === 'function' &&
      !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (animates) cleanups.push(animateCards(list, items));

    return () => {
      live = false;
      resize?.disconnect();
      list.style.minBlockSize = '';
      for (const cleanup of cleanups) cleanup();
    };
  }, []);
  return null;
}

function animateCards(list: HTMLElement, items: HTMLDetailsElement[]) {
  const names = items.map((d) => d.getAttribute('name'));
  for (const d of items) d.removeAttribute('name');
  const running = new WeakMap<HTMLDetailsElement, Animation>();
  const duration = 320;
  const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';

  const run = (d: HTMLDetailsElement, from: number, to: number, done?: () => void) => {
    running.get(d)?.cancel();
    d.style.overflow = 'clip';
    const anim = d.animate({ blockSize: [`${from}px`, `${to}px`] }, { duration, easing });
    running.set(d, anim);
    anim.onfinish = () => {
      running.delete(d);
      d.style.overflow = '';
      done?.();
    };
  };

  const close = (d: HTMLDetailsElement) => {
    const summary = d.querySelector('summary');
    if (!summary) return;
    d.setAttribute('data-closing', '');
    run(d, d.offsetHeight, summary.offsetHeight, () => {
      d.open = false;
      d.removeAttribute('data-closing');
    });
  };

  const open = (d: HTMLDetailsElement) => {
    const from = d.offsetHeight;
    d.removeAttribute('data-closing');
    d.open = true;
    running.get(d)?.cancel();
    run(d, from, d.offsetHeight);
  };

  const onClick = (event: MouseEvent) => {
    const summary = (event.target as Element).closest('summary');
    const d = summary?.parentElement;
    if (!(d instanceof HTMLDetailsElement) || !items.includes(d)) return;
    event.preventDefault();
    if (d.open && !d.hasAttribute('data-closing')) {
      close(d);
      return;
    }
    for (const other of items) {
      if (other !== d && other.open && !other.hasAttribute('data-closing')) close(other);
    }
    open(d);
  };

  list.addEventListener('click', onClick);
  return () => {
    list.removeEventListener('click', onClick);
    items.forEach((d, i) => {
      running.get(d)?.cancel();
      d.style.overflow = '';
      d.removeAttribute('data-closing');
      const name = names[i];
      if (name) d.setAttribute('name', name);
    });
  };
}

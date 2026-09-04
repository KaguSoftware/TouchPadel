/**
 * The operator app's global stylesheet. Everything layout-specific stays
 * inline (logical properties, lint-enforced); this sheet carries what inline
 * styles cannot express: interaction states (hover / focus-visible / active /
 * disabled), keyframes, reduced-motion, print rules, and the base element
 * reset. Written with logical properties by hand — the RTL lint does not read
 * CSS strings, so every rule here must be checked by eye.
 */
import { useEffect } from 'react';

const GLOBAL_CSS = `
*, *::before, *::after { box-sizing: border-box; }
/*
 * THE RULER. The rem scale in packages/ui/src/tokens/operator.ts was authored
 * against a 16px root — DESIGN.md's "0.875 (base)" only reads 14px there. At
 * a 14px root every token silently rendered 12.5% small: body text at 12.25px
 * against the 14px arm's-length floor the same document sets, --tp-touch at
 * 38.5px against a documented 44px, and the "strict 4px scale" resolving to
 * 3.5 / 7 / 10.5 / 14 / 21 / 28. Eight independent audits of this app named
 * this one line as their highest-impact finding. Physical targets (--tp-touch,
 * --tp-row-h, --tp-tile-min-block) are px in the token file precisely so they
 * can never drift with this number again.
 */
html { font-size: 16px; }
@media (min-width: 1600px) { html { font-size: 17px; } }
body {
  margin: 0;
  background: var(--tp-bg);
  color: var(--tp-fg);
  font-family: var(--tp-font-body);
  font-size: var(--tp-fs-md, 0.875rem);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
}
[dir='rtl'] body { font-family: var(--tp-font-arabic); }
h1, h2, h3, h4 { margin: 0; line-height: 1.25; letter-spacing: -0.01em; }
p { margin: 0; }
a { color: var(--tp-accent); }
a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible,
textarea:focus-visible, [tabindex]:focus-visible {
  outline: 2px solid var(--tp-accent);
  outline-offset: 2px;
}
input, select, textarea, button { font: inherit; color: inherit; }
input, select, textarea {
  transition: border-color var(--tp-dur-fast) var(--tp-ease-out), box-shadow var(--tp-dur-fast) var(--tp-ease-out);
}
input:focus-visible, select:focus-visible, textarea:focus-visible {
  outline: none;
  border-color: var(--tp-accent) !important;
  box-shadow: var(--tp-ring);
}
input::placeholder, textarea::placeholder { color: var(--tp-muted-fg); }
input[type='date'], input[type='time'], input[type='number'] { font-variant-numeric: tabular-nums; }
::selection { background: var(--tp-accent-soft); }
* { scrollbar-width: thin; scrollbar-color: var(--tp-border-strong) transparent; }
/* A boundary you must see to operate. Applies to bare controls; components
   using inputStyle get it from the token directly. */
input, select, textarea { border-color: var(--tp-border-input); }
input:disabled, select:disabled, textarea:disabled {
  background: var(--tp-disabled-bg);
  color: var(--tp-disabled-fg);
  border-color: var(--tp-border);
  cursor: not-allowed;
}

/* ---- buttons (components/ui.tsx Button) ---- */
.tp-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.45rem;
  border: 1px solid var(--tp-border-strong);
  background: var(--tp-surface);
  color: var(--tp-fg);
  border-radius: var(--tp-radius-ctl);
  padding-block: 0.45rem; padding-inline: 0.85rem;
  font-size: var(--tp-fs-md); font-weight: 600; line-height: 1.25;
  min-block-size: 2.25rem;
  cursor: pointer; user-select: none; white-space: nowrap;
  /* 'transform' is deliberately NOT in this list: the :active nudge below
     must land on the frame of the press. Easing it in over 160ms reads as
     lag on the till, which is the highest-frequency surface in the venue. */
  transition: background var(--tp-dur-fast) var(--tp-ease-out), border-color var(--tp-dur-fast) var(--tp-ease-out), color var(--tp-dur-fast) var(--tp-ease-out);
}
.tp-btn:hover:not(:disabled) { background: var(--tp-surface-2); border-color: var(--tp-muted-fg); }
.tp-btn:active:not(:disabled) { transform: translateY(1px); }
.tp-btn:disabled { cursor: not-allowed; opacity: var(--tp-opacity-disabled); }
.tp-btn[data-busy='true'] { cursor: progress; }
.tp-btn[data-kind='primary'] { background: var(--tp-accent); border-color: var(--tp-accent); color: var(--tp-accent-contrast); }
.tp-btn[data-kind='primary']:hover:not(:disabled) { background: var(--tp-accent-hover); border-color: var(--tp-accent-hover); }
/* --tp-accent-active existed in the token file and was used by zero rules. */
.tp-btn[data-kind='primary']:active:not(:disabled) { background: var(--tp-accent-active); border-color: var(--tp-accent-active); }
.tp-btn[data-kind='danger'] { background: var(--tp-danger); border-color: var(--tp-danger); color: var(--tp-danger-contrast); }
.tp-btn[data-kind='danger']:hover:not(:disabled) { filter: brightness(0.92); }
.tp-btn[data-kind='ghost'] { background: transparent; border-color: transparent; }
.tp-btn[data-kind='ghost']:hover:not(:disabled) { background: var(--tp-surface-3); border-color: transparent; }
.tp-btn[data-kind='soft'] { background: var(--tp-accent-soft); border-color: transparent; color: var(--tp-accent-soft-fg); }
.tp-btn[data-kind='soft']:hover:not(:disabled) { background: var(--tp-info-soft); filter: brightness(0.97); }
.tp-btn[data-size='sm'] { min-block-size: 1.85rem; padding-block: 0.25rem; padding-inline: 0.6rem; font-size: var(--tp-fs-sm); }
.tp-btn[data-size='lg'] { min-block-size: var(--tp-touch); padding-block: 0.6rem; padding-inline: 1.1rem; font-size: var(--tp-fs-lg); }
.tp-btn[data-size='xl'] { min-block-size: 3.5rem; padding-block: 0.8rem; padding-inline: 1.4rem; font-size: var(--tp-fs-xl); border-radius: var(--tp-radius-panel); }
.tp-btn[aria-pressed='true'] { background: var(--tp-accent-soft); border-color: var(--tp-accent); color: var(--tp-accent-soft-fg); }
/* Without this, a toggle carrying BOTH aria-pressed and data-kind='primary'
   renders soft at rest and flips to solid accent on hover, because the
   :hover rule above out-specifies the bare attribute selector. */
.tp-btn[aria-pressed='true']:hover:not(:disabled) { background: var(--tp-accent-soft); border-color: var(--tp-accent); color: var(--tp-accent-soft-fg); filter: brightness(0.97); }
.tp-iconbtn { padding-inline: 0.45rem; inline-size: 2.25rem; }
.tp-iconbtn[data-size='sm'] { inline-size: 1.85rem; }
/* Fingers, not mice: the till and the kitchen board get the real target. */
[data-workspace='cashier'] .tp-iconbtn, [data-workspace='prep'] .tp-iconbtn {
  inline-size: var(--tp-touch); min-block-size: var(--tp-touch);
}

.tp-req::after {
  content: '*';
  color: var(--tp-danger);
  margin-inline-start: var(--tp-sp-1);
}

/* ---- generic interactive surfaces ---- */
.tp-row { transition: background var(--tp-dur-fast) var(--tp-ease-out); }
.tp-row[data-clickable='true'] { cursor: pointer; }
.tp-row[data-clickable='true']:hover { background: var(--tp-surface-2); }
.tp-row[data-selected='true'] { background: var(--tp-accent-soft); }
.tp-tile {
  cursor: pointer; text-align: start;
  /* Same reason as .tp-btn: no 'transform' in the transition list. */
  transition: background var(--tp-dur-fast) var(--tp-ease-out), border-color var(--tp-dur-fast) var(--tp-ease-out);
}
.tp-tile:hover:not(:disabled) { border-color: var(--tp-accent); background: var(--tp-accent-soft); }
.tp-tile:active:not(:disabled) { transform: scale(0.99); }
.tp-tile:disabled { cursor: not-allowed; }
.tp-link { color: var(--tp-accent); text-decoration: none; }
.tp-link:hover { text-decoration: underline; }

/* ---- navigation rail ---- */
.tp-nav-item {
  display: flex; align-items: center; gap: 0.6rem;
  padding-block: 0.5rem; padding-inline: 0.7rem;
  border-radius: var(--tp-radius-ctl);
  color: var(--tp-rail-fg); text-decoration: none; font-weight: 500;
  min-block-size: var(--tp-touch);
  transition: background var(--tp-dur-fast) var(--tp-ease-out), color var(--tp-dur-fast) var(--tp-ease-out);
}
.tp-nav-item:hover { background: var(--tp-rail-2); }
.tp-nav-item[data-active='true'] { background: var(--tp-rail-active); color: var(--tp-rail-fg-active); font-weight: 700; }
.tp-nav-item:focus-visible { outline-color: var(--tp-rail-green); }
.tp-nav-item svg { opacity: 0.85; }
.tp-nav-item[data-active='true'] svg { opacity: 1; color: var(--tp-rail-green); }

/* ---- tables ---- */
.tp-table { inline-size: 100%; border-collapse: separate; border-spacing: 0; font-variant-numeric: tabular-nums; }
.tp-table th {
  position: sticky; inset-block-start: 0; z-index: var(--tp-z-table-head);
  background: var(--tp-surface-2); color: var(--tp-muted-fg);
  /* Was 12px ALL-CAPS with tracking — the worst case for a bright venue at
     arm's length, and rulebook 6.2 wants the header to read as the same words
     as the field on the detail page. Weight and colour carry it instead. */
  font-size: var(--tp-fs-sm); font-weight: 600;
  text-align: start; padding-block: 0.45rem; padding-inline: 0.75rem;
  border-block-end: 1px solid var(--tp-border);
  white-space: nowrap;
}
/* One floor, one place. rulebook 6.8 wants >=40px; this used to be whatever
   the padding happened to add up to (~32px). */
.tp-table td { block-size: var(--tp-row-h); padding-block: 0.45rem; padding-inline: 0.75rem; border-block-end: 1px solid var(--tp-border); vertical-align: middle; }
.tp-table tr:last-child td { border-block-end: none; }
.tp-table [data-align='end'] { text-align: end; }
.tp-table [data-align='center'] { text-align: center; }
.tp-table th[data-sortable='true'] { cursor: pointer; }
.tp-table th[data-sortable='true']:hover { color: var(--tp-fg); }
.tp-table tbody tr[data-clickable='true'] { cursor: pointer; }
.tp-table tbody tr[data-clickable='true']:hover td { background: var(--tp-surface-2); }
.tp-table tbody tr[data-selected='true'] td { background: var(--tp-accent-soft); }
.tp-table[data-dense='true'] td { block-size: var(--tp-row-h-dense); padding-block: 0.25rem; }

/* ---- kitchen board ---- */
[data-workspace='prep'] { background: var(--tp-kds-bg); color: var(--tp-kds-fg); }
[data-workspace='prep'] .tp-btn { background: var(--tp-kds-card-2); border-color: var(--tp-kds-border); color: var(--tp-kds-fg); }
[data-workspace='prep'] .tp-btn[data-kind='primary'] { background: var(--tp-kds-fresh); border-color: var(--tp-kds-fresh); color: var(--tp-brand-black); }
[data-workspace='prep'] .tp-btn:hover:not(:disabled) { filter: brightness(1.1); }
[data-workspace='prep'] :focus-visible { outline-color: var(--tp-kds-fg); }
[data-workspace='prep'] input[type='checkbox'] { accent-color: var(--tp-kds-fresh); }
[data-workspace='prep'] kbd { background: var(--tp-kds-card-2); border-color: var(--tp-kds-border); color: var(--tp-kds-muted); }
/* The light-theme scrollbar painted a near-white bar down a 16%-lightness board. */
[data-workspace='prep'] * { scrollbar-color: var(--tp-kds-border) transparent; }
[data-workspace='prep'] ::selection { background: var(--tp-kds-card-2); color: var(--tp-kds-fg); }
[data-workspace='prep'] .tp-skel { background: var(--tp-kds-card-2); }
[data-workspace='prep'] .tp-skel::after { background: linear-gradient(90deg, transparent, var(--tp-kds-border), transparent); }

/* ---- keyframes ---- */
@keyframes tpPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
@keyframes tpSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes tpFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes tpRise { from { opacity: 0; transform: translateY(var(--tp-rise)); } to { opacity: 1; transform: none; } }
/* The skeleton sweep. Travels along the reading direction, so it mirrors in
   Arabic off --tp-dir-sign like tpMarquee does, and it moves a transform
   rather than a background-position so it stays off the paint path. */
@keyframes tpSweep {
  from { transform: translateX(calc(-100% * var(--tp-dir-sign, 1))); }
  to   { transform: translateX(calc(100% * var(--tp-dir-sign, 1))); }
}
@keyframes tpMarquee {
  from { transform: translateX(calc(100% * var(--tp-dir-sign, 1))); }
  to { transform: translateX(calc(-100% * var(--tp-dir-sign, 1))); }
}
.tp-rise { animation: tpRise var(--tp-dur-base) var(--tp-ease-out) both; }
.tp-fade { animation: tpFadeIn var(--tp-dur-base) var(--tp-ease-out) both; }

/* Indeterminate progress. '.tp-ball-spin' is referenced by components/brand.tsx
   (BrandBall spin) and had no rule at all, so the brand ball was silently
   frozen wherever it was asked to turn. */
.tp-spin, .tp-ball-spin { animation: tpSpin var(--tp-dur-spin) linear infinite; transform-origin: 50% 50%; }

/* The one sanctioned attention loop: a stale ticket, an escalated waiter call,
   a connection still being made. Every period now agrees — four files each
   hardcoded their own 1.2s or 1.4s and they beat against each other on the
   same screen. */
.tp-attention { animation: tpPulse var(--tp-dur-attention) ease-in-out infinite; }

/* Loading. The block itself is a static ground; the sweep is an overlay child,
   so nothing that carries text ever changes opacity. */
.tp-skel { position: relative; overflow: hidden; background: var(--tp-skeleton); }
.tp-skel::after {
  content: ''; position: absolute; inset-block: 0; inset-inline: 0;
  background: linear-gradient(90deg, transparent, var(--tp-surface), transparent);
  opacity: 0.65;
  animation: tpSweep 1400ms var(--tp-ease-out) infinite;
}

/* The app had no visually-hidden utility, which is why several loading and
   empty states announce nothing at all. */
.tp-sr-only {
  position: absolute; inline-size: 1px; block-size: 1px;
  margin: -1px; padding: 0; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap; border: 0;
}

/* ChevronForward / ChevronBack are straight aliases that flip nothing, so every
   "open" and "next" affordance pointed backwards in Arabic. */
[dir='rtl'] svg[data-chevron] { transform: scaleX(-1); }

/*
 * The sign-in swoosh settling in. The ONLY consumer of --tp-dur-ceremony in
 * the codebase: 'grep -rn dur-ceremony apps/' must return one CSS rule and
 * one token declaration. It runs inside an aria-hidden aside, is delayed
 * behind the lockup so it reads as arriving second, and must never hold up
 * the autofocused email field.
 *
 * Inline-axis travel multiplies by --tp-dir-sign, the same mechanism tpMarquee
 * uses, so Arabic mirrors it without a second rule.
 */
@keyframes tpSwooshIn {
  from { opacity: 0; transform: translateX(calc(4% * var(--tp-dir-sign, 1))); }
  to   { opacity: 1; transform: none; }
}
.tp-swoosh-in {
  animation: tpSwooshIn var(--tp-dur-ceremony) var(--tp-ease-settle) 90ms both;
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
  /*
   * The blanket rule above stops an INDETERMINATE progress indicator dead: one
   * 0.01ms rotation, then a frozen broken arc still carrying role="status".
   * On a reduced-motion station the boot screen, every busy Button and every
   * async wrapper showed a dead glyph while the app was working. A slow
   * constant rotation is the accepted treatment; the sweep is decorative and
   * stays off.
   */
  .tp-spin, .tp-ball-spin {
    animation-duration: 1800ms !important;
    animation-iteration-count: infinite !important;
  }
  .tp-skel::after { display: none; }
}

/* ---- print ---- */
@media print {
  [data-no-print] { display: none !important; }
  body { background: var(--tp-brand-white); overflow: visible; }
  body[data-print="a6"] { margin: 0; }
  body[data-print="a6"] [data-print-page] {
    inline-size: 105mm;
    block-size: 148mm;
    overflow: hidden;
    break-after: page;
    page-break-after: always;
  }
}
`;

/** `@page` cannot be scoped by a selector, so it is injected only while body[data-print="a6"]. */
const A6_PAGE_CSS = '@page { size: A6 portrait; margin: 0; }';
const A6_STYLE_ID = 'tp-page-a6';

export type PrintMode = 'a6';

export function GlobalStyles() {
  useEffect(() => {
    const el = document.createElement('style');
    el.id = A6_STYLE_ID;
    el.textContent = A6_PAGE_CSS;
    const sync = () => {
      const on = document.body.dataset.print === 'a6';
      if (on && !el.isConnected) document.head.appendChild(el);
      else if (!on && el.isConnected) el.remove();
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-print'] });
    sync();
    return () => {
      observer.disconnect();
      el.remove();
    };
  }, []);
  return <style>{GLOBAL_CSS}</style>;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Print with a page mode: sets `body[data-print]`, waits a frame so the
 * `@page` rule and print CSS apply, opens the print dialog, then clears.
 */
export async function printWithMode(mode: PrintMode): Promise<void> {
  document.body.dataset.print = mode;
  try {
    await nextFrame();
    window.print();
  } finally {
    delete document.body.dataset.print;
  }
}

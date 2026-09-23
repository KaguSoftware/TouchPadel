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
  /* Figures line up column to column across the whole app: a price whose digits
     shift by a pixel as the total ticks is what a cashier reads as a wrong
     number. The brand family ships a real tnum feature, so this is the
     declaration that does the work; the forty-odd cells and spans repeating it
     locally are belt and braces, and no surface anywhere asks for proportional
     figures. Arabic-Indic digits are covered too — the same faces carry them. */
  font-variant-numeric: tabular-nums;
  overflow: hidden;
}
/* A no-op today — --tp-font-arabic and --tp-font-body resolve to the same face,
   because the brand family carries both scripts. Kept for the reason
   packages/ui/src/theme.ts keeps its equivalent: the token is the name the app
   uses for "set this in Arabic", and the two stacks' FALLBACK tails are allowed
   to diverge again, at which point this rule is the only thing that would make
   an unpainted Arabic frame legible. Deleting it costs nothing today and costs
   a silent regression the day the tails differ. */
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
/* The native dropdown arrow is painted by the platform in its OWN fixed
   gutter, OUTSIDE the author padding box — so padding-inline-end widens the
   control without ever moving the glyph off the border. The only way to place
   it is to drop the native control and draw the chevron ourselves.

   The SVG is inlined url-encoded rather than base64, so the markup stays
   readable and greppable. Its stroke is a fixed slate grey (%2364748b): a
   background-image cannot read currentColor, and that one grey carries
   enough contrast against both the light and the blue-mode --tp-surface,
   which a theme-swapped pair of declarations would only complicate.

   RTL: background-position is physical, so the chevron is re-anchored to the
   left edge under [dir='rtl'] rather than relying on a logical keyword that
   background-position does not accept. Padding stays logical and flips on its
   own.

   Every declaration here carries !important for one reason: inputStyle is
   applied as an INLINE style, and it sets both paddingInline and the
   background SHORTHAND — which resets background-image to none. Without
   !important the chevron would never paint on any control using inputStyle,
   which is nearly all of them. */
select {
  -webkit-appearance: none; appearance: none;
  padding-inline-end: 2rem !important;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5 6 6.5 11 1.5' stroke='%2364748b' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") !important;
  background-repeat: no-repeat !important;
  background-position: right 0.7rem center !important;
  background-size: 12px 8px !important;
}
[dir='rtl'] select { background-position: left 0.7rem center !important; }
/* A disabled control's chevron must fade with the rest of it. */
select:disabled { opacity: 0.85; }
/* Multi-selects and sized list boxes are not dropdowns: no arrow, no gutter. */
select[multiple], select[size]:not([size='1']) {
  background-image: none !important;
  padding-inline-end: 0.65rem !important;
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
  /* line-height 1 on the LABEL's own box, not 1.25: a bare text node inside
     this inline-flex forms an anonymous inline box sized by the font's ascent
     and descent, which are asymmetric — the descent reserves room for a 'g'
     that "Void" does not have. At 1.25 that box is taller than the glyphs and
     centring it left the icon beside them riding high. The button keeps its
     height from padding and min-block-size, so nothing resizes. */
  font-size: var(--tp-fs-md); font-weight: 600; line-height: 1;
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
/* The background is RE-DECLARED, not merely darkened. The plain hover rule above
   scores one pseudo-class higher than the bare [data-kind='danger'] attribute, so
   on hover it repainted a danger button in --tp-surface-2 while
   --tp-danger-contrast (white) stayed on the label — the destructive control went
   unreadable at the exact moment a finger was on it. Every other kind already
   restates its own ground here; danger was the one that only asked for a filter. */
.tp-btn[data-kind='danger']:hover:not(:disabled) { background: var(--tp-danger); border-color: var(--tp-danger); filter: brightness(0.92); }
.tp-btn[data-kind='ghost'] { background: transparent; border-color: transparent; }
.tp-btn[data-kind='ghost']:hover:not(:disabled) { background: var(--tp-surface-3); border-color: transparent; }
.tp-btn[data-kind='soft'] { background: var(--tp-accent-soft); border-color: transparent; color: var(--tp-accent-soft-fg); }
.tp-btn[data-kind='soft']:hover:not(:disabled) { background: var(--tp-info-soft); filter: brightness(0.97); }
.tp-btn[data-size='sm'] { min-block-size: 1.85rem; padding-block: 0.25rem; padding-inline: 0.6rem; font-size: var(--tp-fs-sm); }
.tp-btn[data-size='lg'] { min-block-size: var(--tp-touch); padding-block: 0.6rem; padding-inline: 1.1rem; font-size: var(--tp-fs-lg); }
.tp-btn[data-size='xl'] { min-block-size: 3.5rem; padding-block: 0.8rem; padding-inline: 1.4rem; font-size: var(--tp-fs-xl); border-radius: var(--tp-radius-panel); }
/* The page's own "add" action (New rule, New product…) is the one thing on the
   header an owner reaches for, so a default-size primary there renders at lg. */
.tp-page-actions .tp-btn[data-kind='primary'][data-size='md']:not(.tp-iconbtn) { min-block-size: var(--tp-touch); padding-block: 0.6rem; padding-inline: 1.25rem; font-size: var(--tp-fs-lg); }
.tp-page-actions .tp-btn[data-kind='primary'][data-size='md']:not(.tp-iconbtn) svg { inline-size: 20px; block-size: 20px; }
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
/* The report switcher (features/reports/ReportTabs). Filled when open, so the
   current report reads from across the room, not from a 2px underline. */
.tp-report-tab {
  display: flex; align-items: center; gap: var(--tp-sp-2);
  padding-block: var(--tp-sp-2); padding-inline: var(--tp-sp-2) var(--tp-sp-3);
  border: 1px solid var(--tp-border); border-radius: var(--tp-radius-ctl);
  background: var(--tp-surface); color: var(--tp-fg);
  font: inherit; font-size: var(--tp-fs-md); font-weight: 600; text-align: start;
  cursor: pointer; min-inline-size: 0;
  transition: background var(--tp-dur-fast) var(--tp-ease-out), border-color var(--tp-dur-fast) var(--tp-ease-out), color var(--tp-dur-fast) var(--tp-ease-out);
}
.tp-report-tab:hover:not([aria-selected='true']) { border-color: var(--tp-accent); background: var(--tp-accent-soft); }
.tp-report-tab[aria-selected='true'] { background: var(--tp-accent); border-color: var(--tp-accent); color: var(--tp-accent-contrast); cursor: default; }
.tp-report-tab-icon {
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  inline-size: 2rem; block-size: 2rem; border-radius: 50%;
  background: var(--tp-accent-soft); color: var(--tp-accent-soft-fg);
}
.tp-report-tab[aria-selected='true'] .tp-report-tab-icon { background: color-mix(in srgb, var(--tp-accent-contrast) 20%, transparent); color: inherit; }
.tp-link { color: var(--tp-accent); text-decoration: none; }
.tp-link:hover { text-decoration: underline; }

/* ---- info tip (components/InfoTip.tsx) ---- */
/* Always mounted so aria-describedby resolves while closed; hidden by
   visibility + opacity, never display, and only opacity transitions: the
   operator caused it, so nothing may move (DESIGN.md Motion). Geometry and
   surface tokens are inline on the instance; this is the state machine. */
.tp-infotip {
  /* Above --tp-z-menu: a tip can be opened from inside a menu's panel. */
  position: fixed; z-index: var(--tp-z-tooltip);
  visibility: hidden; opacity: 0; pointer-events: none;
  transition: opacity var(--tp-dur-fast) var(--tp-ease-out);
}
.tp-infotip[data-open='true'] { visibility: visible; opacity: 1; pointer-events: auto; }
.tp-infotip-trigger { color: var(--tp-muted-fg); }
.tp-infotip-trigger:hover:not(:disabled), .tp-infotip-trigger:focus-visible { color: var(--tp-fg); }

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
/* A .tp-btn standing ON the rail (the rail foot's Sign out). .tp-btn's ground
   is --tp-surface/--tp-fg, which are the LIGHT tokens: on a 25%-lightness rail
   that paints a white chip. This restates the same three properties in the
   rail's own palette, and takes the rail's hover ground rather than .tp-btn's,
   so it answers a finger the way the rows above it do. In CSS, not inline,
   because an inline background would outrank every :hover rule there is. */
.tp-rail-btn.tp-btn { background: transparent; border-color: var(--tp-rail-border); color: var(--tp-rail-fg); }
.tp-rail-btn.tp-btn:hover:not(:disabled) { background: var(--tp-rail-2); border-color: var(--tp-rail-active); color: var(--tp-rail-fg-active); filter: none; }
.tp-rail-btn.tp-btn:focus-visible { outline-color: var(--tp-rail-green); }
/* A collapsible rail group's title (routes/__root.tsx RailGroup). It is set as
   a rail ROW, not a caption: Operations is the only workspace that uses these
   groups, so when this was small-caps/xs/muted it was the one rail in the app
   whose top-level entries did not match Management's section rows beside it —
   which reads as a different font, not as a heading. It keeps .tp-nav-item's
   size and weight and only the chevron marks it as something that opens. */
.tp-rail-group { color: var(--tp-rail-fg); }
.tp-rail-group:hover, .tp-rail-group[aria-expanded='true'] { color: var(--tp-rail-fg); }
.tp-rail-group-chevron { transition: transform var(--tp-dur-fast) var(--tp-ease-out); }
.tp-rail-group[aria-expanded='false'] .tp-rail-group-chevron { transform: rotate(-90deg); }
[dir='rtl'] .tp-rail-group[aria-expanded='false'] .tp-rail-group-chevron { transform: rotate(90deg); }
.tp-rail-group-body {
  display: grid; grid-template-rows: 0fr;
  transition: grid-template-rows var(--tp-dur-base) var(--tp-ease-settle);
}
.tp-rail-group-body[data-open='true'] { grid-template-rows: 1fr; }
/* Options' four rows read as children of the row that opens them (owner call,
   2026-09-21). They used to sit flush with their own title, so the open drawer
   was one undifferentiated column and the title was told apart only by its
   chevron. They step in by one --tp-sp-3 with a hairline stem down the group:

     Options
       │  Switch workspace
       │  Assistant

   Scoped to OPTIONS, not to .tp-rail-group-body: the workspace's own groups
   (Run the day, Records, Setup) hold destinations you navigate to and stay
   flush, so the indent means "these belong to the row above", not "these are
   nested rows". The stem is a ::before rather than a border-inline-start, so it
   stops at the last row instead of running through the padding above it, and
   inset-inline-start makes RTL mirror it for free. It is marked on the LIST and
   not on the animating body, which owns the 0fr->1fr track: padding there would
   leave the shut drawer a few pixels tall instead of nothing. */
.tp-rail-options-list {
  position: relative;
  padding-inline-start: var(--tp-sp-3);
}
.tp-rail-options-list::before {
  content: ''; position: absolute;
  inset-block: 0.25rem; inset-inline-start: calc(var(--tp-sp-3) / 2);
  inline-size: 1px; background: var(--tp-rail-border);
}
.tp-nav-item[data-active='true'] svg { opacity: 1; color: var(--tp-rail-green); }
/* The way out of a section rail.
   It used to be styled as the quietest thing on the rail — 11px, --tp-rail-muted,
   no surface — on the theory that leaving is not a destination. That reasoning
   is backwards for a SUBpanel: Setup and Operations are places you pass through,
   so this is the single most-pressed control in the workspace, and it was
   rendering smaller and fainter than every row it sits above. It is now a
   control on the same 44px floor as .tp-nav-item, on the rail's raised surface,
   in white — still visually distinct from a destination (bordered, above the
   divider, chevron leading) without being the faintest thing on the panel. */
.tp-rail-back {
  display: flex; align-items: center; gap: 0.5rem;
  inline-size: 100%;
  padding-block: 0.4rem; padding-inline: 0.7rem;
  min-block-size: var(--tp-touch);
  border: 1px solid var(--tp-rail-border);
  border-radius: var(--tp-radius-ctl);
  background: var(--tp-rail-2);
  color: var(--tp-brand-white);
  font-size: var(--tp-fs-sm); font-weight: 600;
  text-decoration: none;
  transition: background var(--tp-dur-fast) var(--tp-ease-out), border-color var(--tp-dur-fast) var(--tp-ease-out);
}
.tp-rail-back:hover { background: var(--tp-rail-active); border-color: var(--tp-rail-green); }
/* Same frame-of-the-press nudge as .tp-btn, and for the same reason. */
.tp-rail-back:active { transform: translateY(1px); }
.tp-rail-back:focus-visible { outline-color: var(--tp-rail-green); }
/* No transform here: [dir='rtl'] svg[data-chevron] owns the chevron's, and a
   hover nudge would overwrite the mirror and point the arrow the wrong way in
   Arabic. Colour is the whole affordance. */
.tp-rail-back svg { color: var(--tp-rail-green); }

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

/* ---- live floor: the zoom track beside the two step buttons ----
   A native range input keeps the keyboard, touch and slider semantics; only
   the paint is ours, and the thumb can only be reached from real CSS. The
   track fill is an inline gradient (it follows the value), so the rule below
   only has to flip it under RTL, where "closer" sits on the other side. */
.tp-floor-zoom {
  -webkit-appearance: none; appearance: none;
  border-radius: 999px; border: 1px solid var(--tp-border);
  /* Every paint the track and the thumb use, named here so blue mode can pin
     them to the paper values. On paper --tp-accent is the brand blue and the
     surfaces are near-white, which is the look the owner wants in BOTH modes
     (2026-09-22): blue fill and blue thumb on a pale track. Left to the
     tokens, blue mode inverted it — there --tp-accent IS white and the
     surfaces are blue, so the slider came out white-on-blue. */
  --tp-zoom-fill: var(--tp-accent);
  --tp-zoom-track: var(--tp-border);
  --tp-zoom-thumb: var(--tp-accent);
  --tp-zoom-thumb-ring: var(--tp-surface);
  border-color: var(--tp-zoom-track);
  /* Upright, running 0 at the bottom to 100 at the top. This pair is what
     tells the BROWSER the slider is vertical — so Up and Right both move
     toward 100, and the hit box matches the drawn box. A rotate() would do
     neither. direction:rtl is what puts 100 at the top rather than the
     bottom; it is the writing mode's own axis, not the page's, so it is
     identical in Arabic and never mirrors. */
  writing-mode: vertical-lr;
  direction: rtl;
}
.tp-floor-zoom::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  inline-size: 1.5rem; block-size: 1.5rem; border-radius: 50%;
  background: var(--tp-zoom-thumb); border: 2px solid var(--tp-zoom-thumb-ring);
  box-shadow: var(--tp-shadow-raised); cursor: pointer;
}
.tp-floor-zoom::-moz-range-thumb {
  inline-size: 1.5rem; block-size: 1.5rem; border-radius: 50%;
  background: var(--tp-zoom-thumb); border: 2px solid var(--tp-zoom-thumb-ring);
  box-shadow: var(--tp-shadow-raised); cursor: pointer;
}
.tp-floor-zoom::-moz-range-track { background: transparent; }
/* Blue mode paints this one control exactly as paper does — the owner asked
   for the two to be identical (2026-09-22), so these are the paper theme's own
   values rather than blue-mode tokens: --tp-accent-contrast IS the brand blue
   here, and the pale track and white ring are the brand white and its gray. */
:root[data-theme='operator'][data-mode='blue'] .tp-floor-zoom {
  --tp-zoom-fill: var(--tp-accent-contrast);
  --tp-zoom-track: var(--tp-brand-white);
  --tp-zoom-thumb: var(--tp-accent-contrast);
  --tp-zoom-thumb-ring: var(--tp-brand-white);
}

/* ---- keyframes ---- */
@keyframes tpPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
@keyframes tpSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes tpFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes tpRise { from { opacity: 0; transform: translateY(var(--tp-rise)); } to { opacity: 1; transform: none; } }
@keyframes tpFadeOut { from { opacity: 1; } to { opacity: 0; } }
@keyframes tpSink { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(var(--tp-rise)); } }
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

/* Leaving. A dialog that arrives on tpRise and then vanishes between two frames
   reads as a glitch, not a dismissal; a data-closing attribute on the backdrop replays
   both halves in reverse and the panel only unmounts once they have run (see
   Modal in components/ui.tsx). Same --tp-dur-base as the entrance: a shorter
   exit made opening and closing the same dialog feel like two different
   controls. */
[data-closing] .tp-rise, .tp-rise[data-closing] { animation: tpSink var(--tp-dur-base) var(--tp-ease-out) both; }
[data-closing].tp-fade, .tp-fade[data-closing] { animation: tpFadeOut var(--tp-dur-base) var(--tp-ease-out) both; }

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
/*
 * The assistant sheet sliding in from the inline-end edge, and back out again.
 * It used to mount and unmount on the spot, so it appeared and vanished
 * between two frames with nothing to follow.
 *
 * Travel is 100% of the sheet's own inline size, multiplied by --tp-dir-sign
 * the way tpMarquee and tpSwooshIn do, so the sheet leaves towards whichever
 * edge it is pinned to and Arabic needs no second rule. The scrim only ever
 * fades: it spans the viewport, so moving it would be nothing but paint.
 *
 * --tp-ease-settle, not --tp-ease-out: this is sheet-length travel across a
 * third of the screen, which is exactly the case --tp-ease-out stops dead on.
 * The exit runs on --tp-dur-fast because a dismissal that takes as long as the
 * arrival reads as the sheet being reluctant to go.
 */
@keyframes tpSheetIn {
  from { transform: translateX(calc(100% * var(--tp-dir-sign, 1))); }
  to   { transform: none; }
}
@keyframes tpSheetOut {
  from { transform: none; }
  to   { transform: translateX(calc(100% * var(--tp-dir-sign, 1))); }
}
.tp-sheet-inline { animation: tpSheetIn var(--tp-dur-base) var(--tp-ease-settle) both; }
.tp-sheet-inline[data-closing] { animation: tpSheetOut var(--tp-dur-fast) var(--tp-ease-settle) both; }
.tp-sheet-scrim { animation: tpFadeIn var(--tp-dur-base) var(--tp-ease-out) both; }
.tp-sheet-scrim[data-closing] { animation: tpFadeIn var(--tp-dur-fast) var(--tp-ease-out) reverse both; }

/* ---- form grids ---- */
/*
 * repeat(auto-fit, minmax(N, 1fr)) fits as many columns as the width allows.
 * That is right for a list of unknown length and wrong for a FORM, which knows
 * exactly how many columns it wants: two panels on a 1400px desk were handed a
 * THREE-column track and sat squeezed against an empty third. Only the width at
 * which a form gives its columns up is responsive, and that needs a query no
 * inline style can carry — hence class hooks rather than more style props.
 */

/* The page-level split of two panels side by side. Driven by the WINDOW. */
.tp-split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 64rem) { .tp-split { grid-template-columns: minmax(0, 1fr); } }
/* A panel that runs under both halves of the split. */
.tp-split-full { grid-column: 1 / -1; }

/*
 * A row of fields inside a panel. Driven by the PANEL, not the window: the
 * panel is half the page inside a split and the whole of it once the split
 * collapses, so a viewport query gets this exactly backwards — it stacked
 * date/time/duration into three full-width boxes at the precise moment they
 * had the most room they would ever have. The tp-cq class marks what they
 * measure themselves against. (No backticks in here: this sheet is a template
 * literal, and one would end it.)
 * Scoped to the elements that ask for it: container-type also turns an element
 * into a containing block for absolutely positioned children, which is not
 * something to hand every panel in the app.
 */
.tp-cq { container-type: inline-size; }
.tp-grid { display: grid; }
.tp-grid[data-cols="2"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.tp-grid[data-cols="3"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
@container (max-width: 30rem) { .tp-grid[data-cols="3"] { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 22rem) { .tp-grid[data-cols="2"], .tp-grid[data-cols="3"] { grid-template-columns: minmax(0, 1fr); } }

/* ---- the glass menu (components/SelectMenu.tsx) ----
   The floating panel of a dropdown, frosted so the data it covers stays
   faintly legible underneath rather than being replaced by a flat slab.

   Opaque --tp-surface is the BASE, and the translucent --tp-glass is applied
   only inside the @supports guard: a browser without backdrop-filter would
   otherwise render a see-through panel with unblurred text behind it, which
   is unreadable. Paper and blue mode each carry their own --tp-glass, so the
   pane picks up the mode's own hue instead of a grey wash.

   Radius is --tp-radius-dialog (12px), not the 6px control radius: this is an
   overlay and reads as one, and it is the corner the platform's own menu uses.
   The rows inside are inset by --tp-sp-1 and rounded a step down, so a tinted
   row never has a square corner poking into a round one. */
.tp-menu-glass {
  background: var(--tp-surface);
  border: 1px solid var(--tp-border);
  border-radius: var(--tp-radius-dialog);
  box-shadow: var(--tp-shadow-popover);
}
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .tp-menu-glass {
    background: var(--tp-glass);
    border-color: var(--tp-glass-border);
    -webkit-backdrop-filter: var(--tp-glass-blur);
    backdrop-filter: var(--tp-glass-blur);
  }
}
.tp-menu-glass [role='option'] {
  border-radius: var(--tp-radius-ctl);
  transition: background-color var(--tp-dur-fast) var(--tp-ease-out);
}
/* Hover tints only what the pointer is on; the keyboard's row is marked by
   [data-active] from the component and wins, so the two never disagree. */
.tp-menu-glass [role='option']:hover:not(:disabled):not([data-active='true']) {
  background: var(--tp-surface-2);
}

/* ---- the frosted sticky bar, and the controls standing on it ----
   The analytics bar is pinned over a scrolling <main>, so charts and tables
   genuinely pass beneath it: that moving content is what the frost has to
   show, and it is the reason this is glass rather than a tint.

   As everywhere else here, the opaque value is the base rule and the
   translucent one applies only inside @supports — without backdrop-filter a
   72% bar would let sharp text scroll through it and the row would be
   unreadable.

   .tp-glass-ctl is the control ON the bar. It is near-opaque (0.8) with only
   a light blur on purpose: two heavily translucent layers stack into a muddy
   wash and the control stops reading as a control. The border carries it. */
.tp-glass-bar { background: var(--tp-bg); }
.tp-glass-ctl { background: var(--tp-surface) !important; }
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .tp-glass-bar {
    background: var(--tp-glass-bar);
    -webkit-backdrop-filter: var(--tp-glass-blur);
    backdrop-filter: var(--tp-glass-blur);
  }
  .tp-glass-ctl {
    /* !important because inputStyle sets the background shorthand inline. */
    background: var(--tp-glass-ctl) !important;
    -webkit-backdrop-filter: var(--tp-glass-blur-sm);
    backdrop-filter: var(--tp-glass-blur-sm);
  }
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

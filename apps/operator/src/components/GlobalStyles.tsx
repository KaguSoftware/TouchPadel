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
/* SearchField draws its own clear button; the browser's native one on a
   type="search" input made two crosses side by side once text was typed. */
input[type='search']::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; display: none; }
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
.tp-btn:hover:not(:disabled) { background: var(--tp-hover); color: var(--tp-hover-fg); }
.tp-btn:active:not(:disabled) { transform: translateY(1px); }
.tp-btn:disabled { cursor: not-allowed; opacity: var(--tp-opacity-disabled); }
.tp-btn[data-busy='true'] { cursor: progress; }
.tp-btn[data-kind='primary'] { background: var(--tp-accent); border-color: var(--tp-accent); color: var(--tp-accent-contrast); }
/* Primary keeps its own darker-blue hover, not the shared --tp-hover (owner
   call, 2026-09-24); the ink is restated because the plain hover rule sets it. */
.tp-btn[data-kind='primary']:hover:not(:disabled) { background: var(--tp-accent-hover); border-color: var(--tp-accent-hover); color: var(--tp-accent-contrast); }
/* --tp-accent-active existed in the token file and was used by zero rules. */
.tp-btn[data-kind='primary']:active:not(:disabled) { background: var(--tp-accent-active); border-color: var(--tp-accent-active); }
.tp-btn[data-kind='danger'] { background: var(--tp-danger); border-color: var(--tp-danger); color: var(--tp-danger-contrast); }
/* The background is RE-DECLARED, not merely darkened. The plain hover rule above
   scores one pseudo-class higher than the bare [data-kind='danger'] attribute, so
   on hover it repainted a danger button in --tp-surface-2 while
   --tp-danger-contrast (white) stayed on the label — the destructive control went
   unreadable at the exact moment a finger was on it. Every other kind already
   restates its own ground here; danger was the one that only asked for a filter. */
.tp-btn[data-kind='danger']:hover:not(:disabled) { background: var(--tp-danger); border-color: var(--tp-danger); color: var(--tp-danger-contrast); filter: brightness(0.92); }
.tp-btn[data-kind='ghost'] { background: transparent; border-color: transparent; }
.tp-btn[data-kind='ghost']:hover:not(:disabled) { background: var(--tp-hover); color: var(--tp-hover-fg); }
/* The border is what keeps a soft button visible inside a hovered row: its ground
   is the same tint as --tp-hover, so with a transparent border it vanished. */
.tp-btn[data-kind='soft'] { background: var(--tp-accent-soft); border-color: color-mix(in srgb, var(--tp-accent) 60%, transparent); color: var(--tp-accent-soft-fg); }
.tp-btn[data-kind='soft']:hover:not(:disabled) { background: var(--tp-hover); border-color: var(--tp-accent); color: var(--tp-hover-fg); }
/* A hovered customer row is already the blue --tp-hover tint, so a secondary
   action on it (Book) goes gray on hover instead of disappearing into the row. */
.tp-btn.tp-btn-gray-hover:hover:not(:disabled) { background: var(--tp-surface-3); color: var(--tp-fg); }
/* The crash panel's "Restart the app": the strongest way out, amber so it reads as a bigger step without reading as an error. */
.tp-btn.tp-crash-restart { background: var(--tp-warn-soft); border-color: var(--tp-warn-mark); color: var(--tp-warn-fg); }
.tp-btn.tp-crash-restart svg { color: var(--tp-warn-mark); }
.tp-btn.tp-crash-restart:hover:not(:disabled) { background: color-mix(in oklab, var(--tp-warn-soft), var(--tp-warn-mark) 18%); color: var(--tp-warn-fg); }
/* Its "Technical details" disclosure: the native triangle swapped for a chevron that sits centred
   with the label and turns to point down when open (the other way in Arabic, where it is mirrored). */
.tp-crash-details { list-style: none; display: flex; align-items: center; justify-content: center; gap: var(--tp-sp-1-5); padding-block: var(--tp-sp-1-5); padding-inline: var(--tp-sp-1); cursor: pointer; color: var(--tp-muted-fg); font-size: var(--tp-fs-md); font-weight: 500; }
.tp-crash-details::-webkit-details-marker { display: none; }
.tp-crash-chev { display: inline-flex; transition: transform var(--tp-dur-fast) var(--tp-ease-out); }
details[open] > .tp-crash-details .tp-crash-chev { transform: rotate(90deg); }
[dir='rtl'] details[open] > .tp-crash-details .tp-crash-chev { transform: rotate(-90deg); }
@media (prefers-reduced-motion: reduce) { .tp-crash-chev { transition: none; } }
.tp-btn[data-size='sm'] { min-block-size: 1.85rem; padding-block: 0.25rem; padding-inline: 0.6rem; font-size: var(--tp-fs-sm); }
.tp-btn[data-size='lg'] { min-block-size: var(--tp-touch); padding-block: 0.6rem; padding-inline: 1.1rem; font-size: var(--tp-fs-lg); }
.tp-btn[data-size='xl'] { min-block-size: 3.5rem; padding-block: 0.8rem; padding-inline: 1.4rem; font-size: var(--tp-fs-xl); border-radius: var(--tp-radius-panel); }
/* A page header's actions (New rule, and the Export / Print beside it) are the
   things an owner reaches for, so every default-size button there renders at
   lg, and an icon-only one grows to the same height so the row stays level. */
.tp-page-actions .tp-btn[data-size='md']:not(.tp-iconbtn) { min-block-size: var(--tp-touch); padding-block: 0.6rem; padding-inline: 1.25rem; font-size: var(--tp-fs-lg); }
.tp-page-actions .tp-btn[data-size='md'] svg { inline-size: 20px; block-size: 20px; }
.tp-page-actions .tp-iconbtn[data-size='md'] { min-block-size: var(--tp-touch); inline-size: var(--tp-touch); }
.tp-btn[aria-pressed='true'] { background: var(--tp-accent-soft); border-color: var(--tp-accent); color: var(--tp-accent-soft-fg); }
/* Without this, a toggle carrying BOTH aria-pressed and data-kind='primary'
   renders soft at rest and flips to solid accent on hover, because the
   :hover rule above out-specifies the bare attribute selector. */
.tp-btn[aria-pressed='true']:hover:not(:disabled) { background: var(--tp-hover); color: var(--tp-hover-fg); }
/* An incident card on My reports (/incidents) is one button that opens its sheet: it lifts under the pointer. */
.tp-incident-card { transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease; }
.tp-incident-card:hover { transform: translateY(-2px); box-shadow: var(--tp-shadow-popover) !important; border-color: var(--tp-border-strong) !important; }
.tp-incident-card:focus-visible { outline: 2px solid var(--tp-accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .tp-incident-card, .tp-incident-card:hover { transition: none; transform: none; } }
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
/* A row-actions menu item (kit.tsx): a <button>, so clear its ground here,
   below the hover rule, rather than inline, above it. */
.tp-row[role='menuitem'] { background: none; }
.tp-row[data-clickable='true']:hover { background: var(--tp-hover); color: var(--tp-hover-fg); }
/* Selected is a solid bar (round 3, 2026-10-18): Touch Blue on paper, white in
   blue mode. The row also borrows the other mode's palette for its contents
   (theme.ts, the cross scopes), so links, grey text and badges stay readable. */
.tp-row[data-selected='true'] { background: var(--tp-selected); color: var(--tp-selected-fg); }
/* A tappable choice chip (ReasonCodePrompt): a <label> around a visually
   hidden radio, so the group stays a real radiogroup for keyboard and AT. */
.tp-choice {
  display: flex; align-items: center; min-block-size: 2.75rem;
  padding-block: var(--tp-sp-2); padding-inline: var(--tp-sp-3);
  border: 1px solid var(--tp-border); border-radius: var(--tp-radius-ctl);
  background: var(--tp-surface); cursor: pointer; font-weight: 500; line-height: 1.25;
  transition: background var(--tp-dur-fast) var(--tp-ease-out), border-color var(--tp-dur-fast) var(--tp-ease-out);
}
.tp-choice:hover { border-color: var(--tp-border-strong); background: var(--tp-hover); color: var(--tp-hover-fg); }
.tp-choice[data-selected='true'] { border-color: var(--tp-accent); background: var(--tp-accent-soft); color: var(--tp-accent-soft-fg); }
.tp-choice:has(:focus-visible) { outline: 2px solid var(--tp-accent); outline-offset: 2px; }
.tp-choice:has(:disabled) { cursor: default; opacity: 0.6; }
.tp-tile {
  cursor: pointer; text-align: start;
  /* Same reason as .tp-btn: no 'transform' in the transition list. */
  transition: background var(--tp-dur-fast) var(--tp-ease-out), border-color var(--tp-dur-fast) var(--tp-ease-out);
}
.tp-tile:hover:not(:disabled) { background: var(--tp-hover); color: var(--tp-hover-fg); }
.tp-tile:active:not(:disabled) { transform: scale(0.99); }
.tp-tile:disabled { cursor: not-allowed; }
/* The workspace picker's tiles (routes/workspaces.tsx, Majed 2026-10-19). A
   head in the rail's colour carries a line drawing of what the workspace runs
   (components/WorkspaceArt) in the court-line stroke; the body holds the name
   and the lead. The workspace you are in turns its head Padel Green, the same
   "you are here" the rail's current-page pill uses. Hover only lifts the
   drawing and tints the body; nothing moves. */
/* align-items is spelled out: Electron 33's Chromium (130) reads "normal" on a
   <button> as start, which shrank the head to its icon. */
.tp-ws-tile {
  display: flex; flex-direction: column; align-items: stretch; min-block-size: 0; padding: 0;
  text-align: start; color: var(--tp-fg); background: var(--tp-surface);
  border: 1px solid var(--tp-border); border-radius: var(--tp-radius-panel);
  overflow: hidden; cursor: pointer;
  transition: background var(--tp-dur-fast) var(--tp-ease-out), border-color var(--tp-dur-fast) var(--tp-ease-out);
}
.tp-ws-tile:hover { background: var(--tp-hover); }
.tp-ws-head {
  position: relative; flex: 1; min-block-size: 6rem;
  display: flex; align-items: flex-end; padding: var(--tp-sp-5);
  background: var(--tp-rail); color: var(--tp-rail-green);
}
/* The drawing starts under the row the number and "You are here" sit in, so
   neither lands on a line of it. */
.tp-ws-art {
  position: absolute; inset-block: 3.75rem var(--tp-sp-4); inset-inline: var(--tp-sp-4) var(--tp-sp-5);
  inline-size: calc(100% - var(--tp-sp-4) - var(--tp-sp-5)); block-size: calc(100% - 3.75rem - var(--tp-sp-4));
  fill: none; stroke: var(--tp-court-line); stroke-width: 1.5px; stroke-linecap: round; stroke-linejoin: round;
  opacity: 0.6; transition: opacity var(--tp-dur-fast) var(--tp-ease-out);
}
[dir='rtl'] .tp-ws-art { transform: scaleX(-1); }
.tp-ws-tile:hover .tp-ws-art { opacity: 0.9; }
.tp-ws-icon { position: relative; display: inline-flex; }
.tp-ws-key {
  position: absolute; inset-block-start: var(--tp-sp-4); inset-inline-end: var(--tp-sp-4);
  display: inline-flex; align-items: center; justify-content: center;
  inline-size: 2.125rem; block-size: 2.125rem; border-radius: var(--tp-radius-ctl);
  border: 1px solid color-mix(in oklab, var(--tp-court-line) 55%, transparent);
  color: var(--tp-rail-fg); font-weight: 700; font-size: var(--tp-fs-lg);
}
.tp-ws-here {
  position: absolute; inset-block-start: var(--tp-sp-4); inset-inline-start: var(--tp-sp-4);
  display: inline-flex; align-items: center; gap: var(--tp-sp-1-5);
  block-size: 1.875rem; padding-inline: var(--tp-sp-3); border-radius: var(--tp-radius-pill);
  background: var(--tp-rail-active-fg); color: var(--tp-rail-active);
  font-size: var(--tp-fs-md); font-weight: 600;
}
.tp-ws-body {
  display: flex; align-items: flex-end; gap: var(--tp-sp-4);
  padding-block: var(--tp-sp-4) var(--tp-sp-5); padding-inline: var(--tp-sp-5);
}
.tp-ws-tile[data-current='true'] { border-color: var(--tp-rail-active); }
.tp-ws-tile[data-current='true'] .tp-ws-head { background: var(--tp-rail-active); color: var(--tp-rail-active-fg); }
.tp-ws-tile[data-current='true'] .tp-ws-art { stroke: var(--tp-rail-active-fg); opacity: 0.4; }
.tp-ws-tile[data-current='true'] .tp-ws-key {
  color: var(--tp-rail-active-fg);
  border-color: color-mix(in oklab, var(--tp-rail-active-fg) 50%, transparent);
}
/* The customer record's cards (features/desk/customers/RecordCards). A card
   keeps its own ground on hover and is lifted by its edge and a shadow instead:
   the cards carry coloured figures that the pale hover tint washed out. The
   lead card (next booking) is the accent, deepening on hover like a primary
   button. */
.tp-record-card {
  background: var(--tp-surface); color: var(--tp-fg);
  border: 1px solid var(--tp-border); border-radius: var(--tp-radius-dialog);
  box-shadow: var(--tp-shadow-raised);
  transition: border-color var(--tp-dur-fast) var(--tp-ease-out), box-shadow var(--tp-dur-fast) var(--tp-ease-out), background var(--tp-dur-fast) var(--tp-ease-out);
}
.tp-record-card.tp-tile:hover:not(:disabled) { background: var(--tp-surface); color: var(--tp-fg); border-color: var(--tp-accent); box-shadow: var(--tp-shadow-popover); }
.tp-record-card .tp-record-open { color: var(--tp-muted-fg); }
/* A section card's outline takes its strip's colour on hover only (owner, 2026-10-15). */
.tp-record-card.tp-section-card.tp-tile:hover:not(:disabled) { border-color: var(--tp-strip); }
.tp-record-card.tp-tile:hover .tp-record-open { color: var(--tp-accent); }
/* The next-booking card: brand blue with white ink in both modes (owner,
   2026-10-15). It used --tp-accent, which blue mode turns white. */
.tp-record-card[data-tone='accent'] {
  background: linear-gradient(140deg, var(--tp-brand-blue) 0%, color-mix(in oklab, var(--tp-brand-blue) 72%, var(--tp-brand-black)) 100%);
  border-color: transparent; color: var(--tp-brand-white);
}
.tp-record-card[data-tone='accent'].tp-tile:hover:not(:disabled) {
  background: linear-gradient(140deg, color-mix(in oklab, var(--tp-brand-blue) 88%, var(--tp-brand-black)) 0%, color-mix(in oklab, var(--tp-brand-blue) 72%, var(--tp-brand-black)) 100%);
  border-color: transparent; color: var(--tp-brand-white);
}
.tp-record-card[data-tone='accent'] .tp-record-open { color: var(--tp-brand-white); }
/* The next-booking card moves like the loyalty card (owner, 2026-10-15): soft
   bands of deep brand blue, brand blue and a sky-blue floodlight glow (owner:
   "floodlit court") that drift, sway and turn clockwise,
   blurred so no line shows. Same layer and motions as the loyalty card's
   ::before below; the racket and the text paint above it. */
.tp-record-card[data-tone='accent'] { isolation: isolate; }
.tp-record-card[data-tone='accent']::before {
  content: '';
  position: absolute;
  inset: auto;
  inset-inline-start: 50%;
  inset-block-start: 50%;
  inline-size: 1400px;
  block-size: 1400px;
  margin-inline-start: -700px;
  margin-block-start: -700px;
  z-index: -1;
  pointer-events: none;
  filter: blur(18px);
  background-image: repeating-linear-gradient(115deg, color-mix(in oklab, var(--tp-brand-blue) 72%, var(--tp-brand-black)) 0px, var(--tp-brand-blue) 100px, var(--tp-floodlight) 160px, var(--tp-brand-blue) 220px, color-mix(in oklab, var(--tp-brand-blue) 72%, var(--tp-brand-black)) 320px);
  animation: tpLoyaltyAurora 10s linear infinite, tpLoyaltySway 9s ease-in-out infinite, tpLoyaltySpin 40s linear infinite;
}
.tp-record-card[data-tone='accent'].tp-tile:hover:not(:disabled)::before {
  background-image: repeating-linear-gradient(115deg, color-mix(in oklab, var(--tp-brand-blue) 84%, var(--tp-brand-black)) 0px, var(--tp-brand-blue) 90px, color-mix(in oklab, var(--tp-floodlight) 85%, var(--tp-brand-white)) 160px, var(--tp-brand-blue) 230px, color-mix(in oklab, var(--tp-brand-blue) 84%, var(--tp-brand-black)) 320px);
}
@media (prefers-reduced-motion: reduce) { .tp-record-card[data-tone='accent']::before { animation: none; } }
/* The Keeps bookings card, "scoreboard" (owner, 2026-10-15): deep charcoal with
   a soft grey glow that drifts, sways and turns like the cards beside it, and
   white ink, so the ring's full green, orange and red stand out. The same in
   both modes. */
.tp-record-card[data-tone='scoreboard'] {
  isolation: isolate;
  background: linear-gradient(140deg, color-mix(in oklab, var(--tp-brand-black) 86%, var(--tp-brand-gray)) 0%, color-mix(in oklab, var(--tp-brand-black) 93%, var(--tp-brand-gray)) 100%);
  border-color: transparent; color: var(--tp-brand-white);
  --tp-ring-track: color-mix(in oklab, var(--tp-brand-white) 14%, transparent);
}
.tp-record-card[data-tone='scoreboard'].tp-tile:hover:not(:disabled) {
  background: linear-gradient(140deg, color-mix(in oklab, var(--tp-brand-gray) 42%, var(--tp-brand-black)) 0%, color-mix(in oklab, var(--tp-brand-black) 93%, var(--tp-brand-gray)) 100%);
  border-color: transparent; color: var(--tp-brand-white);
}
.tp-record-card[data-tone='scoreboard'] .tp-record-open { color: var(--tp-brand-white); }
/* Its labels' grey is set inline, so !important to lift them to the white ink. */
/* Not inside a tone tile: the bookings dialog's count tiles sit in this band on
   their own light ground and keep their dark ink. */
.tp-record-card[data-tone='scoreboard'] span:not(.tp-tone-tile *) { color: var(--tp-brand-white) !important; }
.tp-record-card[data-tone='scoreboard']::before {
  content: '';
  position: absolute;
  inset: auto;
  inset-inline-start: 50%;
  inset-block-start: 50%;
  inline-size: 1400px;
  block-size: 1400px;
  margin-inline-start: -700px;
  margin-block-start: -700px;
  z-index: -1;
  pointer-events: none;
  filter: blur(18px);
  background-image: repeating-linear-gradient(115deg, color-mix(in oklab, var(--tp-brand-black) 93%, var(--tp-brand-gray)) 0px, color-mix(in oklab, var(--tp-brand-gray) 42%, var(--tp-brand-black)) 160px, color-mix(in oklab, var(--tp-brand-black) 93%, var(--tp-brand-gray)) 320px);
  animation: tpLoyaltyAurora 10s linear infinite, tpLoyaltySway 9s ease-in-out infinite, tpLoyaltySpin 40s linear infinite;
}
.tp-record-card[data-tone='scoreboard'].tp-tile:hover:not(:disabled)::before {
  background-image: repeating-linear-gradient(115deg, color-mix(in oklab, var(--tp-brand-black) 86%, var(--tp-brand-gray)) 0px, color-mix(in oklab, var(--tp-brand-gray) 52%, var(--tp-brand-black)) 160px, color-mix(in oklab, var(--tp-brand-black) 86%, var(--tp-brand-gray)) 320px);
}
@media (prefers-reduced-motion: reduce) { .tp-record-card[data-tone='scoreboard']::before { animation: none; } }
/* The close button on a dialog's coloured header (SectionDialog): a soft tint of
   the header's own ink on hover, not the app's pale-blue hover, which read as a
   light patch with dark ink on the dark headers (owner, 2026-10-15). */
.tp-btn.tp-band-close[data-kind='ghost']:hover:not(:disabled) { background: color-mix(in oklab, currentColor 18%, transparent); color: inherit; }
.tp-btn.tp-band-close[data-kind='ghost']:active:not(:disabled) { background: color-mix(in oklab, currentColor 26%, transparent); }

/* The section dialogs' headers (owner, 2026-10-15: "the banner on all of
   them"): each in its card's colour, deep with a lighter glow, moving like the
   loyalty header, white ink. Open matches and tickets green, lessons violet,
   café amber, series teal. */
.tp-record-card[data-tone='section'][data-section='matches'], .tp-band-scope[data-section='matches'] { --tp-section-deep: color-mix(in oklab, var(--tp-success-mark) 62%, var(--tp-brand-black)); --tp-section-glow: color-mix(in oklab, var(--tp-accent-2) 55%, color-mix(in oklab, var(--tp-success-mark) 62%, var(--tp-brand-black))); }
.tp-record-card[data-tone='section'][data-section='tickets'], .tp-band-scope[data-section='tickets'] { --tp-section-deep: color-mix(in oklab, var(--tp-success-mark) 62%, var(--tp-brand-black)); --tp-section-glow: color-mix(in oklab, var(--tp-accent-2) 55%, color-mix(in oklab, var(--tp-success-mark) 62%, var(--tp-brand-black))); }
.tp-record-card[data-tone='section'][data-section='lessons'], .tp-band-scope[data-section='lessons'] { --tp-section-deep: color-mix(in oklab, var(--tp-lesson) 70%, var(--tp-brand-black)); --tp-section-glow: color-mix(in oklab, var(--tp-lesson) 62%, var(--tp-brand-white)); }
.tp-record-card[data-tone='section'][data-section='cafe'], .tp-band-scope[data-section='cafe'] { --tp-section-deep: color-mix(in oklab, var(--tp-warn-mark) 62%, var(--tp-brand-black)); --tp-section-glow: color-mix(in oklab, var(--tp-warn) 60%, color-mix(in oklab, var(--tp-warn-mark) 62%, var(--tp-brand-black))); }
.tp-record-card[data-tone='section'][data-section='series'], .tp-band-scope[data-section='series'] { --tp-section-deep: color-mix(in oklab, var(--tp-tournament) 72%, var(--tp-brand-black)); --tp-section-glow: color-mix(in oklab, var(--tp-tournament) 60%, var(--tp-brand-white)); }
.tp-record-card[data-tone='section'] { isolation: isolate; background: var(--tp-section-deep); color: var(--tp-brand-white); }
.tp-record-card[data-tone='section']::before {
  content: '';
  position: absolute;
  inset: auto;
  inset-inline-start: 50%;
  inset-block-start: 50%;
  inline-size: 1400px;
  block-size: 1400px;
  margin-inline-start: -700px;
  margin-block-start: -700px;
  z-index: -1;
  pointer-events: none;
  filter: blur(18px);
  background-image: repeating-linear-gradient(115deg, var(--tp-section-deep) 0px, var(--tp-section-glow) 160px, var(--tp-section-deep) 320px);
  animation: tpLoyaltyAurora 10s linear infinite, tpLoyaltySway 9s ease-in-out infinite, tpLoyaltySpin 40s linear infinite;
}
@media (prefers-reduced-motion: reduce) { .tp-record-card[data-tone='section']::before { animation: none; } }

/* A banded dialog's scope: the header's ground and ink (--tp-band-ground,
   --tp-band-ink, --tp-band-edge). The cards inside it reset these to white with
   dark ink below, so only the header itself is coloured. */
.tp-band-scope[data-band='scoreboard'] { --tp-band-ground: color-mix(in oklab, var(--tp-brand-black) 86%, var(--tp-brand-gray)); --tp-band-ink: var(--tp-brand-white); --tp-band-edge: transparent; }
.tp-band-scope[data-band='accent'] { --tp-band-ground: var(--tp-brand-blue); --tp-band-ink: var(--tp-brand-white); --tp-band-edge: transparent; }
.tp-band-scope[data-band='loyalty'] { --tp-band-ground: color-mix(in oklab, var(--tp-brand-blue) 38%, var(--tp-brand-black)); --tp-band-ink: var(--tp-brand-white); --tp-band-edge: transparent; }
.tp-band-scope[data-band='loyalty'][data-tier] { --tp-band-ground: color-mix(in oklab, var(--tp-loyal-tone) 40%, var(--tp-brand-white)); --tp-band-ink: color-mix(in oklab, var(--tp-brand-black) 82%, var(--tp-brand-blue)); --tp-band-edge: color-mix(in oklab, var(--tp-brand-black) 15%, transparent); }
.tp-band-scope[data-tier='gold'] { --tp-loyal-tone: var(--tp-tier-gold); }
.tp-band-scope[data-tier='silver'] { --tp-loyal-tone: var(--tp-tier-silver); }
.tp-band-scope[data-tier='bronze'] { --tp-loyal-tone: var(--tp-tier-bronze); }
.tp-band-scope[data-tier='platinum'] { --tp-loyal-tone: var(--tp-tier-platinum); }
.tp-band-scope[data-band='section'] { --tp-band-ground: var(--tp-section-deep); --tp-band-ink: var(--tp-brand-white); --tp-band-edge: transparent; }
/* Each header's two colours (--tp-band-a deep, --tp-band-b glow), kept for the
   bands; the cards in the dialog no longer use them (see below). */
.tp-band-scope[data-band='scoreboard'] { --tp-band-a: color-mix(in oklab, var(--tp-brand-black) 93%, var(--tp-brand-gray)); --tp-band-b: color-mix(in oklab, var(--tp-brand-gray) 42%, var(--tp-brand-black)); }
.tp-band-scope[data-band='accent'] { --tp-band-a: color-mix(in oklab, var(--tp-brand-blue) 72%, var(--tp-brand-black)); --tp-band-b: var(--tp-floodlight); }
.tp-band-scope[data-band='loyalty'] { --tp-band-a: color-mix(in oklab, var(--tp-brand-blue) 38%, var(--tp-brand-black)); --tp-band-b: color-mix(in oklab, var(--tp-brand-green) 34%, color-mix(in oklab, var(--tp-brand-blue) 38%, var(--tp-brand-black))); }
.tp-band-scope[data-band='loyalty'][data-tier] { --tp-band-a: color-mix(in oklab, var(--tp-loyal-tone) 55%, var(--tp-brand-white)); --tp-band-b: var(--tp-loyal-tone); }
.tp-band-scope[data-band='section'] { --tp-band-a: var(--tp-section-deep); --tp-band-b: var(--tp-section-glow); }
:root .tp-band-scope .tp-tone-tile.tp-tone-tile,
:root .tp-band-scope .tp-band-card.tp-band-card {
  text-shadow: none;
  /* White and still, in both modes; the strips and outlines keep their colours
     (owner, 2026-10-15, reverting the moving ground). The ink is pinned dark,
     because blue mode's own ink is light. */
  background: var(--tp-brand-white) !important;
  --tp-band-ink: color-mix(in oklab, var(--tp-brand-black) 82%, var(--tp-brand-blue));
  --tp-band-edge: color-mix(in oklab, var(--tp-brand-black) 12%, transparent);
}

/* The loyalty card's ground (owner, 2026-10-14): slanted bands at the shine's angle,
   equal bands of the tier's colour (the
   brand green the website uses, full strength) and the brand blue, each 40px solid
   with a long 120px fade between, so one melts into the other (owner: "the same size", "dark blue",
   "the website's green"), over a ground of
   the tier's colour lightly tinted blue, no white (owner: "green and blue", the
   green leading), like
   northern lights. The bands live on a layer wider than
   the card behind the content (::before) and slide one way without end, the way
   the shine below sweeps (owner: "the motion should be like this", then "just
   goes and repeats"): a repeating pattern moved by exactly one repeat. The tier comes from data-tier (gold, silver, bronze,
   platinum); any other tier, and a customer without one, is the brand green.
   The same in both modes (owner, 2026-10-15): mixed with white rather than the
   surface, which is navy in blue mode, and no blue-mode overrides. Still under
   reduced motion. */
.tp-record-card[data-tone='loyalty'] { --tp-loyal-tone: var(--tp-accent-2); isolation: isolate; }
.tp-record-card[data-tone='loyalty'][data-tier='gold'] { --tp-loyal-tone: var(--tp-tier-gold); }
.tp-record-card[data-tone='loyalty'][data-tier='silver'] { --tp-loyal-tone: var(--tp-tier-silver); }
.tp-record-card[data-tone='loyalty'][data-tier='bronze'] { --tp-loyal-tone: var(--tp-tier-bronze); }
.tp-record-card[data-tone='loyalty'][data-tier='platinum'] { --tp-loyal-tone: var(--tp-tier-platinum); }
.tp-record-card[data-tone='loyalty'] { background-color: color-mix(in oklab, color-mix(in oklab, var(--tp-loyal-tone) 82%, color-mix(in oklab, var(--tp-brand-blue) 14%, var(--tp-brand-white))) 50%, transparent); background-image: none; }
.tp-record-card[data-tone='loyalty'].tp-tile:hover:not(:disabled) { background-color: color-mix(in oklab, color-mix(in oklab, var(--tp-loyal-tone) 88%, color-mix(in oklab, var(--tp-brand-blue) 18%, var(--tp-brand-white))) 50%, transparent); background-image: none; }
.tp-record-card[data-tone='loyalty']::before {
  content: '';
  position: absolute;
  /* Past the card on both sides by more than one repeat of the bands (353px),
     so at every point of the slide the whole card is covered. Covering one
     side only left the other uncovered mid-slide, a hard edge (owner's
     screenshot, 2026-10-14). */
  /* And past top and bottom, so the sway (scale, skew, tilt) never bares an edge. */
  inset: -25% -400px;
  z-index: -1;
  pointer-events: none;
  /* The whole card's colour at 50% (owner, 2026-10-15): these bands and the
     card's own ground (background-color above, mixed to 50%) alike. */
  opacity: 0.5;
  background-image: repeating-linear-gradient(115deg, var(--tp-loyal-tone) 0px, var(--tp-loyal-tone) 40px, var(--tp-brand-blue) 160px, var(--tp-brand-blue) 200px, var(--tp-loyal-tone) 320px);
  /* Two motions on two properties: the endless drift moves 'translate', the
     aurora's sway moves 'transform', so neither overrides the other. */
  animation: tpLoyaltyAurora 10s linear infinite, tpLoyaltySway 9s ease-in-out infinite;
}
.tp-record-card[data-tone='loyalty'].tp-tile:hover:not(:disabled)::before {
  background-image: repeating-linear-gradient(115deg, var(--tp-loyal-tone) 0px, var(--tp-loyal-tone) 40px, color-mix(in oklab, var(--tp-brand-blue) 82%, var(--tp-brand-black)) 160px, color-mix(in oklab, var(--tp-brand-blue) 82%, var(--tp-brand-black)) 200px, var(--tp-loyal-tone) 320px);
}
/* The shine (owner, 2026-10-14): a diagonal streak of light sweeps across the
   card the way sun catches a gold or silver bank card, then rests. Only the
   metal tiers shine: bronze, silver, gold and platinum. It runs over
   the colours but under the text (z-index -1, after ::before), so nothing it
   crosses gets harder to read. Softer in blue mode; none under reduced motion. */
.tp-record-card[data-tone='loyalty'][data-tier='bronze']::after,
.tp-record-card[data-tone='loyalty'][data-tier='silver']::after,
.tp-record-card[data-tone='loyalty'][data-tier='gold']::after,
.tp-record-card[data-tone='loyalty'][data-tier='platinum']::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-image: linear-gradient(115deg,
    transparent 38%,
    color-mix(in oklab, var(--tp-brand-white) 0%, transparent) 42%,
    color-mix(in oklab, var(--tp-brand-white) 70%, transparent) 48%,
    color-mix(in oklab, var(--tp-brand-white) 85%, transparent) 50%,
    color-mix(in oklab, var(--tp-brand-white) 70%, transparent) 52%,
    transparent 58%);
  background-size: 300% 100%;
  background-repeat: no-repeat;
  background-position: 120% 0;
  animation: tpLoyaltyShine 6s ease-in-out infinite;
}
@keyframes tpLoyaltyShine {
  0%   { background-position: 120% 0; }
  25%  { background-position: -20% 0; }
  100% { background-position: -20% 0; }
}
@media (prefers-reduced-motion: reduce) { .tp-record-card[data-tone='loyalty']::after { animation: none; opacity: 0; } }
/* The card's dark ink crosses the dark blue band, where it alone
   reads poorly, and white would not read on the green, so the text carries a
   soft light halo that keeps it legible on both, in both modes. */
.tp-record-card[data-tone='loyalty'] { text-shadow: 0 0 0.35rem color-mix(in oklab, var(--tp-brand-white) 75%, transparent), 0 0 0.12rem color-mix(in oklab, var(--tp-brand-white) 60%, transparent); }
/* One dark ink on the card in both modes (blue mode's own ink is light, and
   would vanish on these colours), the labels included: their grey is set
   inline, so this needs !important to reach them. */
.tp-record-card[data-tone='loyalty'] { --tp-loyal-ink: color-mix(in oklab, var(--tp-brand-black) 82%, var(--tp-brand-blue)); color: var(--tp-loyal-ink); }
/* Not inside the white cards a dialog's header holds (the loyalty tiles), and
   not in a status badge, which keeps its own colours. */
.tp-record-card[data-tone='loyalty'] span:not(.tp-band-card *):not(.tp-tone-tile *):not(.tp-status-badge):not(.tp-status-badge *) { color: var(--tp-loyal-ink) !important; }
/* The tier badge on the card wears the same colour, outlined in black at 30% in
   both modes (owner, 2026-10-14). */
.tp-record-card[data-tone='loyalty'] .tp-tier-pill { background: color-mix(in oklab, var(--tp-loyal-tone) 45%, var(--tp-brand-white)); border: 1px solid color-mix(in oklab, var(--tp-brand-black) 30%, transparent); color: var(--tp-loyal-ink); }
/* Member, and any tier without a metal (owner, 2026-10-15, "night court"):
   a solid deep navy card with a soft brand-green light drifting across it on
   the same seamless loop, and white ink. Solid, not see-through, and no halo:
   white on navy reads on its own. The metal tiers keep their colours above. */
.tp-record-card[data-tone='loyalty']:not([data-tier]) {
  --tp-loyal-ink: var(--tp-brand-white);
  background-color: color-mix(in oklab, var(--tp-brand-blue) 38%, var(--tp-brand-black));
  text-shadow: none;
}
.tp-record-card[data-tone='loyalty']:not([data-tier]).tp-tile:hover:not(:disabled) { background-color: color-mix(in oklab, var(--tp-brand-blue) 46%, var(--tp-brand-black)); }
.tp-record-card[data-tone='loyalty']:not([data-tier])::before {
  opacity: 1;
  /* A soft wash, not a line: one continuous fade with no flat stops, blurred
     so no edge survives (owner, 2026-10-15). */
  filter: blur(18px);
  background-image: repeating-linear-gradient(115deg, color-mix(in oklab, var(--tp-brand-blue) 38%, var(--tp-brand-black)) 0px, color-mix(in oklab, var(--tp-brand-green) 34%, color-mix(in oklab, var(--tp-brand-blue) 38%, var(--tp-brand-black))) 160px, color-mix(in oklab, var(--tp-brand-blue) 38%, var(--tp-brand-black)) 320px);
}
.tp-record-card[data-tone='loyalty']:not([data-tier]).tp-tile:hover:not(:disabled)::before {
  background-image: repeating-linear-gradient(115deg, color-mix(in oklab, var(--tp-brand-blue) 46%, var(--tp-brand-black)) 0px, color-mix(in oklab, var(--tp-brand-green) 42%, color-mix(in oklab, var(--tp-brand-blue) 46%, var(--tp-brand-black))) 160px, color-mix(in oklab, var(--tp-brand-blue) 46%, var(--tp-brand-black)) 320px);
}
.tp-record-card[data-tone='loyalty']:not([data-tier]) .tp-tier-pill {
  background: color-mix(in oklab, var(--tp-brand-green) 30%, color-mix(in oklab, var(--tp-brand-blue) 38%, var(--tp-brand-black)));
  border-color: color-mix(in oklab, var(--tp-brand-white) 30%, transparent);
}
@keyframes tpLoyaltyAurora {
  /* One repeat of the bands, measured along x: 320px / sin(115deg). Ending on
     exactly one repeat makes the loop seamless, so it only ever moves one way: left to right,
     like the shine. Physical on purpose: the light falls the same way in Arabic. */
  from { translate: -353.1px 0; }
  to   { translate: 0 0; }
}
/* The aurora: the bands bend, stretch and tilt slowly, like curtains of light,
   while they drift. Never scaled below 1, so the layer always covers the card. */
@keyframes tpLoyaltySway {
  0%   { transform: skewX(0deg) scaleY(1.05) rotate(0deg); }
  30%  { transform: skewX(-9deg) scaleY(1.22) rotate(2deg); }
  65%  { transform: skewX(7deg) scaleY(1.1) rotate(-2deg); }
  100% { transform: skewX(0deg) scaleY(1.05) rotate(0deg); }
}
@media (prefers-reduced-motion: reduce) { .tp-record-card[data-tone='loyalty']::before { animation: none; } }
/* The owner's four card colours (--tp-card-1..6: green, violet, rose, light
   blue, teal, gold, the Breakdown's, Sait 2026-10-19; they were blue, green, black, light
   blue from 2026-09-24) on the customer record's tiles, by their place among
   their siblings: a 3px strip on top and a tint of the same colour behind.
   --tp-tone-ink is the text that reads on the colour itself (the date leaf's
   weekday strip). Blue mode's tokens are the calm light inks, and blue mode
   drops the tint, as the figure groups do. */
.tp-tone-tile { background: color-mix(in oklab, var(--tp-tone) var(--tp-tone-tint), var(--tp-surface)); border-block-start: 3px solid var(--tp-tone); --tp-tone-tint: 20%; --tp-tone-ink: var(--tp-card-ink); }
.tp-tone-tile:nth-child(6n + 1) { --tp-tone: var(--tp-card-1); }
.tp-tone-tile:nth-child(6n + 2) { --tp-tone: var(--tp-card-2); }
.tp-tone-tile:nth-child(6n + 3) { --tp-tone: var(--tp-card-3); }
.tp-tone-tile:nth-child(6n + 4) { --tp-tone: var(--tp-card-4); }
.tp-tone-tile:nth-child(6n + 5) { --tp-tone: var(--tp-card-5); }
.tp-tone-tile:nth-child(6n + 6) { --tp-tone: var(--tp-card-6); }
.tp-record-card.tp-tone-tile.tp-tile:hover:not(:disabled) { background: color-mix(in oklab, var(--tp-tone) calc(var(--tp-tone-tint) + 8%), var(--tp-surface)); border-color: var(--tp-border); border-block-start-color: var(--tp-tone); }
:root[data-theme='operator'][data-mode='blue'] .tp-tone-tile { background: var(--tp-surface-2); }
:root[data-theme='operator'][data-mode='blue'] .tp-record-card.tp-tone-tile.tp-tile:hover:not(:disabled) { background: var(--tp-surface-3); }
/* A tile that names its colour instead of taking its place's: cancellations
   red, no-shows amber (owner, 2026-10-14). Weighted past the place rules, blue mode's
   included; blue mode still drops the tint and keeps the red strip. */
:root .tp-tone-tile.tp-tone-tile.tp-tone-tile[data-tone='danger'] { --tp-tone: var(--tp-danger); --tp-tone-tint: 10%; --tp-tone-ink: var(--tp-danger-contrast); }
:root .tp-tone-tile.tp-tone-tile.tp-tone-tile[data-tone='warn'] { --tp-tone: var(--tp-warn); --tp-tone-tint: 22%; --tp-tone-ink: var(--tp-brand-black); }
/* The next-booking racket sits on the end edge (insetInlineEnd), so in Arabic it
   moves to the left; the drawing is mirrored too, so its handle still points
   into the card rather than off it. */
[dir='rtl'] .tp-racket-mark { transform: scaleX(-1); }
/* A card pill's word, optically centred: the Latin face draws its letters high
   in the line box, so a centred line-height-1 box still left "Member" ~1.3px
   above the pill's middle (owner's screenshot, 2026-10-14). The shell's
   Chromium has no text-box-trim yet, so a little padding on top instead. The
   Arabic face sits differently and keeps none. */
.tp-card-pill { padding-block-start: 0.2em; }
[dir='rtl'] .tp-card-pill { padding-block-start: 0; }
/* The tickets card is drawn as a stub: two notches on the tear line. */
.tp-record-card[data-tone='ticket']::before, .tp-record-card[data-tone='ticket']::after {
  content: ''; position: absolute; inset-block-start: 5.4rem; inline-size: 1.1rem; block-size: 1.1rem;
  border-radius: 50%; background: var(--tp-bg); border: 1px solid var(--tp-border);
}
.tp-record-card[data-tone='ticket']::before { inset-inline-start: -0.6rem; }
.tp-record-card[data-tone='ticket']::after { inset-inline-end: -0.6rem; }
/* The family tabs (components/FamilyTabs.tsx): the pages of one rail row,
   under the page title. The same underline vocabulary as ui.tsx's Tabs, so a
   tab looks like a tab everywhere; the page being shown is full ink, bold and
   underlined in the accent, the others muted until hovered. */
.tp-family-tabs {
  display: flex; gap: var(--tp-sp-1);
  border-block-end: 1px solid var(--tp-border);
  /* overflow-x alone turns overflow-y to auto, and the -1px underline then
     grows a vertical scrollbar; still swipeable when too narrow. */
  overflow-x: auto; overflow-y: hidden; scrollbar-width: none;
}
.tp-family-tab {
  display: inline-flex; align-items: center; gap: 0.4rem;
  min-block-size: var(--tp-touch);
  padding-inline: 0.85rem;
  border-block-end: 2px solid transparent; margin-block-end: -1px;
  color: var(--tp-muted-fg); font-size: var(--tp-fs-md); font-weight: 500;
  white-space: nowrap; text-decoration: none;
  transition: color var(--tp-dur-fast) var(--tp-ease-out);
}
.tp-family-tab:hover { color: var(--tp-fg); }
.tp-family-tab[aria-current='page'] { color: var(--tp-fg); font-weight: 700; border-block-end-color: var(--tp-accent); }
.tp-family-tab:focus-visible { outline-offset: -2px; }
.tp-family-tab-count {
  font-size: var(--tp-fs-xs); font-weight: 600; font-variant-numeric: tabular-nums;
  padding-inline: 0.4rem; border-radius: var(--tp-radius-pill);
  background: var(--tp-surface-3); color: var(--tp-fg);
}
.tp-family-tab[aria-current='page'] .tp-family-tab-count { background: var(--tp-accent-soft); color: var(--tp-accent-soft-fg); }

/* Go to (components/GoToPalette.tsx): one search over every page. The field is
   the dialog's first thing and its largest; the list scrolls inside the
   dialog, the highlighted option carries the selection ground. */
.tp-goto-input {
  inline-size: 100%; box-sizing: border-box; min-block-size: 3rem;
  padding-block: 0.5rem; padding-inline: 2.5rem 0.75rem;
  border: 1px solid var(--tp-border-input); border-radius: var(--tp-radius-ctl);
  background: var(--tp-surface); color: var(--tp-fg);
  font: inherit; font-size: var(--tp-fs-lg);
}
.tp-goto-list {
  list-style: none; margin: 0; padding: 0;
  max-block-size: min(26rem, 55vh); overflow-y: auto;
  border: 1px solid var(--tp-border); border-radius: var(--tp-radius-panel);
}
.tp-goto-option {
  display: flex; align-items: baseline; justify-content: space-between; gap: var(--tp-sp-3);
  padding-block: var(--tp-sp-2); padding-inline: var(--tp-sp-3);
  min-block-size: var(--tp-touch); box-sizing: border-box;
  border-block-end: 1px solid var(--tp-border); cursor: pointer;
}
.tp-goto-option:last-child { border-block-end: none; }
.tp-goto-option[aria-selected='true'] { background: var(--tp-selected); color: var(--tp-selected-fg); }
.tp-goto-option[aria-selected='true'] span { color: inherit !important; }
.tp-goto-kbd {
  flex-shrink: 0; font: inherit; font-size: var(--tp-fs-xs); font-variant-numeric: tabular-nums;
  padding-inline: 0.35rem; border: 1px solid var(--tp-rail-border); border-radius: var(--tp-radius-ctl);
  color: var(--tp-rail-muted);
}
.tp-link { color: var(--tp-accent); text-decoration: none; }
.tp-link:hover { text-decoration: underline; background: var(--tp-hover); color: var(--tp-hover-fg); }

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
.tp-infotip-trigger:focus-visible { color: var(--tp-fg); }
.tp-infotip-trigger:hover:not(:disabled) { background: var(--tp-hover); color: var(--tp-hover-fg); }

/* ---- navigation rail ---- */
.tp-nav-item {
  display: flex; align-items: center; gap: 0.6rem;
  padding-block: 0.5rem; padding-inline: 0.7rem;
  border-radius: var(--tp-radius-ctl);
  color: var(--tp-rail-fg); text-decoration: none; font-weight: 500;
  min-block-size: var(--tp-touch);
  transition: background var(--tp-dur-fast) var(--tp-ease-out), color var(--tp-dur-fast) var(--tp-ease-out);
}
/* A rail row that is a <button> (railStyles navButtonStyle): transparent at
   rest. Scores below :hover and [data-active], so both still paint it. */
button.tp-nav-item { background: transparent; }
.tp-nav-item:hover { background: var(--tp-rail-2); }
/* The current page is a Padel Green pill (2026-10-17), so its label and icon
   take the pill's own ink: the rail's white measures 1.9:1 on the green. */
.tp-nav-item[data-active='true'] { background: var(--tp-rail-active); color: var(--tp-rail-active-fg); font-weight: 700; }
/* Drawn INSIDE the row: the collapsible groups' body is overflow: hidden, so
   the default 2px outset ring was cut off on every edge of a nested row. */
.tp-nav-item:focus-visible { outline-color: var(--tp-rail-green); outline-offset: -2px; }
/* A green ring inside a green pill is invisible; on the pill it is the ink. */
.tp-nav-item[data-active='true']:focus-visible { outline-color: var(--tp-rail-active-fg); }
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

   The workspace's own groups (Run the day, Records, Setup) wear the same
   indent and stem (owner call, 2026-09-27), so every drawer on the rail opens
   the same way. The stem is a ::before rather than a border-inline-start, so it
   stops at the last row instead of running through the padding above it, and
   inset-inline-start makes RTL mirror it for free. It is marked on the LIST and
   not on the animating body, which owns the 0fr->1fr track: padding there would
   leave the shut drawer a few pixels tall instead of nothing. */
/* The stem hangs from the title's first letter (.tp-nav-item's 0.7rem inline
   padding, plus a hair so it clears the glyph's side bearing), and the rows
   step in past it, so each line reads as coming down out of its own title
   rather than running along the rail's edge. */
.tp-rail-options-list {
  position: relative;
  padding-inline-start: 1.25rem;
}
.tp-rail-options-list::before {
  content: ''; position: absolute;
  inset-block: 0.25rem; inset-inline-start: 0.75rem;
  inline-size: 1px; background: var(--tp-rail-border);
}
/* Options' title leads with its gear, so there the stem drops from the gear's
   centre (0.7rem padding + half of the 16px icon) and the rows step in until
   their icons stand under the word "Options" (padding + icon + the 0.6rem gap,
   less the row's own 0.7rem padding). */
.tp-rail-options-list[data-lead='icon'] { padding-inline-start: calc(16px + 0.6rem); }
.tp-rail-options-list[data-lead='icon']::before { inset-inline-start: calc(0.7rem + 8px - 0.5px); }
.tp-nav-item[data-active='true'] svg { opacity: 1; color: var(--tp-rail-active-fg); }
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
.tp-rail-back:hover { background: var(--tp-rail-active); border-color: var(--tp-rail-green); color: var(--tp-rail-active-fg); }
/* Dark mode's keyboard focus on the rail is a calmer green than the bright
   Padel Green (Sait, 2026-10-30). */
:root[data-theme='operator'][data-mode='blue'] :is(.tp-nav-item:not([data-active='true']), .tp-rail-btn.tp-btn, .tp-rail-back):focus-visible { outline-color: #6F8F45; }
/* Same frame-of-the-press nudge as .tp-btn, and for the same reason. */
.tp-rail-back:active { transform: translateY(1px); }
.tp-rail-back:focus-visible { outline-color: var(--tp-rail-green); }
/* No transform here: [dir='rtl'] svg[data-chevron] owns the chevron's, and a
   hover nudge would overwrite the mirror and point the arrow the wrong way in
   Arabic. Colour is the whole affordance. */
.tp-rail-back svg { color: var(--tp-rail-green); }
.tp-rail-back:hover svg { color: var(--tp-rail-active-fg); }

/* ---- tables ---- */
.tp-table { inline-size: 100%; border-collapse: separate; border-spacing: 0; font-variant-numeric: tabular-nums; }
.tp-table th {
  position: sticky; inset-block-start: 0; z-index: var(--tp-z-table-head);
  /* The Breakdown's group band (Sait, 2026-10-19): Touch Blue on paper, the
     brighter blue in blue mode, white 14px bold labels, one fixed height. */
  background: var(--tp-table-head); color: var(--tp-table-head-fg);
  /* Was 12px ALL-CAPS with tracking — the worst case for a bright venue at
     arm's length, and rulebook 6.2 wants the header to read as the same words
     as the field on the detail page. Weight and colour carry it instead. */
  font-size: var(--tp-fs-md); font-weight: 700;
  text-align: start; block-size: var(--tp-row-h-head); padding-block: 0.45rem; padding-inline: 0.75rem;
  white-space: nowrap;
}
/* One floor, one place. rulebook 6.8 wants >=40px; this used to be whatever
   the padding happened to add up to (~32px). */
.tp-table td { block-size: var(--tp-row-h); padding-block: 0.45rem; padding-inline: 0.75rem; border-block-end: 1px solid var(--tp-border); vertical-align: middle; }
.tp-table tr:last-child td { border-block-end: none; }
.tp-table [data-align='end'] { text-align: end; }
.tp-table [data-align='center'] { text-align: center; }
.tp-table th[data-sortable='true'] { cursor: pointer; }
.tp-table th[data-sortable='true']:hover { background: var(--tp-hover); color: var(--tp-hover-fg); }
.tp-table tbody tr[data-clickable='true'] { cursor: pointer; }
.tp-table tbody tr[data-clickable='true']:hover td:not([data-group-cell]) { background: var(--tp-hover); color: var(--tp-hover-fg); }
/* :hover listed too, so pointing at the selected row does not repaint it pale.
   Green with navy ink in both modes; theme.ts pins grey text inside it to navy. */
.tp-table tbody tr[data-selected='true'] td:not([data-group-cell]),
.tp-table tbody tr[data-selected='true']:hover td:not([data-group-cell]) { background: var(--tp-selected); color: var(--tp-selected-fg); }
.tp-table[data-dense='true'] td { block-size: var(--tp-row-h-dense); padding-block: 0.25rem; }
/* The total row is Padel Green and stays at the bottom while the rows scroll. */
.tp-table tfoot td {
  position: sticky; inset-block-end: 0; z-index: var(--tp-z-table-head);
  background: var(--tp-table-total); color: var(--tp-table-total-fg); font-weight: 700;
  block-size: var(--tp-row-h); padding-block: 0.45rem; padding-inline: 0.75rem;
}
/* A group column (DataTable groupColumn, the drill's Day column): one cell
   beside each group's rows, its content riding down as they scroll, and ONE
   line between groups — the last row of a group drops its own line. */
.tp-table td[data-group-cell] { vertical-align: top; background: var(--tp-surface-2); border-inline-end: 1px solid var(--tp-border); border-block-end: none; padding-block: 0.6rem; padding-inline: 0.5rem; }
.tp-table-group-cell { position: sticky; inset-block-start: calc(var(--tp-thead-h, 0px) + 0.6rem); display: grid; justify-items: center; line-height: 1.15; }
.tp-table tbody tr[data-group-end='true'] td { border-block-end: none; }
.tp-table tbody tr[data-group-start='true'] td { border-block-start: 1px solid var(--tp-border-strong); }
.tp-table tbody tr[data-group-start='true']:first-child td { border-block-start: none; }
/* The table's vertical scrollbar is DRAWN (Sait, 2026-10-19): a thin thumb
   over the rows, only between the column header and the total row, so both
   reach the full width and nothing sits beside them (DataTable places it, as
   the Breakdown's list does). The native vertical bar is hidden; the sideways
   one stays for a table wider than its page. No rubber band either: at the
   first or last row the elastic overscroll dragged the sticky header and total
   row into the table and snapped them back. Only a table that scrolls inside
   itself (fill / maxBlockSize) gets that: one that grows with the page must
   hand the wheel on, or the page cannot be scrolled with the pointer over it. */
.tp-table-frame { position: relative; }
.tp-table-scroll { scrollbar-width: auto; scrollbar-color: auto; overscroll-behavior-x: none; }
.tp-table-scroll[data-inner-scroll] { overscroll-behavior: none; }
.tp-table-scroll::-webkit-scrollbar { width: 0; height: 10px; background: transparent; }
.tp-table-scroll::-webkit-scrollbar-thumb { background: var(--tp-border-strong); border-radius: var(--tp-radius-pill); border: 2px solid transparent; background-clip: padding-box; }
.tp-table-scroll::-webkit-scrollbar-corner { background: transparent; }
@supports not selector(::-webkit-scrollbar) { .tp-table-scroll { scrollbar-width: none; } }
.tp-table-thumb {
  position: absolute; inset-inline-end: 3px; inline-size: 6px; z-index: calc(var(--tp-z-table-head) + 1);
  border-radius: var(--tp-radius-pill); background: color-mix(in oklab, var(--tp-fg) 35%, transparent);
  cursor: grab; touch-action: none;
}
.tp-table-thumb:hover, .tp-table-thumb:active { background: color-mix(in oklab, var(--tp-fg) 55%, transparent); }

/* ---- segmented buttons (Sait, 2026-10-19) ----
   A light grey track on paper, the accent blue on the blue page; the chosen
   segment is a thumb (Touch Blue on paper, Padel Green in blue mode) that slides to the new choice — an asked-for
   exception to "nothing the operator causes animates", like the Breakdown's
   View more. Until the thumb is placed (first paint, jsdom) the chosen button
   paints the green itself. The full-width form is a pill. */
.tp-seg { position: relative; display: inline-flex; align-items: stretch; gap: 2px; padding: 3px; background: var(--tp-seg-track); border: 1px solid var(--tp-seg-edge); border-radius: var(--tp-radius-panel); max-inline-size: 100%; }
.tp-seg[data-block='true'] { display: flex; inline-size: 100%; border-radius: var(--tp-radius-pill); }
.tp-seg-btn {
  position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 0.35rem;
  border: none; background: transparent; color: var(--tp-seg-fg); border-radius: calc(var(--tp-radius-panel) - 3px);
  padding-block: 0.35rem; padding-inline: 0.8rem; font: inherit; font-size: var(--tp-fs-md); font-weight: 600;
  cursor: pointer; white-space: nowrap;
  transition: background var(--tp-dur-fast) var(--tp-ease-out), color var(--tp-dur-fast) var(--tp-ease-out);
}
/* On the analytics bar the tab strip stands on the same height as the dropdowns beside it (it ran ~3px taller). */
#analytics-bar .tp-seg, .tp-filter-line .tp-seg { box-sizing: border-box; min-block-size: var(--tp-row-h); }
#analytics-bar .tp-seg-btn, .tp-filter-line .tp-seg-btn { padding-block: 0.2rem; }
.tp-seg[data-size='sm'] .tp-seg-btn { padding-block: 0.2rem; padding-inline: 0.55rem; font-size: var(--tp-fs-sm); }
.tp-seg[data-block='true'] .tp-seg-btn { flex: 1 1 0; justify-content: center; min-inline-size: 0; min-block-size: var(--tp-touch); border-radius: var(--tp-radius-pill); }
/* A link strip (family tabs) drawn as the segmented control: aria-current marks the page. */
.tp-seg-btn { text-decoration: none; }
.tp-seg:not([data-thumb='true']) .tp-seg-btn[aria-current='page'] { background: var(--tp-seg-on); color: var(--tp-seg-on-fg); font-weight: 700; }
/* aria-selected: the same look on a role="tab" strip (the Analytics Courts | Café switch). */
.tp-seg-btn:hover:not(:disabled):not([aria-pressed='true']):not([aria-selected='true']) { background: var(--tp-seg-hover); }
.tp-seg-btn[aria-pressed='true'], .tp-seg-btn[aria-selected='true'] { color: var(--tp-seg-on-fg); font-weight: 700; }
.tp-seg:not([data-thumb='true']) .tp-seg-btn[aria-pressed='true'], .tp-seg:not([data-thumb='true']) .tp-seg-btn[aria-selected='true'] { background: var(--tp-seg-on); }
.tp-seg-btn:disabled { cursor: not-allowed; opacity: var(--tp-opacity-disabled); }
.tp-seg-thumb { position: absolute; z-index: 0; background: var(--tp-seg-on); border-radius: calc(var(--tp-radius-panel) - 3px); box-shadow: var(--tp-shadow-raised); pointer-events: none; }
.tp-seg[data-block='true'] .tp-seg-thumb { border-radius: var(--tp-radius-pill); }
.tp-seg[data-animate='true'] .tp-seg-thumb {
  transition: inset-inline-start 220ms cubic-bezier(0.3, 0.7, 0.2, 1), inline-size 220ms cubic-bezier(0.3, 0.7, 0.2, 1), inset-block-start 220ms ease;
}
@media (prefers-reduced-motion: reduce) { .tp-seg-thumb { transition: none !important; } }
.tp-seg-n { font-size: var(--tp-fs-xs); font-weight: 600; padding-inline: 0.4rem; min-inline-size: 1.25rem; line-height: 1.15rem; border-radius: var(--tp-radius-pill); text-align: center; font-variant-numeric: tabular-nums; background: color-mix(in oklab, currentColor 16%, transparent); }

/* ---- kitchen board ---- */
[data-workspace='prep'] { background: var(--tp-kds-bg); color: var(--tp-kds-fg); }
[data-workspace='prep'] .tp-btn { background: var(--tp-kds-card-2); border-color: var(--tp-kds-border); color: var(--tp-kds-fg); }
[data-workspace='prep'] .tp-btn[data-kind='primary'] { background: var(--tp-kds-fresh); border-color: var(--tp-kds-fresh); color: var(--tp-brand-black); }
[data-workspace='prep'] .tp-btn:hover:not(:disabled) { background: var(--tp-hover); color: var(--tp-hover-fg); }
[data-workspace='prep'] .tp-btn[data-kind='primary']:hover:not(:disabled) { background: var(--tp-kds-fresh); border-color: var(--tp-kds-fresh); color: var(--tp-brand-black); filter: brightness(1.1); }
[data-workspace='prep'] :focus-visible { outline-color: var(--tp-kds-fg); }
[data-workspace='prep'] input[type='checkbox'] { accent-color: var(--tp-kds-fresh); }
[data-workspace='prep'] kbd { background: var(--tp-kds-card-2); border-color: var(--tp-kds-border); color: var(--tp-kds-muted); }
/* The light-theme scrollbar painted a near-white bar down a 16%-lightness board. */
[data-workspace='prep'] * { scrollbar-color: var(--tp-kds-border) transparent; }
[data-workspace='prep'] ::selection { background: var(--tp-kds-card-2); color: var(--tp-kds-fg); }
[data-workspace='prep'] .tp-skel { background: var(--tp-kds-card-2); }
[data-workspace='prep'] .tp-skel::after { background: linear-gradient(90deg, transparent, var(--tp-kds-border), transparent); }
/* A dialog over the board (Modal tone="board"): the desk tokens re-pointed at
   the board's own, so the panel is dark like the wall it opens on. Only
   existing tokens: --tp-kds-* already carry their blue-mode values. */
[data-tone='board'] {
  --tp-surface: var(--tp-kds-card);
  --tp-surface-2: var(--tp-kds-card-2);
  --tp-surface-3: var(--tp-kds-card-2);
  --tp-fg: var(--tp-kds-fg);
  --tp-muted-fg: var(--tp-kds-muted);
  --tp-border: var(--tp-kds-border);
  --tp-border-strong: var(--tp-kds-border);
  --tp-accent: var(--tp-kds-fresh);
  --tp-accent-soft: var(--tp-kds-card-2);
  --tp-accent-soft-fg: var(--tp-kds-fg);
  --tp-hover: var(--tp-kds-card-2);
  --tp-hover-fg: var(--tp-kds-fg);
  color: var(--tp-kds-fg);
}
[data-tone='board'] :focus-visible { outline-color: var(--tp-kds-fg); }
[data-tone='board'] input[type='checkbox'] { accent-color: var(--tp-kds-fresh); }
[data-tone='board'] * { scrollbar-color: var(--tp-kds-border) transparent; }

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

/* ---- the till's floor board (features/till/FloorView): the tables' paint ----
   The geometry is inline; the paint is here because the pointer changes it.
   A table is a stack of flat slices (.tp-floor-side, its walls) under a top
   (.tp-floor-top). Free is the board's plain table, a live tab is Padel Green
   with a glow, and waiting for payment keeps the green top and turns the
   walls amber. The table under the pointer (or with keyboard focus) takes the
   mode's hover colour, top and walls (brand blue on paper, white on blue),
   except that paying walls stay amber. */
.tp-floor-table { cursor: pointer; padding: 0; border: 0; background: transparent; font: inherit; color: inherit; }
/* The sides fade with the top, so a hover changes the whole table at once.
   They stay hittable: the side band is part of the table under the finger,
   and what lies beneath it is the floor. */
.tp-floor-table .tp-floor-side {
  background: var(--tp-floor-free-side);
  transition: background var(--tp-dur-fast) var(--tp-ease-out);
}
.tp-floor-table .tp-floor-top {
  background: var(--tp-floor-free); color: var(--tp-floor-fg); border: 1px solid var(--tp-floor-free-side);
  transition: background var(--tp-dur-fast) var(--tp-ease-out), box-shadow var(--tp-dur-fast) var(--tp-ease-out);
}
.tp-floor-table[data-status='open'] .tp-floor-side, .tp-floor-table[data-status='paying'] .tp-floor-side { background: var(--tp-floor-success-side); }
.tp-floor-table[data-status='open'] .tp-floor-top, .tp-floor-table[data-status='paying'] .tp-floor-top {
  background: var(--tp-success); color: var(--tp-accent-2-contrast); border-color: var(--tp-floor-success-side);
  box-shadow: 0 0 calc(var(--tp-floor-m) * 0.3) var(--tp-floor-live-glow);
}
.tp-floor-table[data-status='paying'] .tp-floor-side { background: var(--tp-floor-warn-side); }
.tp-floor-table[data-status='paying'] .tp-floor-top { border: 3px solid var(--tp-warn); }
.tp-floor-table:hover .tp-floor-top, .tp-floor-table:focus-visible .tp-floor-top {
  background: var(--tp-floor-hover); color: var(--tp-floor-hover-fg); border-color: var(--tp-floor-hover-side);
  box-shadow: 0 0 calc(var(--tp-floor-m) * 0.35) var(--tp-floor-hover-glow);
}
.tp-floor-table:hover .tp-floor-side, .tp-floor-table:focus-visible .tp-floor-side { background: var(--tp-floor-hover-side); }
.tp-floor-table[data-status='paying']:hover .tp-floor-top, .tp-floor-table[data-status='paying']:focus-visible .tp-floor-top { border-color: var(--tp-warn); }
.tp-floor-table[data-status='paying']:hover .tp-floor-side, .tp-floor-table[data-status='paying']:focus-visible .tp-floor-side { background: var(--tp-floor-warn-side); }
/* A guest calling from a table: the bell pulses, unless motion is reduced. */
@keyframes tp-floor-bell { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18); } }
.tp-floor-bell { animation: tp-floor-bell 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .tp-floor-bell { animation: none; } }

/* A report figure group (FigureGroup in reports/ReportParts): a colour strip
   on top and a tint of the same colour behind the tiles. The colour comes
   from the group's place in its band: the owner's four card colours
   (--tp-card-1..6: green, violet, rose, light blue, teal, gold, Sait
   2026-10-19), then round again from the seventh. Blue mode keeps the strip (its tokens are the calm
   light inks) but not the tint, which went murky on a blue panel. */
.tp-figure-group { background: color-mix(in oklab, var(--tp-tone) var(--tp-tone-tint), var(--tp-surface)); --tp-tone-tint: 20%; }
.tp-figure-group:nth-child(6n + 1), .tp-figure-panel:nth-child(6n + 1) { --tp-tone: var(--tp-card-1); }
.tp-figure-group:nth-child(6n + 2), .tp-figure-panel:nth-child(6n + 2) { --tp-tone: var(--tp-card-2); }
.tp-figure-group:nth-child(6n + 3), .tp-figure-panel:nth-child(6n + 3) { --tp-tone: var(--tp-card-3); }
.tp-figure-group:nth-child(6n + 4), .tp-figure-panel:nth-child(6n + 4) { --tp-tone: var(--tp-card-4); }
.tp-figure-group:nth-child(6n + 5), .tp-figure-panel:nth-child(6n + 5) { --tp-tone: var(--tp-card-5); }
.tp-figure-group:nth-child(6n + 6), .tp-figure-panel:nth-child(6n + 6) { --tp-tone: var(--tp-card-6); }
/* The same colours on the workspace tiles (.tp-figure-panel): only the strip
   on top, no tint. A card with the blue title band wears no strip (owner,
   2026-10-18). */
:root[data-theme='operator'][data-mode='blue'] .tp-figure-group { background: var(--tp-surface-2); }

/* The same four colours picked by name rather than by place: the analytics
   cards (CardShell) mix them, so each card says which one it wears. The names
   are the old colours' (2026-09-24); each now wears the new colour of the
   same place (blue → green, green → violet, black → rose, sky → light blue). */
.tp-tone-card[data-tone='blue'] { --tp-tone: var(--tp-card-1); }
.tp-tone-card[data-tone='green'] { --tp-tone: var(--tp-card-2); }
.tp-tone-card[data-tone='black'] { --tp-tone: var(--tp-card-3); }
.tp-tone-card[data-tone='sky'] { --tp-tone: var(--tp-card-4); }

/* Every figure tile in the app (HeadlineFigure) wears the same strip, by its
   place in its row: the owner's six card colours, then round again. Inside a
   report figure group the group's card carries the colour, so its tiles drop
   back to the plain border (initial = unset, so the inline fallback). */
.tp-headline-tile:nth-child(6n + 1) { --tp-tile-strip: 3px solid var(--tp-card-1); }
.tp-headline-tile:nth-child(6n + 2) { --tp-tile-strip: 3px solid var(--tp-card-2); }
.tp-headline-tile:nth-child(6n + 3) { --tp-tile-strip: 3px solid var(--tp-card-3); }
.tp-headline-tile:nth-child(6n + 4) { --tp-tile-strip: 3px solid var(--tp-card-4); }
.tp-headline-tile:nth-child(6n + 5) { --tp-tile-strip: 3px solid var(--tp-card-5); }
.tp-headline-tile:nth-child(6n + 6) { --tp-tile-strip: 3px solid var(--tp-card-6); }
/* Weighted past the blue-mode rules above (:root + two attributes + class +
   nth-child), so a grouped tile stays plain in both modes. */
:root .tp-figure-group .tp-headline-tile.tp-headline-tile.tp-headline-tile.tp-headline-tile { --tp-tile-strip: initial; }

/* The assistant's green (Sait, 2026-10-20): in dark (blue) mode the question
   box's edge, Ask, New chat and the paid/free switch wear Padel Green with
   its navy ink; light mode keeps the brand blue. */
.tp-assistant-box { border: 1.5px solid var(--tp-accent); box-shadow: 0 4px 16px color-mix(in oklab, var(--tp-accent) 12%, transparent); }
.tp-assistant-ask { background: var(--tp-accent); color: var(--tp-accent-contrast); }
.tp-assistant-ask:disabled { background: var(--tp-disabled-bg); color: var(--tp-disabled-fg); }
:root[data-theme='operator'][data-mode='blue'] .tp-assistant-box { border-color: var(--tp-brand-green); box-shadow: 0 4px 16px color-mix(in oklab, var(--tp-brand-green) 18%, transparent); }
/* The line you type on has no frame of its own inside the box (Sait,
   2026-10-20): the box is the field, so focus thickens the box's edge instead
   of drawing the global ring around the textarea. */
.tp-assistant-input:focus-visible { outline: none; box-shadow: none; }
.tp-assistant-box:focus-within { box-shadow: 0 0 0 1px var(--tp-accent), 0 4px 16px color-mix(in oklab, var(--tp-accent) 18%, transparent); }
:root[data-theme='operator'][data-mode='blue'] .tp-assistant-box:focus-within { box-shadow: 0 0 0 1px #6F8F45, 0 4px 16px color-mix(in oklab, #6F8F45 26%, transparent); }
:root[data-theme='operator'][data-mode='blue'] .tp-assistant-ask:not(:disabled),
:root[data-theme='operator'][data-mode='blue'] .tp-btn.tp-assistant-green { background: var(--tp-accent-2); border-color: var(--tp-accent-2); color: var(--tp-accent-2-contrast); }
:root[data-theme='operator'][data-mode='blue'] .tp-assistant-ask:not(:disabled):hover,
:root[data-theme='operator'][data-mode='blue'] .tp-btn.tp-assistant-green:hover:not(:disabled) { background: color-mix(in oklab, var(--tp-accent-2) 88%, var(--tp-brand-white)); border-color: var(--tp-accent-2); color: var(--tp-accent-2-contrast); }

/* New chat, light mode: the darker brand-blue shades, so it stands out on the
   rail-blue toolbar (Sait, 2026-10-20). Dark mode keeps the green above. */
.tp-btn.tp-assistant-new[data-kind='primary'] { background: var(--tp-accent-active); border-color: var(--tp-accent-active); color: var(--tp-accent-contrast); }
.tp-btn.tp-assistant-new[data-kind='primary']:hover:not(:disabled) { background: var(--tp-accent-2-contrast); border-color: var(--tp-accent-2-contrast); color: var(--tp-accent-contrast); }

/* The chat toolbar (Thread, FreeThread): in light mode the strip wears the
   rail's own blue, the subject in the rail's ink; its buttons keep their own
   colours. Dark (blue) mode keeps the panel surface (Sait, 2026-10-20). */
.tp-assistant-toolbar { background: var(--tp-rail); border: 1px solid var(--tp-rail-border); color: var(--tp-rail-fg); }
:root[data-theme='operator'][data-mode='blue'] .tp-assistant-toolbar { background: var(--tp-surface); border-color: var(--tp-border); color: var(--tp-fg); }

/* The assistant's pop-up panels (ToolbarPopover) fade and settle from their
   button, and fade back on close; the chevron turns instead of swapping. */
.tp-pop { opacity: 0; transform: translateY(6px) scale(0.98); transition: opacity var(--tp-dur-fast) var(--tp-ease-out), transform var(--tp-dur-base) var(--tp-ease-settle); }
.tp-pop[data-side='below'] { transform: translateY(-6px) scale(0.98); transform-origin: top; }
.tp-pop[data-side='above'] { transform-origin: bottom; }
.tp-pop[data-shown] { opacity: 1; transform: none; }
.tp-pop-chevron { transition: transform var(--tp-dur-base) var(--tp-ease-settle); }
.tp-pop-chevron[data-flip] { transform: rotate(180deg); }
@media (prefers-reduced-motion: reduce) { .tp-pop, .tp-pop-chevron { transition: none; } }

/* The chat list rows (ChatListView, design L1): a soft hover, the open chat
   tinted, its archive/delete action shown on hover or keyboard focus. */
.tp-chat-row { transition: box-shadow var(--tp-dur-fast) var(--tp-ease-out), background-color var(--tp-dur-fast) var(--tp-ease-out); }
.tp-chat-row:hover:not([data-active]) { background: color-mix(in oklab, var(--tp-hover) 55%, transparent); }
.tp-chat-row[data-active] { background: var(--tp-accent-soft); }
/* The chat list's day labels: the day in a colour apart from the rows, and a
   rule of the same colour, faint, running on to the row's end. */
.tp-chat-day { color: var(--tp-accent-active); }
.tp-chat-day-rule { background: color-mix(in oklab, currentColor 30%, transparent); }
:root[data-theme='operator'][data-mode='blue'] .tp-chat-day { color: var(--tp-brand-green); }
/* The open chat's side bar: brand blue in light mode, Padel Green in dark (Sait, 2026-10-20). */
.tp-chat-bar { background: var(--tp-accent); }
:root[data-theme='operator'][data-mode='blue'] .tp-chat-bar { background: var(--tp-brand-green); }
/* Dark mode: the open chat is a deep, faintly green row, not the bright
   accent-soft blue, so its scope dots and its text read clearly on it. */
:root[data-theme='operator'][data-mode='blue'] .tp-chat-row[data-active] { background: color-mix(in oklab, var(--tp-brand-green) 14%, var(--tp-surface)); }
/* Hover (or keyboard focus) swaps the row's end column as drawn: the action
   takes the cost's place at the top, the cost moves down over the time. */
.tp-chat-act, .tp-chat-cost-low { visibility: hidden; }
.tp-chat-row:hover .tp-chat-act, .tp-chat-row:focus-within .tp-chat-act,
.tp-chat-row:hover .tp-chat-cost-low, .tp-chat-row:focus-within .tp-chat-cost-low { visibility: visible; }
.tp-chat-row:hover .tp-chat-cost, .tp-chat-row:focus-within .tp-chat-cost,
.tp-chat-row:hover .tp-chat-time, .tp-chat-row:focus-within .tp-chat-time { visibility: hidden; }
.tp-chat-act-btn { inline-size: 26px; block-size: 26px; border-radius: 8px; border: none; background: color-mix(in oklab, currentColor 10%, transparent); color: inherit; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background-color var(--tp-dur-fast) var(--tp-ease-out); }
.tp-chat-act-btn:hover { background: color-mix(in oklab, currentColor 18%, transparent); }

/* "Ask next" (Thread): an accent-outlined pill that fills softly on hover. */
.tp-follow-up { border: 1px solid var(--tp-accent); background: var(--tp-surface); color: var(--tp-accent-active); transition: background-color var(--tp-dur-fast) var(--tp-ease-out); }
.tp-follow-up:hover:not(:disabled) { background: var(--tp-accent-soft); }
/* The assistant's hand-drawn buttons (popover triggers, scope chips, quick
   sets) set their colours inline, so hover lays a tint of their own ink over
   whatever fill they have, light or dark. */
.tp-hover-tint { transition: box-shadow var(--tp-dur-fast) var(--tp-ease-out); }
.tp-hover-tint:hover:not(:disabled) { box-shadow: inset 0 0 0 100vmax color-mix(in oklab, currentColor 9%, transparent); }

/* The cost panel's "Usage and limits" button (Thread): colours here so it has a hover. */
.tp-cost-usage { border: 1px solid var(--tp-border-strong); background: var(--tp-surface-2); color: var(--tp-accent-active); transition: background-color var(--tp-dur-fast) var(--tp-ease-out), border-color var(--tp-dur-fast) var(--tp-ease-out); }
.tp-cost-usage:hover { background: var(--tp-accent-soft); border-color: var(--tp-accent); color: var(--tp-accent-active); }

/* The assistant's starter cards (StartScreen). Light mode: the card is its
   pastel (--tp-card-n) with ink on it and frosted question rows. Dark (blue)
   mode: dressed like the Breakdown cards below — the deep colour as the title
   band, a wash of it behind the questions, its edge as the outline — so the
   two read as one family (Sait, 2026-10-20). */
.tp-starter[data-tone='green'] { --tp-st: var(--tp-card-1); --tp-bd: var(--tp-breakdown-green); --tp-bd-fg: var(--tp-breakdown-green-fg); --tp-bd-edge: var(--tp-breakdown-green-edge); }
.tp-starter[data-tone='violet'] { --tp-st: var(--tp-card-2); --tp-bd: var(--tp-breakdown-violet); --tp-bd-fg: var(--tp-breakdown-violet-fg); --tp-bd-edge: var(--tp-breakdown-violet-edge); }
.tp-starter[data-tone='rose'] { --tp-st: var(--tp-card-3); --tp-bd: var(--tp-breakdown-rose); --tp-bd-fg: var(--tp-breakdown-rose-fg); --tp-bd-edge: var(--tp-breakdown-rose-edge); }
.tp-starter[data-tone='sky'] { --tp-st: var(--tp-card-4); --tp-bd: var(--tp-breakdown-sky); --tp-bd-fg: var(--tp-breakdown-sky-fg); --tp-bd-edge: var(--tp-breakdown-sky-edge); }
.tp-starter[data-tone='teal'] { --tp-st: var(--tp-card-5); --tp-bd: var(--tp-breakdown-teal); --tp-bd-fg: var(--tp-breakdown-teal-fg); --tp-bd-edge: var(--tp-breakdown-teal-edge); }
.tp-starter[data-tone='gold'] { --tp-st: var(--tp-card-6); --tp-bd: var(--tp-breakdown-gold); --tp-bd-fg: var(--tp-breakdown-gold-fg); --tp-bd-edge: var(--tp-breakdown-gold-edge); }
.tp-starter { background: var(--tp-st); color: var(--tp-card-ink); border: 1px solid transparent; }
.tp-starter-head { color: var(--tp-card-ink); }
.tp-starter-q { background: color-mix(in oklab, var(--tp-brand-white) 72%, transparent); color: var(--tp-card-ink); transition: background-color var(--tp-dur-fast) var(--tp-ease-out); }
.tp-starter-q:hover:not(:disabled) { background: color-mix(in oklab, var(--tp-brand-white) 90%, transparent); }
/* A starter question inside a Breakdown-style card (Sait, 2026-10-20): a full
   row, a rule above every row but the first, the card's hover wash. */
.tp-starter-row { display: block; inline-size: 100%; text-align: start; border: none; background: transparent; color: var(--tp-fg); font: inherit; cursor: pointer; padding-block: var(--tp-sp-2-5); padding-inline: var(--tp-sp-3); min-block-size: 2.75rem; transition: background-color var(--tp-dur-fast) var(--tp-ease-out); }
.tp-starter-row + .tp-starter-row { border-block-start: 1px solid color-mix(in oklab, var(--tp-bd-edge) 35%, transparent); }
.tp-starter-row:hover:not(:disabled) { background: var(--tp-hover); color: var(--tp-hover-fg); }
.tp-starter-row:disabled { cursor: default; opacity: var(--tp-opacity-disabled); }
/* The free AI's page tiles wear a card's tone and deepen a little on hover. */
.tp-starter-tile { transition: background-color var(--tp-dur-fast) var(--tp-ease-out); }
.tp-starter-tile:hover { background: color-mix(in oklab, var(--tp-st) 92%, var(--tp-card-ink)); }
:root[data-theme='operator'][data-mode='blue'] .tp-starter-tile:hover { background: color-mix(in oklab, color-mix(in oklab, var(--tp-bd) var(--tp-breakdown-hover-mix), var(--tp-breakdown-wash)), var(--tp-bd-fg) var(--tp-breakdown-hover-lift)); }
:root[data-theme='operator'][data-mode='blue'] .tp-starter {
  background: color-mix(in oklab, var(--tp-bd) var(--tp-breakdown-wash-mix), var(--tp-breakdown-wash));
  border-color: var(--tp-bd-edge);
  color: var(--tp-fg);
}
:root[data-theme='operator'][data-mode='blue'] .tp-starter-head { background: var(--tp-bd); color: var(--tp-bd-fg); }
:root[data-theme='operator'][data-mode='blue'] .tp-starter-q {
  background: color-mix(in oklab, var(--tp-bd) 30%, var(--tp-breakdown-wash));
  color: var(--tp-fg);
}
:root[data-theme='operator'][data-mode='blue'] .tp-starter-q:hover:not(:disabled) {
  background: color-mix(in oklab, color-mix(in oklab, var(--tp-bd) var(--tp-breakdown-hover-mix), var(--tp-breakdown-wash)), var(--tp-bd-fg) var(--tp-breakdown-hover-lift));
}

/* The management overview's Breakdown cards (Sait, 2026-10-19). Each card
   wears one colour (data-tone): its title band, its outline, and a wash of it
   behind the rows, which a hovered row deepens. Every text on the card is the
   page's own ink, labels and flat changes included (no muted grey), so the
   muted token is lifted to it here. The tokens carry both modes, so nothing
   below needs a blue-mode rule. */
.tp-breakdown-card[data-tone='green'] { --tp-bd: var(--tp-breakdown-green); --tp-bd-fg: var(--tp-breakdown-green-fg); --tp-bd-edge: var(--tp-breakdown-green-edge); }
.tp-breakdown-card[data-tone='violet'] { --tp-bd: var(--tp-breakdown-violet); --tp-bd-fg: var(--tp-breakdown-violet-fg); --tp-bd-edge: var(--tp-breakdown-violet-edge); }
.tp-breakdown-card[data-tone='rose'] { --tp-bd: var(--tp-breakdown-rose); --tp-bd-fg: var(--tp-breakdown-rose-fg); --tp-bd-edge: var(--tp-breakdown-rose-edge); }
.tp-breakdown-card[data-tone='sky'] { --tp-bd: var(--tp-breakdown-sky); --tp-bd-fg: var(--tp-breakdown-sky-fg); --tp-bd-edge: var(--tp-breakdown-sky-edge); }
.tp-breakdown-card[data-tone='teal'] { --tp-bd: var(--tp-breakdown-teal); --tp-bd-fg: var(--tp-breakdown-teal-fg); --tp-bd-edge: var(--tp-breakdown-teal-edge); }
.tp-breakdown-card[data-tone='gold'] { --tp-bd: var(--tp-breakdown-gold); --tp-bd-fg: var(--tp-breakdown-gold-fg); --tp-bd-edge: var(--tp-breakdown-gold-edge); }
.tp-breakdown-card {
  --tp-hover: color-mix(in oklab, color-mix(in oklab, var(--tp-bd) var(--tp-breakdown-hover-mix), var(--tp-breakdown-wash)), var(--tp-bd-fg) var(--tp-breakdown-hover-lift));
  --tp-hover-fg: var(--tp-fg);
  --tp-muted-fg: var(--tp-fg);
  background: color-mix(in oklab, var(--tp-bd) var(--tp-breakdown-wash-mix), var(--tp-breakdown-wash));
  border: 1px solid var(--tp-bd-edge);
  color: var(--tp-fg);
}
.tp-breakdown-head { background: var(--tp-bd); color: var(--tp-bd-fg); }
/* Blue mode: a table inside a coloured card (the analytics cards) wears the
   card's colours, its band for the column band, its wash for the body and its
   edge for the frame, instead of the navy panel's (Sait, 2026-10-21). */
:root[data-theme='operator'][data-mode='blue'] .tp-breakdown-card {
  --tp-table-head: var(--tp-bd); --tp-table-head-fg: var(--tp-bd-fg);
  --tp-table-edge: var(--tp-bd-edge); --tp-table-body: transparent;
}
/* The "i" in any coloured band (a card's, a panel's) wears the band's own text colour, like its title, instead of the muted grey. */
.tp-breakdown-head .tp-infotip-trigger, .tp-breakdown-head .tp-infotip-trigger:focus-visible,
.tp-band-title .tp-infotip-trigger, .tp-band-title .tp-infotip-trigger:focus-visible { color: inherit; }
.tp-breakdown-head .tp-infotip-trigger:hover:not(:disabled), .tp-band-title .tp-infotip-trigger:hover:not(:disabled) { background: color-mix(in oklab, currentColor 12%, transparent); color: inherit; }
.tp-breakdown-head .tp-btn[data-kind='ghost'] { color: inherit; }
.tp-breakdown-head .tp-btn[data-kind='ghost']:hover:not(:disabled) { background: color-mix(in oklab, currentColor 12%, transparent); color: inherit; }
/* The three rows a card shows take three of the card row's shared tracks
   (subgrid), so a row is as tall as the same row in every other card. Opened
   by "View more", the list keeps that height and scrolls through the rest. */
/* The rows area (.tp-breakdown-body): three of the card's tracks, positioned,
   so the opened list and its scroll thumb lie over exactly the rows, in a
   frame or in a card that stands alone. */
.tp-breakdown-body { grid-row: span 3; display: grid; grid-template-rows: subgrid; position: relative; min-block-size: 0; }
.tp-breakdown-rows { grid-row: span 3; display: grid; grid-template-rows: subgrid; list-style: none; margin: 0; padding: 0; min-block-size: 0; }
.tp-breakdown-rows > li + li { border-block-start: 1px solid color-mix(in oklab, var(--tp-bd-edge) 35%, transparent); }
/* The opened list lies over the three rows' area (position: absolute on the
   card's tracks 2-4), so opening it never moves a track: it scrolls instead.
   Its scrollbar is a thumb drawn over the rows (.tp-breakdown-thumb, placed by
   ManagementPanel), not the native bar, so it takes no width and nothing on
   the card moves when the list opens (Sait, 2026-10-19). */
.tp-breakdown-scroll {
  display: block; position: absolute; inset: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain;
  scrollbar-width: none;
}
.tp-breakdown-scroll::-webkit-scrollbar { display: none; }
.tp-breakdown-track { position: absolute; inset: 0; pointer-events: none; }
.tp-breakdown-thumb {
  position: absolute; inset-inline-end: var(--tp-sp-1); inline-size: 6px; border-radius: var(--tp-radius-pill);
  background: color-mix(in oklab, var(--tp-fg) 35%, transparent); pointer-events: auto; cursor: grab; touch-action: none;
}
.tp-breakdown-thumb:hover, .tp-breakdown-thumb:active { background: color-mix(in oklab, var(--tp-fg) 55%, transparent); }
.tp-breakdown-card { scroll-snap-align: start; }
/* The analytics "What stands out" row (Sait, 2026-10-19): every card in it,
   AI cards and pattern groups alike, takes the six card colours by its place
   among the row's cards, round again after six. Counted among the cards only
   (of .tp-breakdown-card), so a "View more" in the row does not shift them;
   weighted past the data-tone rules above. */
.tp-zone-row > :nth-child(6n + 1 of .tp-breakdown-card) { --tp-bd: var(--tp-breakdown-green); --tp-bd-fg: var(--tp-breakdown-green-fg); --tp-bd-edge: var(--tp-breakdown-green-edge); }
.tp-zone-row > :nth-child(6n + 2 of .tp-breakdown-card) { --tp-bd: var(--tp-breakdown-violet); --tp-bd-fg: var(--tp-breakdown-violet-fg); --tp-bd-edge: var(--tp-breakdown-violet-edge); }
.tp-zone-row > :nth-child(6n + 3 of .tp-breakdown-card) { --tp-bd: var(--tp-breakdown-rose); --tp-bd-fg: var(--tp-breakdown-rose-fg); --tp-bd-edge: var(--tp-breakdown-rose-edge); }
.tp-zone-row > :nth-child(6n + 4 of .tp-breakdown-card) { --tp-bd: var(--tp-breakdown-sky); --tp-bd-fg: var(--tp-breakdown-sky-fg); --tp-bd-edge: var(--tp-breakdown-sky-edge); }
.tp-zone-row > :nth-child(6n + 5 of .tp-breakdown-card) { --tp-bd: var(--tp-breakdown-teal); --tp-bd-fg: var(--tp-breakdown-teal-fg); --tp-bd-edge: var(--tp-breakdown-teal-edge); }
.tp-zone-row > :nth-child(6n + 6 of .tp-breakdown-card) { --tp-bd: var(--tp-breakdown-gold); --tp-bd-fg: var(--tp-breakdown-gold-fg); --tp-bd-edge: var(--tp-breakdown-gold-edge); }
.tp-breakdown-rows .tp-row { background: transparent; }
.tp-breakdown-card { --tp-breakdown-row: 4.25rem; }
.tp-breakdown-more { background: transparent; border: 0; border-block-start: 1px solid var(--tp-bd-edge); }
.tp-breakdown-more:hover { background: var(--tp-hover); }
/* A row that opens from a button stretched over it (the analytics figures,
   whose info tip must stay a button of its own): the label looks like text,
   its ::after covers the row, and the ring is drawn on the row. */
.tp-breakdown-stretch { all: unset; font-size: var(--tp-fs-md); font-weight: 500; cursor: pointer; }
.tp-breakdown-stretch::after { content: ''; position: absolute; inset: 0; }
.tp-breakdown-card .tp-breakdown-stretch:focus-visible { outline: none; }
.tp-breakdown-card .tp-row:has(.tp-breakdown-stretch:focus-visible) { outline: 2px solid currentColor; outline-offset: -2px; border-radius: var(--tp-radius-ctl); }
/* Focus on a Breakdown card sits INSIDE the control: the card clips what
   pokes past its edge (overflow: hidden, for the rounded corners), so the
   global ring drawn outside a row showed only as a line under it (Sait,
   2026-10-19). The ring takes the card's own ink, which reads on its wash and
   on its band in both modes. */
.tp-breakdown-card :is(.tp-row, .tp-breakdown-more, .tp-btn, [tabindex]):focus-visible {
  outline: 2px solid currentColor; outline-offset: -2px; border-radius: var(--tp-radius-ctl);
}
/* View more's motion (Sait, 2026-10-19; an asked-for exception to the motion
   rule): the chevron turns, and the rows it reveals fade in. */
.tp-breakdown-chevron { transition: transform var(--tp-dur-base) var(--tp-ease-out); }
.tp-breakdown-chevron[data-open='true'] { transform: rotate(180deg); }
.tp-breakdown-revealed { animation: tpFadeIn var(--tp-dur-base) var(--tp-ease-out) both; }
@media (prefers-reduced-motion: reduce) { .tp-breakdown-chevron { transition: none; } .tp-breakdown-revealed { animation: none; } }

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

/* Light <-> blue mode cross-fade (lib/themeMode.tsx runs the flip inside a
   view transition). The browser's default is a 250ms linear fade, which on a
   whole-screen colour change reads as a flicker; this is slower and settles.
   Reduced motion never starts the transition, so it needs no override here. */
::view-transition-old(root),
::view-transition-new(root) { animation-duration: 360ms; animation-timing-function: var(--tp-ease-settle); }

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
/* A drawer from the inline-START edge (the assistant's chat list). It stays
   mounted and slides on a compositor-only transform, so opening it never
   waits on a mount or a fetch. Shut, it is off-screen and hidden (no Tab stop,
   nothing read); visibility flips only after the slide out ends. */
.tp-drawer-start {
  transform: translate3d(calc(-100% * var(--tp-dir-sign, 1)), 0, 0);
  visibility: hidden;
  transition: transform var(--tp-dur-base) var(--tp-ease-settle), visibility 0s linear var(--tp-dur-base);
  will-change: transform;
}
.tp-drawer-start[data-open] {
  transform: translate3d(0, 0, 0);
  visibility: visible;
  transition: transform var(--tp-dur-base) var(--tp-ease-settle), visibility 0s;
}
.tp-drawer-scrim { opacity: 0; pointer-events: none; transition: opacity var(--tp-dur-base) var(--tp-ease-out); will-change: opacity; }
.tp-drawer-scrim[data-open] { opacity: 1; pointer-events: auto; }
@media (prefers-reduced-motion: reduce) { .tp-drawer-start, .tp-drawer-start[data-open], .tp-drawer-scrim { transition: none; } }
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

/* Tournaments: a list card lifts its edge on hover; the rounds board keeps its
   own scrolling column beside a fixed leaderboard, which drops under it on a
   narrow window rather than letting the rounds run beneath it. */
.tp-tour-card:hover { border-color: var(--tp-accent); }
/* The list's status filter: blue when chosen, light blue under the pointer. */
.tp-tour-chip {
  min-block-size: 2.25rem; padding-inline: var(--tp-sp-3); border-radius: var(--tp-radius-pill);
  border: 1px solid var(--tp-border-strong); background: var(--tp-surface); color: var(--tp-fg);
  font: inherit; font-size: var(--tp-fs-sm); font-weight: 600; cursor: pointer;
}
.tp-tour-chip:hover { background: var(--tp-accent-soft); border-color: var(--tp-accent-soft); color: var(--tp-accent-soft-fg); }
.tp-tour-chip[aria-pressed='true'] { background: var(--tp-accent); border-color: var(--tp-accent); color: var(--tp-accent-contrast); }

/* "Start: Tournament" (TournamentStartSheet): the section menu beside the open
   section, stacked on a narrow window; the menu rows, the big choice cards and
   the courts-by-hours timeline cells. */
.tp-tour-start {
  display: grid; block-size: min(47.5rem, 92vh);
  grid-template-columns: 17rem minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto;
  grid-template-areas: 'side main' 'sidefoot foot';
}
.tp-tour-start-side {
  grid-area: side; display: flex; flex-direction: column; gap: var(--tp-sp-1); padding: var(--tp-sp-5) var(--tp-sp-3);
  background: var(--tp-surface-2); border-inline-end: 1px solid var(--tp-border); overflow-y: auto;
}
.tp-tour-start-main { grid-area: main; display: flex; flex-direction: column; min-inline-size: 0; min-block-size: 0; }
/* One bottom row across both columns: the progress card and the buttons
   centre on the same line; only the buttons' side has a divider above. */
.tp-tour-start-sidefoot {
  grid-area: sidefoot; display: flex; flex-direction: column; justify-content: center;
  padding: var(--tp-sp-4) var(--tp-sp-3); background: var(--tp-surface-2);
  border-inline-end: 1px solid var(--tp-border);
}
.tp-tour-start-foot {
  grid-area: foot; display: flex; justify-content: space-between; align-items: center; gap: var(--tp-sp-2); flex-wrap: wrap;
  padding: var(--tp-sp-4) var(--tp-sp-6); border-block-start: 1px solid var(--tp-border);
}
@media (max-width: 56rem) {
  .tp-tour-start {
    grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto auto;
    grid-template-areas: 'side' 'main' 'sidefoot' 'foot';
  }
  .tp-tour-start-sidefoot { border-inline-end: 0; }
  .tp-tour-start-side { border-inline-end: 0; border-block-end: 1px solid var(--tp-border); }
}
.tp-tour-start-nav {
  display: flex; align-items: center; gap: var(--tp-sp-3); min-block-size: 3.25rem; padding: 0 var(--tp-sp-3); font-size: var(--tp-fs-lg);
  border: 0; border-radius: var(--tp-radius-panel); background: transparent; color: var(--tp-fg);
  font: inherit; font-weight: 600; text-align: start; inline-size: 100%; cursor: pointer;
}
.tp-tour-start-nav:hover { background: var(--tp-accent-soft); }
.tp-tour-start-nav[aria-current='step'] { background: var(--tp-accent); color: var(--tp-accent-contrast); font-weight: 700; }
.tp-tour-start-nav[aria-current='step']:hover { background: var(--tp-accent-hover); }
.tp-tour-choice {
  display: grid; row-gap: var(--tp-sp-4); align-content: start; align-items: start; padding: var(--tp-sp-4); text-align: start;
  border: 1px solid var(--tp-border-strong); border-radius: var(--tp-radius-dialog); background: var(--tp-surface);
  color: var(--tp-fg); font: inherit; cursor: pointer;
}
.tp-tour-choice:hover { border-color: var(--tp-accent); }
/* A row of choice cards (class, format): as many to a row as fit at 12rem. */
.tp-tour-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: var(--tp-sp-3); }
/* The formats: two to a row (one on a narrow window). */
.tp-tour-choices[data-cols='2'] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 40rem) { .tp-tour-choices[data-cols='2'] { grid-template-columns: minmax(0, 1fr); } }
.tp-tour-choice[aria-pressed='true'], .tp-tour-choice[aria-checked='true'] { border: 2px solid var(--tp-accent); background: var(--tp-accent-soft); padding: calc(var(--tp-sp-4) - 1px); }
/* The stepped create dialogs (components/StepWizard.tsx) on the tournament
   frame. The step's circle, its answer under the name, the unnumbered Review
   row below a dashed divider with a solid ring (Sait, 2026-10-22). */
.tp-wiz-n {
  inline-size: 1.75rem; block-size: 1.75rem; flex-shrink: 0; border-radius: var(--tp-radius-pill); box-sizing: border-box;
  display: inline-flex; align-items: center; justify-content: center; font-size: var(--tp-fs-xs); font-weight: 800; line-height: 1;
  font-variant-numeric: tabular-nums; background: var(--tp-surface-3); color: var(--tp-muted-fg);
}
.tp-wiz-n[data-state='done'] { background: var(--tp-accent-2); color: var(--tp-accent-2-contrast); }
.tp-wiz-n[data-state='now'] { background: var(--tp-accent-contrast); color: var(--tp-accent); }
.tp-wiz-n[data-state='warn'] { background: var(--tp-danger); color: var(--tp-danger-contrast); }
.tp-wiz-n[data-state='review'] { background: transparent; border: 2px solid var(--tp-border-strong); }
[aria-current='step'] > .tp-wiz-n[data-state='review'] { background: var(--tp-accent-contrast); border-color: var(--tp-accent-contrast); color: var(--tp-accent); }
.tp-wiz-label { flex: 1; min-inline-size: 0; display: grid; gap: 1px; padding-block: var(--tp-sp-1-5); }
.tp-wiz-note { font-size: var(--tp-fs-xs); font-weight: 500; color: var(--tp-muted-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[aria-current='step'] .tp-wiz-note { color: var(--tp-accent-contrast); font-weight: 600; }
.tp-wiz-sep { border: 0; border-block-start: 1px dashed var(--tp-border-strong); margin: var(--tp-sp-1-5) var(--tp-sp-3); }
.tp-wiz-progress {
  padding: var(--tp-sp-3); border-radius: var(--tp-radius-panel); background: var(--tp-surface); border: 1px solid var(--tp-border);
  display: grid; gap: var(--tp-sp-1-5); font-size: var(--tp-fs-sm);
}
.tp-wiz-bar { block-size: 0.375rem; border-radius: var(--tp-radius-pill); background: var(--tp-surface-3); overflow: hidden; }
.tp-wiz-bar > i { display: block; block-size: 100%; background: var(--tp-accent-2); transition: inline-size var(--tp-dur-base) var(--tp-ease-out); }
.tp-btn.tp-wiz-go { background: var(--tp-accent-2); border-color: var(--tp-accent-2); color: var(--tp-accent-2-contrast); }
.tp-btn.tp-wiz-go:hover:not(:disabled) { filter: brightness(0.95); }
.tp-wiz-review { display: grid; margin: 0; border: 1px solid var(--tp-border); border-radius: var(--tp-radius-panel); overflow: hidden; }
.tp-wiz-review > div {
  display: grid; grid-template-columns: 9.5rem minmax(0, 1fr) auto; gap: var(--tp-sp-3); align-items: center;
  padding: var(--tp-sp-3) var(--tp-sp-4); background: var(--tp-surface); border-block-start: 1px solid var(--tp-border);
}
.tp-wiz-review > div:first-child { border-block-start: 0; }
.tp-wiz-review dt { color: var(--tp-muted-fg); font-size: var(--tp-fs-sm); font-weight: 600; }
.tp-wiz-review dd { margin: 0; font-weight: 600; min-inline-size: 0; overflow-wrap: anywhere; }
@media (max-width: 30rem) { .tp-wiz-review > div { grid-template-columns: minmax(0, 1fr) auto; } .tp-wiz-review dd { grid-column: 1; } }
.tp-wiz-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr)); gap: var(--tp-sp-3); }
.tp-wiz-choices[data-small='true'] { grid-template-columns: repeat(auto-fit, minmax(min(100%, 8.5rem), 1fr)); }
.tp-wiz-choice { position: relative; row-gap: var(--tp-sp-2); }
.tp-wiz-choice:disabled { opacity: var(--tp-opacity-disabled); cursor: not-allowed; }
.tp-wiz-choice-title { font-size: var(--tp-fs-lg); line-height: 1.4rem; padding-inline-end: 1.8rem; }
.tp-wiz-choice-body { font-size: var(--tp-fs-sm); color: var(--tp-muted-fg); line-height: 1.5; }
.tp-wiz-choice[aria-pressed='true'] .tp-wiz-choice-body { color: inherit; opacity: 0.85; }
.tp-wiz-tick {
  position: absolute; inset-inline-end: calc(var(--tp-sp-4) - 1px); inset-block-start: calc(var(--tp-sp-4) - 1px);
  inline-size: 1.4rem; block-size: 1.4rem; border-radius: var(--tp-radius-pill); display: grid; place-items: center;
  background: var(--tp-accent-2); color: var(--tp-accent-2-contrast);
}
.tp-wiz-tag { justify-self: start; font-size: var(--tp-fs-xs); font-weight: 700; padding: 2px var(--tp-sp-2); border-radius: var(--tp-radius-pill); background: var(--tp-surface-3); color: var(--tp-fg); }
.tp-wiz-chips { display: flex; flex-wrap: wrap; gap: var(--tp-sp-2); }
.tp-wiz-chip {
  min-block-size: 2.5rem; padding: 0 var(--tp-sp-3); border-radius: var(--tp-radius-pill); border: 1px solid var(--tp-border-strong);
  background: var(--tp-surface); color: var(--tp-fg); font: inherit; font-weight: 600; cursor: pointer; font-variant-numeric: tabular-nums;
}
.tp-wiz-chip:hover:not(:disabled) { border-color: var(--tp-accent); }
.tp-wiz-chip[aria-pressed='true'] { background: var(--tp-accent); color: var(--tp-accent-contrast); border-color: var(--tp-accent); }
.tp-wiz-chip:disabled { opacity: var(--tp-opacity-disabled); cursor: not-allowed; text-decoration: line-through; }
.tp-wiz-price { padding: var(--tp-sp-3); border-radius: var(--tp-radius-panel); border: 1px solid var(--tp-border); background: var(--tp-surface-2); display: grid; gap: var(--tp-sp-1); }
.tp-wiz-price > strong { font-size: var(--tp-fs-xl); font-variant-numeric: tabular-nums; }
.tp-wiz-price > span { color: var(--tp-muted-fg); font-size: var(--tp-fs-sm); }
/* Inside a wizard the chosen segment is Padel Green in both modes (the approved preview). */
.tp-wiz .tp-seg { --tp-seg-on: var(--tp-accent-2); --tp-seg-on-fg: var(--tp-accent-2-contrast); }
/* The optional mark as the approved preview writes it inside a wizard: small,
   lower case, no brackets. Lower case does nothing to Arabic. */
.tp-wiz .tp-field-opt { font-size: var(--tp-fs-xs); font-weight: 500; text-transform: lowercase; }
.tp-wiz .tp-opt-paren { display: none; }
/* A note on a step: a soft box, no icon (the approved preview). */
.tp-wiz-msg { padding: var(--tp-sp-2-5) var(--tp-sp-3); border-radius: var(--tp-radius-panel); font-size: var(--tp-fs-sm); background: var(--tp-accent-soft); color: var(--tp-accent-soft-fg); }
.tp-wiz-msg[data-tone='refused'] { background: var(--tp-warn-soft); color: var(--tp-warn-fg); }
.tp-wiz-msg[data-tone='error'] { background: var(--tp-danger-soft); color: var(--tp-danger-fg); }
.tp-wiz-msg[data-tone='success'] { background: var(--tp-success-soft); color: var(--tp-fg); }
/* A switch in its own box, its name and hint beside it. */
.tp-wiz-toggle { display: flex; align-items: flex-start; gap: var(--tp-sp-3); padding: var(--tp-sp-3); border: 1px solid var(--tp-border); border-radius: var(--tp-radius-panel); background: var(--tp-surface-2); }
.tp-wiz-toggle > div { display: grid; gap: 2px; min-inline-size: 0; }
.tp-wiz-toggle strong { font-size: var(--tp-fs-sm); }
.tp-wiz-toggle span { font-size: var(--tp-fs-xs); color: var(--tp-muted-fg); }
/* Ticks in bordered rows, a tag at the end of each. */
.tp-wiz-checks { display: grid; gap: var(--tp-sp-2); border: 0; margin: 0; padding: 0; min-inline-size: 0; }
.tp-wiz-checks > legend { display: flex; gap: var(--tp-sp-2); align-items: baseline; padding: 0; margin-block-end: var(--tp-sp-1-5); font-weight: 700; font-size: var(--tp-fs-sm); }
.tp-wiz-opt { font-weight: 500; color: var(--tp-muted-fg); font-size: var(--tp-fs-xs); }
.tp-wiz-check { display: flex; gap: var(--tp-sp-2-5); align-items: center; padding: var(--tp-sp-2-5) var(--tp-sp-3); border: 1px solid var(--tp-border); border-radius: var(--tp-radius-ctl); background: var(--tp-surface); cursor: pointer; }
.tp-wiz-check:hover { border-color: var(--tp-accent); }
.tp-wiz-check[data-disabled='true'] { opacity: var(--tp-opacity-disabled); cursor: not-allowed; }
.tp-wiz-check > input { inline-size: 1.15rem; block-size: 1.15rem; accent-color: var(--tp-accent); margin: 0; flex-shrink: 0; }
.tp-wiz-check-label { flex: 1; min-inline-size: 0; }
.tp-wiz-hint { font-size: var(--tp-fs-xs); color: var(--tp-muted-fg); }
@media (max-width: 46rem) {
  .tp-tour-start-foot { flex-wrap: nowrap; padding-inline: var(--tp-sp-4); }
  .tp-tour-start-foot > .tp-btn, .tp-tour-start-foot > * > .tp-btn { flex: 1 1 0; min-inline-size: 0; justify-content: center; }
}
/* ---- Settings › Branches and Branch details (Sait, 2026-10-22) ----
   A branch wears one of the six card colours by its place among the branches,
   the same on its card and on its details page; the Fixed at setup tiles take
   them in order. The band is the colour, the body a wash of it, and a strip
   tile is a band over a plain ground (--tp-branch-tile). */
.tp-tone[data-tone='green'] { --tp-bd: var(--tp-breakdown-green); --tp-bd-fg: var(--tp-breakdown-green-fg); --tp-bd-edge: var(--tp-breakdown-green-edge); }
.tp-tone[data-tone='violet'] { --tp-bd: var(--tp-breakdown-violet); --tp-bd-fg: var(--tp-breakdown-violet-fg); --tp-bd-edge: var(--tp-breakdown-violet-edge); }
.tp-tone[data-tone='rose'] { --tp-bd: var(--tp-breakdown-rose); --tp-bd-fg: var(--tp-breakdown-rose-fg); --tp-bd-edge: var(--tp-breakdown-rose-edge); }
.tp-tone[data-tone='sky'] { --tp-bd: var(--tp-breakdown-sky); --tp-bd-fg: var(--tp-breakdown-sky-fg); --tp-bd-edge: var(--tp-breakdown-sky-edge); }
.tp-tone[data-tone='teal'] { --tp-bd: var(--tp-breakdown-teal); --tp-bd-fg: var(--tp-breakdown-teal-fg); --tp-bd-edge: var(--tp-breakdown-teal-edge); }
.tp-tone[data-tone='gold'] { --tp-bd: var(--tp-breakdown-gold); --tp-bd-fg: var(--tp-breakdown-gold-fg); --tp-bd-edge: var(--tp-breakdown-gold-edge); }
/* The status filter's chosen segment is Padel Green, as in the wizards. */
.tp-branch-filter .tp-seg { --tp-seg-on: var(--tp-accent-2); --tp-seg-on-fg: var(--tp-accent-2-contrast); }
.tp-branch-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr)); gap: var(--tp-sp-4); align-items: start; }
.tp-branch-card {
  display: flex; flex-direction: column; inline-size: 100%; padding: 0; text-align: start; font: inherit; cursor: pointer;
  border-radius: var(--tp-radius-panel); overflow: hidden; color: var(--tp-fg);
  background: color-mix(in oklab, var(--tp-bd) var(--tp-breakdown-wash-mix), var(--tp-breakdown-wash));
  border: 1px solid var(--tp-bd-edge);
  transition: box-shadow var(--tp-dur-fast) var(--tp-ease-out);
}
.tp-branch-card[aria-current='true'] { border: 2px solid var(--tp-accent); }
.tp-branch-card:hover:not(:disabled) { box-shadow: 0 2px 0 color-mix(in srgb, var(--tp-accent) 20%, transparent), 0 8px 24px color-mix(in srgb, var(--tp-fg) 8%, transparent); }
.tp-branch-card:disabled { cursor: default; }
.tp-branch-band { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--tp-sp-2); padding: 0.875rem 1.125rem; background: var(--tp-bd); color: var(--tp-bd-fg); }
.tp-branch-band > strong { font-size: var(--tp-fs-xl); line-height: 1.2; }
.tp-branch-body { display: flex; flex-direction: column; gap: var(--tp-sp-3); padding: var(--tp-sp-4) 1.125rem; }
.tp-branch-lines { display: flex; flex-direction: column; gap: var(--tp-sp-1); }
.tp-branch-lines > span { display: flex; gap: var(--tp-sp-2); align-items: flex-start; }
.tp-branch-lines svg { flex-shrink: 0; margin-block-start: 0.15rem; }
.tp-branch-foot { display: flex; justify-content: space-between; align-items: center; gap: var(--tp-sp-2); padding-block-start: var(--tp-sp-3); border-block-start: 1px solid color-mix(in srgb, var(--tp-fg) 15%, transparent); font-weight: 600; }
.tp-branch-now { display: inline-flex; align-items: center; min-block-size: 1.5rem; padding-inline: 0.625rem; border-radius: var(--tp-radius-pill); background: var(--tp-accent); color: var(--tp-accent-contrast); font-size: var(--tp-fs-xs); font-weight: 600; }
.tp-strip-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--tp-sp-2-5); }
.tp-strip-tile { border-radius: 8px; overflow: hidden; background: var(--tp-branch-tile); border: 1px solid var(--tp-bd-edge); display: flex; flex-direction: column; }
.tp-strip-tile-band { padding: var(--tp-sp-1-5) var(--tp-sp-3); background: var(--tp-bd); color: var(--tp-bd-fg); font-size: var(--tp-fs-sm); font-weight: 600; }
.tp-strip-tile-value { padding: var(--tp-sp-2) var(--tp-sp-3); font-size: var(--tp-fs-2xl); font-weight: 700; font-variant-numeric: tabular-nums; }
/* Courts › Open matches and a match's page (Sait, 2026-10-26): a card per match and per seat in the
   six card colours, the Branches card's band, tiles and foot. The border is the card's own colour. */
.tp-match-grid, .tp-seat-grid { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--tp-sp-3); align-items: stretch; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.tp-seat-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (max-width: 64rem) { .tp-match-grid, .tp-seat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 40rem) { .tp-match-grid, .tp-seat-grid { grid-template-columns: minmax(0, 1fr); } }
.tp-match-card { display: flex; flex-direction: column; min-inline-size: 0; border-radius: var(--tp-radius-panel); overflow: hidden; color: var(--tp-fg); background: color-mix(in oklab, var(--tp-bd) var(--tp-breakdown-wash-mix), var(--tp-breakdown-wash)); border: 2px solid var(--tp-bd); }
.tp-match-card > .tp-branch-body { flex: 1; }
.tp-match-card > .tp-branch-body > .tp-match-actions { margin-block-start: auto; }
.tp-match-card[data-open='true'] { background: transparent; border-style: dashed; border-color: var(--tp-bd-edge); }
.tp-match-card[data-open='true'] .tp-branch-band { background: transparent; color: var(--tp-fg); }
.tp-match-card .tp-branch-band > strong { font-size: var(--tp-fs-lg); min-inline-size: 0; }
.tp-match-card .tp-branch-band > .tp-match-seatno { font-size: var(--tp-fs-sm); font-weight: 600; }
.tp-match-card .tp-strip-tiles[data-cols='4'] { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (max-width: 48rem) { .tp-match-card .tp-strip-tiles[data-cols='4'] { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.tp-match-lines { display: flex; flex-wrap: wrap; gap: var(--tp-sp-1) var(--tp-sp-3); align-items: center; font-size: var(--tp-fs-sm); font-variant-numeric: tabular-nums; }
.tp-match-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--tp-sp-2); padding-block-start: var(--tp-sp-3); border-block-start: 1px solid color-mix(in srgb, var(--tp-fg) 15%, transparent); }
.tp-match-actions > .tp-match-end { margin-inline-start: auto; }
.tp-match-card .tp-btn[data-kind='default'] { background: color-mix(in srgb, var(--tp-branch-tile) 80%, transparent); border: 1.5px solid var(--tp-bd-fg); color: var(--tp-bd-fg); }
.tp-match-card .tp-btn[data-kind='danger'] { border: 2px solid var(--tp-danger); }
.tp-match-card .tp-btn[data-kind='primary'] { border-radius: var(--tp-radius-pill); }
.tp-branch-closed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border: 1px solid var(--tp-border); border-radius: 8px; background: var(--tp-surface); }
.tp-branch-closed > li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--tp-sp-3); padding: var(--tp-sp-3) var(--tp-sp-4); min-block-size: 3rem; }
.tp-branch-closed > li + li { border-block-start: 1px solid var(--tp-border); }
/* Branch details: the hero in the branch's colour, the checklist, the tiles. */
.tp-branch-hero { border-radius: var(--tp-radius-dialog); overflow: hidden; border: 1px solid var(--tp-bd-edge); background: color-mix(in oklab, var(--tp-bd) var(--tp-breakdown-wash-mix), var(--tp-breakdown-wash)); color: var(--tp-fg); }
.tp-branch-hero-band { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--tp-sp-4); padding: 1.25rem var(--tp-sp-5); background: var(--tp-bd); color: var(--tp-bd-fg); }
.tp-branch-hero-band h1 { margin: 0; font-size: var(--tp-fs-3xl); line-height: 1.15; font-weight: 700; color: inherit; }
.tp-branch-hero-note { padding: 0.625rem var(--tp-sp-5); background: color-mix(in srgb, var(--tp-branch-tile) 70%, transparent); font-size: var(--tp-fs-md); }
.tp-branch-hero .tp-btn[data-kind='default'] { background: color-mix(in srgb, var(--tp-branch-tile) 80%, transparent); border-color: var(--tp-bd-fg); color: var(--tp-bd-fg); }
.tp-btn.tp-open-guests { background: var(--tp-selected); border-color: var(--tp-selected); color: var(--tp-selected-fg); }
.tp-btn.tp-open-guests:hover:not(:disabled) { filter: brightness(0.95); }
.tp-btn.tp-open-guests:disabled { opacity: 1; background: color-mix(in oklab, var(--tp-selected) 45%, var(--tp-branch-tile)); border: 1px dashed var(--tp-success-mark); color: var(--tp-selected-fg); cursor: not-allowed; }
.tp-ready-bar { block-size: 0.625rem; border-radius: var(--tp-radius-pill); background: var(--tp-surface-3); overflow: hidden; }
.tp-ready-bar > i { display: block; block-size: 100%; border-radius: var(--tp-radius-pill); background: var(--tp-selected); }
.tp-ready-list { list-style: none; margin: 0; padding: var(--tp-sp-2) 0 0; display: flex; flex-direction: column; }
.tp-ready-list > li { display: flex; align-items: center; gap: var(--tp-sp-3); min-block-size: 3.25rem; padding: var(--tp-sp-1) var(--tp-sp-2); border-block-end: 1px solid var(--tp-border); }
.tp-ready-list > li:last-child { border-block-end: 0; }
.tp-ready-mark { flex-shrink: 0; inline-size: 1.5rem; block-size: 1.5rem; border-radius: 50%; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; }
.tp-ready-mark[data-state='ok'] { background: var(--tp-selected); color: var(--tp-selected-fg); }
.tp-ready-mark[data-state='required'] { border: 2px solid var(--tp-danger); }
.tp-ready-mark[data-state='recommended'] { border: 2px solid var(--tp-warn-mark); }
.tp-ready-tag { display: inline-flex; align-items: center; min-block-size: 1.375rem; padding-inline: var(--tp-sp-2); border-radius: var(--tp-radius-pill); font-size: var(--tp-fs-xs); font-weight: 600; }
.tp-ready-tag[data-state='ok'] { background: var(--tp-success-soft); color: var(--tp-success-fg); }
.tp-ready-tag[data-state='required'] { background: var(--tp-danger-soft); color: var(--tp-danger-fg); }
.tp-ready-tag[data-state='recommended'] { background: var(--tp-warn-soft); color: var(--tp-warn-fg); }
.tp-ready-fix { display: inline-flex; align-items: center; gap: var(--tp-sp-1); min-block-size: 2.25rem; padding-inline: var(--tp-sp-3); border: 1px solid var(--tp-accent); border-radius: var(--tp-radius-ctl); background: transparent; color: var(--tp-accent); font: inherit; font-size: var(--tp-fs-md); font-weight: 600; cursor: pointer; }
.tp-ready-fix:hover:not(:disabled) { background: var(--tp-accent); color: var(--tp-accent-contrast); }
.tp-ready-fix:disabled { opacity: var(--tp-opacity-disabled); cursor: not-allowed; }
.tp-ready-done { font-size: var(--tp-fs-sm); font-weight: 600; color: var(--tp-success-fg); }
.tp-fact-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 13.75rem), 1fr)); gap: var(--tp-sp-3); }
.tp-fact-tile { border-radius: 8px; background: var(--tp-branch-tile); border: 1px solid var(--tp-bd-edge); box-sizing: border-box; min-block-size: 110px; display: flex; flex-direction: column; }
.tp-fact-tile-band { display: flex; align-items: center; gap: var(--tp-sp-1-5); min-block-size: 2rem; padding-block: var(--tp-sp-0); padding-inline: var(--tp-sp-3) var(--tp-sp-1-5); border-radius: 7px 7px 0 0; background: var(--tp-bd); color: var(--tp-bd-fg); font-size: var(--tp-fs-sm); font-weight: 600; }
.tp-fact-tile-band > .tp-infotip-trigger { margin-inline-start: auto; color: inherit; }
.tp-fact-tile-value { flex: 1; display: flex; align-items: center; padding: var(--tp-sp-3); font-size: var(--tp-fs-2xl); font-weight: 700; line-height: 1.2; }
.tp-branch-link { display: flex; align-items: center; justify-content: space-between; gap: var(--tp-sp-2); min-block-size: var(--tp-touch); padding-inline: var(--tp-sp-3); border-radius: var(--tp-radius-ctl); color: var(--tp-fg); text-decoration: none; }
.tp-branch-link:hover { background: var(--tp-hover); color: var(--tp-hover-fg); }
.tp-close-box { border-radius: var(--tp-radius-panel); background: var(--tp-panel-body); border: 1px solid var(--tp-panel-edge); padding: 1.125rem 1.25rem; display: flex; flex-direction: column; gap: var(--tp-sp-2-5); }
.tp-close-box > h2 { margin: 0; font-size: var(--tp-fs-lg); font-weight: 700; color: var(--tp-danger-fg); }
.tp-close-box > p { margin: 0; font-size: var(--tp-fs-md); }
/* Close branch is solid red with white text (Sait, 2026-10-22). */
.tp-close-box .tp-btn[data-kind='danger'] { align-self: flex-start; background: var(--tp-danger); color: var(--tp-danger-contrast); border: 1px solid var(--tp-danger); }
.tp-close-box .tp-btn[data-kind='danger']:hover:not(:disabled) { background: color-mix(in oklab, var(--tp-danger) 88%, black); border-color: color-mix(in oklab, var(--tp-danger) 88%, black); }
/* The timezone picker (Open a new branch › Contact): continent, country, city. */
.tp-tz-field { display: flex; align-items: center; gap: var(--tp-sp-2-5); inline-size: 100%; min-block-size: var(--tp-touch); text-align: start; cursor: pointer; }
.tp-tz-field > .tp-tz-path { flex: 1; min-inline-size: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tp-tz-field > svg:last-child { flex-shrink: 0; transition: transform var(--tp-dur-fast) var(--tp-ease-out); }
.tp-tz-field[aria-expanded='true'] > svg:last-child { transform: rotate(180deg); }
.tp-tz-offset { font-size: var(--tp-fs-sm); font-weight: 700; font-variant-numeric: tabular-nums; }
.tp-tz-search { display: flex; align-items: center; gap: var(--tp-sp-2); min-block-size: 2.5rem; padding-inline: var(--tp-sp-2-5); border: 1px solid var(--tp-border); border-radius: var(--tp-radius-ctl); background: var(--tp-surface); }
.tp-tz-search > input { flex: 1; min-inline-size: 0; border: 0; background: transparent; font: inherit; color: var(--tp-fg); outline: none; }
/* The box, not the bare input inside it, shows the keyboard focus. */
.tp-tz-search > input:focus-visible { outline: none; box-shadow: none; }
.tp-tz-search:focus-within { border-color: var(--tp-accent); box-shadow: 0 0 0 1px var(--tp-accent); }
.tp-tz-back { align-self: flex-start; display: inline-flex; align-items: center; gap: var(--tp-sp-1); min-block-size: 2.25rem; padding-inline: var(--tp-sp-1-5) var(--tp-sp-2-5); border: 0; border-radius: var(--tp-radius-ctl); background: transparent; color: var(--tp-accent); font: inherit; font-size: var(--tp-fs-md); font-weight: 600; cursor: pointer; }
.tp-tz-back:hover { background: var(--tp-accent-soft); }
.tp-tz-list { max-block-size: 18rem; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.tp-tz-row { display: flex; align-items: center; gap: var(--tp-sp-2-5); inline-size: 100%; min-block-size: var(--tp-touch); padding-inline: var(--tp-sp-2-5); border: 0; border-radius: var(--tp-radius-ctl); background: transparent; color: var(--tp-fg); font: inherit; text-align: start; cursor: pointer; }
.tp-tz-row:hover { background: var(--tp-accent-soft); color: var(--tp-accent-soft-fg); }
.tp-tz-row[aria-selected='true'] { background: var(--tp-selected); color: var(--tp-selected-fg); }
.tp-tz-row > .tp-tz-name { flex: 1; min-inline-size: 0; font-weight: 600; }
.tp-tz-row > .tp-tz-meta { font-size: var(--tp-fs-sm); font-variant-numeric: tabular-nums; }
.tp-tz-row > .tp-tz-end { inline-size: 1rem; display: inline-flex; flex-shrink: 0; }
/* The incident dialog's place, time and court cards: the picked one's blue
   outline at half strength (the tournament start keeps the full one). */
.tp-incident-choice:hover:not(:disabled), .tp-incident-choice[aria-pressed='true'] {
  border-color: color-mix(in oklab, var(--tp-accent) 50%, var(--tp-surface));
}
/* An incident kind's card (features/incidents) takes its own colour, hovered
   and picked, from the --tp-kind-* pair the card sets (KIND_LOOK). The card's
   wash is a lighter cut of the tint, so its icon's tile (the full tint) still
   shows on it. Mixed in oklab: oklch would also blend the hue, and the
   surface's faint blue pulled amber round through cyan. */
.tp-incident-kind:hover:not(:disabled), .tp-incident-kind[aria-pressed='true'] {
  /* The outline at half strength, so it frames the card without shouting. */
  border-color: color-mix(in oklab, var(--tp-kind-fg) 50%, var(--tp-surface));
  background: color-mix(in oklab, var(--tp-kind-soft) 45%, var(--tp-surface));
}
/* The picked slots under the timetable: compact blue cards, like a chosen
   choice card, three or so to a row. */
/* The list fills the room left under the timetable and scrolls only when its
   cards do not fit, so no blank band is left under them. */
.tp-tour-slots {
  list-style: none; margin: 0; padding: 0; padding-inline-end: var(--tp-sp-1); display: grid; align-content: start;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: var(--tp-sp-2);
  flex: 1 1 0; min-block-size: 0; overflow-y: auto; scrollbar-gutter: stable;
}
.tp-tour-slot {
  display: flex; align-items: flex-start; gap: var(--tp-sp-1); padding: var(--tp-sp-2-5) var(--tp-sp-3);
  border: 2px solid var(--tp-accent); border-radius: var(--tp-radius-dialog); background: var(--tp-accent-soft);
}
.tp-tour-slot-open {
  flex: 1; min-inline-size: 0; display: flex; align-items: center; gap: var(--tp-sp-3);
  border: 0; padding: 0; background: transparent; color: var(--tp-fg); font: inherit; text-align: start; cursor: pointer;
}
.tp-tour-slot-court {
  display: inline-flex; align-items: center; line-height: 1; padding: var(--tp-sp-1) var(--tp-sp-2);
  border-radius: var(--tp-radius-pill); background: var(--tp-surface); color: var(--tp-accent-soft-fg);
  font-size: var(--tp-fs-xs); font-weight: 700;
}
/* The courts-by-hours timetable: a framed table as wide as the step, its
   header band holding the hours and its first column the courts, and inside
   it a contribution graph's squares (2.25rem, rounded, 0.25rem apart: each
   keeps 0.125rem above and below and sits centred in its hour column). Every
   hour is in view, never scrolled: the columns share the width, and a square
   only shrinks below 2.25rem when a long day leaves no room for it. A spacer row above the first squares and below the
   last gives them even room; the court column's grey runs unbroken through
   both. A picked hour is green; a booked one hatched. */
.tp-tour-tt {
  /* clip, not hidden: a hidden box may shrink to nothing in the step's grid
     when the slots below overflow it; clip keeps the table its full height. */
  overflow: clip; min-block-size: max-content; touch-action: none; user-select: none;
  border: 1px solid var(--tp-border-strong); border-radius: var(--tp-radius-dialog); background: var(--tp-surface);
}
.tp-tour-tt-grid { display: grid; align-items: stretch; inline-size: 100%; }
.tp-tour-tt-corner, .tp-tour-tt-hour, .tp-tour-tt-court, .tp-tour-tt-pad[data-side] { background: var(--tp-surface-2); }
.tp-tour-tt-corner, .tp-tour-tt-court, .tp-tour-tt-pad[data-side] {
  position: sticky; inset-inline-start: 0; z-index: 1; border-inline-end: 1px solid var(--tp-border-strong);
}
.tp-tour-tt-corner { z-index: 2; border-block-end: 1px solid var(--tp-border-strong); }
.tp-tour-tt-hour {
  display: flex; align-items: center; justify-content: center; padding: var(--tp-sp-2-5) 0;
  line-height: 1; font-size: var(--tp-fs-xs); font-weight: 600; color: var(--tp-muted-fg); font-variant-numeric: tabular-nums;
  border-block-end: 1px solid var(--tp-border-strong);
}
.tp-tour-tt-court {
  display: flex; align-items: center; justify-content: flex-end; padding: 0 var(--tp-sp-2-5); line-height: 1;
  font-size: var(--tp-fs-sm); font-weight: 600; color: var(--tp-muted-fg); white-space: nowrap;
}
.tp-tour-tt-pad { block-size: var(--tp-sp-2); }
.tp-tour-tt-pad[data-fill] { grid-column: 2 / -1; }
.tp-tour-tt-cell {
  inline-size: min(2.25rem, calc(100% - 0.25rem)); aspect-ratio: 1; justify-self: center; border: 0; padding: 0; margin: 0.125rem 0; cursor: pointer;
  border-radius: 0.3rem; background: var(--tp-surface-3);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--tp-fg) 6%, transparent);
}
.tp-tour-tt-cell:hover:not(:disabled):not([data-booked]):not([data-past]) { background: color-mix(in oklab, var(--tp-accent-2) 45%, var(--tp-surface-3)); }
.tp-tour-tt-cell[data-on] { background: var(--tp-accent-2); }
.tp-tour-tt-cell[data-on]:hover:not(:disabled) { background: color-mix(in oklab, var(--tp-accent-2) 80%, var(--tp-fg)); }
.tp-tour-tt-cell[data-booked] {
  cursor: not-allowed;
  background: repeating-linear-gradient(45deg, var(--tp-border-strong), var(--tp-border-strong) 2px, var(--tp-surface-2) 2px, var(--tp-surface-2) 5px);
}
.tp-tour-tt-cell[data-past]:not([data-on]) { cursor: not-allowed; opacity: 0.4; }
.tp-tour-tt-cell:focus-visible { outline: 2px solid var(--tp-ring, var(--tp-accent)); outline-offset: 1px; }
.tp-tour-cell { display: inline-block; block-size: 2rem; border: 0; padding: 0; border-radius: var(--tp-radius-ctl); background: var(--tp-surface-2); cursor: pointer; }
.tp-tour-cell:hover:not(:disabled) { background: var(--tp-accent-soft); }
.tp-tour-cell[data-on] { background: var(--tp-accent-2); }
.tp-tour-cell[data-on]:hover:not(:disabled) { background: var(--tp-accent-hover); }
.tp-tour-cell[data-booked] {
  cursor: not-allowed;
  background: repeating-linear-gradient(45deg, var(--tp-surface-3), var(--tp-surface-3) 4px, var(--tp-surface-2) 4px, var(--tp-surface-2) 8px);
}
.tp-tour-split { display: grid; grid-template-columns: minmax(0, 1fr) 20rem; gap: var(--tp-sp-4); align-items: start; }
@media (max-width: 64rem) { .tp-tour-split { grid-template-columns: minmax(0, 1fr); } }

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
/* Four across only where each column still holds a figure tile (revenue's
   groups); a half-width panel gets 2 x 2 rather than four slivers. */
.tp-grid[data-cols="4"] { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@container (max-width: 60rem) { .tp-grid[data-cols="4"] { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 30rem) { .tp-grid[data-cols="3"] { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 22rem) { .tp-grid[data-cols="2"], .tp-grid[data-cols="3"], .tp-grid[data-cols="4"] { grid-template-columns: minmax(0, 1fr); } }

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
  background: var(--tp-hover); color: var(--tp-hover-fg);
}

/* ---- DateRangePicker (components/DateRangePicker.tsx) ----
   Sait's choices, 2026-10-19: the field is just the dates and a chevron; the
   chips stay on ONE line and scroll sideways; the month/year button and the
   arrows beside it are one height and one style; 20px below that row; a day
   under the pointer is a solid accent chip with contrast ink, the same as a
   picked end; hover never recolours the title's text. */
.tp-drp-field { display: inline-flex; align-items: center; gap: var(--tp-sp-2); white-space: nowrap; font-variant-numeric: tabular-nums; cursor: pointer; text-align: start; }
.tp-drp-field:disabled { cursor: not-allowed; }
.tp-drp-field > svg { color: var(--tp-muted-fg); flex-shrink: 0; transition: transform var(--tp-dur-fast) var(--tp-ease-out); }
.tp-drp-field[data-open] > svg { transform: rotate(180deg); }
.tp-drp-field [data-placeholder] { color: var(--tp-muted-fg); }
.tp-drp {
  --tp-drp-cell: 2.375rem;
  display: grid; gap: var(--tp-sp-3); padding: var(--tp-sp-3);
  inline-size: calc(7 * var(--tp-drp-cell) + 2 * var(--tp-sp-3));
  box-sizing: border-box;
}
/* No scrollbar (Sait, 2026-10-19): the row runs out to the panel's edge, so
   a chip that does not fit shows cut in half there, and that is the sign the
   row moves. The wheel scrolls it sideways (DateRangePicker's onWheel). */
.tp-drp-chips {
  display: flex; gap: var(--tp-sp-1-5); overflow-x: auto; scrollbar-width: none;
  margin-inline-end: calc(-1 * var(--tp-sp-3)); padding-inline-end: var(--tp-sp-3);
}
.tp-drp-chips::-webkit-scrollbar { display: none; }
.tp-drp-chip {
  flex: none; white-space: nowrap; font: inherit; font-size: var(--tp-fs-sm); cursor: pointer;
  padding-block: var(--tp-sp-1); padding-inline: var(--tp-sp-3);
  border: 1px solid var(--tp-border-strong); border-radius: var(--tp-radius-pill);
  background: var(--tp-surface); color: var(--tp-fg);
}
.tp-drp-chip:hover { border-color: var(--tp-accent); }
.tp-drp-chip[aria-pressed='true'] { background: var(--tp-accent); border-color: var(--tp-accent); color: var(--tp-accent-contrast); }
.tp-drp-head { display: flex; align-items: center; justify-content: space-between; gap: var(--tp-sp-2); margin-block-end: calc(var(--tp-sp-4) + var(--tp-sp-1) - var(--tp-sp-3)); }
.tp-drp-title, .tp-drp-nav {
  block-size: 2.25rem; box-sizing: border-box; font: inherit; color: var(--tp-fg);
  border: 1px solid var(--tp-border); border-radius: var(--tp-radius-ctl); background: var(--tp-surface);
  display: inline-flex; align-items: center; justify-content: center; gap: var(--tp-sp-1); cursor: pointer;
}
.tp-drp-title { padding-inline: var(--tp-sp-3); font-weight: 600; }
.tp-drp-title > svg { color: var(--tp-muted-fg); }
.tp-drp-title[data-plain] { border-color: transparent; background: transparent; cursor: default; font-variant-numeric: tabular-nums; }
.tp-drp-nav { inline-size: 2.25rem; padding: 0; }
.tp-drp-title:not([data-plain]):hover, .tp-drp-nav:hover:not(:disabled) { background: var(--tp-accent-soft); border-color: var(--tp-accent); color: var(--tp-fg); }
.tp-drp-nav:disabled { opacity: var(--tp-opacity-disabled); cursor: default; }
.tp-drp-grid { display: grid; grid-template-columns: repeat(7, var(--tp-drp-cell)); row-gap: var(--tp-sp-0); }
.tp-drp-wd { text-align: center; font-size: var(--tp-fs-xs); font-weight: 600; color: var(--tp-muted-fg); padding-block-end: var(--tp-sp-1); }
.tp-drp-day {
  position: relative; isolation: isolate; block-size: 2.25rem; padding: 0; border: 0; font: inherit;
  font-variant-numeric: tabular-nums; background: transparent; color: var(--tp-fg);
  border-radius: var(--tp-radius-ctl); cursor: pointer;
}
/* The range is one square band; only its two ends round off. */
.tp-drp-day[data-in] { background: var(--tp-accent-soft); color: var(--tp-accent-soft-fg); border-radius: 0; }
.tp-drp-day[data-start] { border-start-start-radius: var(--tp-radius-ctl); border-end-start-radius: var(--tp-radius-ctl); }
.tp-drp-day[data-end] { border-start-end-radius: var(--tp-radius-ctl); border-end-end-radius: var(--tp-radius-ctl); }
.tp-drp-day[data-start], .tp-drp-day[data-end] { background: var(--tp-accent); color: var(--tp-accent-contrast); font-weight: 600; }
/* Hover paints its rounded chip on a layer of its own, so the band behind
   the day stays square and unbroken. */
.tp-drp-day:hover:not(:disabled), .tp-drp-day:focus-visible { color: var(--tp-accent-contrast); }
.tp-drp-day:hover:not(:disabled)::before, .tp-drp-day:focus-visible::before {
  content: ''; position: absolute; inset: 0; z-index: -1; border-radius: var(--tp-radius-ctl); background: var(--tp-accent);
}
.tp-drp-day[data-today]::after, .tp-drp-pick[data-now]::after {
  content: ''; position: absolute; inset-inline: 32%; inset-block-end: 0.25rem; block-size: 3px;
  border-radius: var(--tp-radius-pill); background: var(--tp-accent-2);
}
.tp-drp-day:disabled { color: var(--tp-disabled-fg); cursor: default; }
.tp-drp-picks { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--tp-sp-1-5); }
.tp-drp-pick {
  position: relative; block-size: 3.25rem; border: 0; font: inherit; font-weight: 500; font-variant-numeric: tabular-nums;
  background: transparent; color: var(--tp-fg); border-radius: var(--tp-radius-ctl); cursor: pointer;
}
.tp-drp-pick:hover:not(:disabled) { background: var(--tp-accent-soft); color: var(--tp-accent-soft-fg); }
.tp-drp-pick[data-has] { background: var(--tp-accent-soft); color: var(--tp-accent-soft-fg); }
.tp-drp-pick[data-cur] { background: var(--tp-accent); color: var(--tp-accent-contrast); font-weight: 600; }
.tp-drp-pick:disabled { color: var(--tp-disabled-fg); cursor: default; }
.tp-drp-foot { display: flex; justify-content: space-between; gap: var(--tp-sp-2); border-block-start: 1px solid var(--tp-border); padding-block-start: var(--tp-sp-3); }

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

/* The Courts | Café switcher on the analytics bar (features/analytics/
   AnalyticsTabs). Filled when open, so the tab being shown reads from across
   the room. It used to borrow .tp-report-tab, which left with the report
   switcher, and fell back to raw browser buttons. The same --tp-row-h and
   --tp-surface as the jump-nav chips beside it, so the bar's first line is one
   height and one material. */
.tp-analytics-tab {
  display: flex; align-items: center; gap: var(--tp-sp-2);
  min-block-size: var(--tp-row-h); box-sizing: border-box; margin: 0;
  padding-block: var(--tp-sp-1); padding-inline: var(--tp-sp-1) var(--tp-sp-3);
  border: 1px solid var(--tp-border); border-radius: var(--tp-radius-ctl);
  background: var(--tp-surface); color: var(--tp-fg);
  font: inherit; font-size: var(--tp-fs-sm); font-weight: 600; line-height: 1.2; text-align: start;
  cursor: pointer; min-inline-size: 0;
  transition: background var(--tp-dur-fast) var(--tp-ease-out), border-color var(--tp-dur-fast) var(--tp-ease-out), color var(--tp-dur-fast) var(--tp-ease-out);
}
.tp-analytics-tab:hover:not([aria-selected='true']) { background: var(--tp-hover); color: var(--tp-hover-fg); }
.tp-analytics-tab[aria-selected='true'] { background: var(--tp-accent); border-color: var(--tp-accent); color: var(--tp-accent-contrast); cursor: default; }
.tp-analytics-tab-icon {
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  inline-size: 1.75rem; block-size: 1.75rem; border-radius: 50%;
  background: var(--tp-accent-soft); color: var(--tp-accent-soft-fg);
}
.tp-analytics-tab-icon svg { display: block; }
.tp-analytics-tab[aria-selected='true'] .tp-analytics-tab-icon { background: color-mix(in srgb, var(--tp-accent-contrast) 20%, transparent); color: inherit; }

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

/** Bottom sheets (item / basket / waiter / orders / QR-required) and their form controls. */
export const sheetCss = `
/* The scrim. It stays a solid translucent colour on its own so that a browser
   without backdrop-filter still gets a correct, readable dim behind the sheet. */
.tp-sheet-backdrop { position: fixed; inset: 0; z-index: var(--tp-z-sheet); background: var(--tp-backdrop); animation: tp-fade-in var(--tp-dur-base) both; }
.tp-sheet { position: fixed; inset-inline: 0; inset-block-end: 0; z-index: calc(var(--tp-z-sheet) + 1); background: var(--tp-bg); color: var(--tp-fg);
  border-start-start-radius: var(--tp-radius-sheet); border-start-end-radius: var(--tp-radius-sheet); max-block-size: 85vh; max-block-size: 92dvh; overflow-y: auto; overscroll-behavior: contain;
  padding: var(--tp-space-5); padding-block-end: calc(var(--tp-space-5) + env(safe-area-inset-bottom)); max-inline-size: var(--tp-column-w); margin-inline: auto;
  box-shadow: var(--tp-shadow-sheet); animation: tp-sheet-in var(--tp-dur-base) var(--tp-ease-out) both; }
/* The sheet root is focused programmatically on open to seat the focus trap
   (SheetShell). It is tabIndex={-1} and never a keyboard target of its own, so
   the global :focus-visible ring would just draw an accent line round the whole
   sheet the moment it appears. Every real control inside it keeps its own ring. */
.tp-sheet[role='dialog']:focus, .tp-sheet[role='dialog']:focus-visible { outline: none; }
/* Exit: the entrance played backwards — the sheet slides back down off the
   bottom over the same duration, on the mirrored curve (ease-out reversed is
   ease-in), while the backdrop fades. SheetShell holds both mounted for it.
   Dragging the sheet closed is exempt: the pointer already carried it down, so
   it fades from where it was left rather than jumping back up to replay. */
.tp-sheet[data-closing='true'] { animation: tp-sheet-out var(--tp-dur-base) cubic-bezier(0.8, 0, 0.8, 0.2) both; }
.tp-sheet[data-closing='true'][data-dragged='true'] { animation: tp-fade-out var(--tp-dur-base) var(--tp-ease-out) both; }
/* The scrim sits above the topbar and the FABs, so while it is fading it is
   still a dimmed, blurred layer sitting over the bell and the basket button.
   It leads the sheet out — gone in --tp-dur-fast on an ease-in, so those
   controls are clear almost at once — and stops taking pointer events the
   moment the close begins, rather than swallowing a tap for the whole exit. */
.tp-sheet-backdrop[data-closing='true'] { animation: tp-fade-out var(--tp-dur-fast) ease-in both; pointer-events: none; }
/* Where it is supported, the scrim also blurs the menu behind it.

   The blur is driven by a TRANSITION, not by the fade keyframes: several
   engines refuse to interpolate backdrop-filter inside an animation and simply
   snap it to the end value, which made the blur vanish the instant the sheet
   started closing instead of easing off with the scrim. A transition between
   two declared states interpolates reliably.

   The starting state is set under [data-entering] for the first frame only, so
   the blur ramps up on open; on close, [data-closing] returns it to blur(0). */
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .tp-sheet-backdrop { backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    transition: backdrop-filter var(--tp-dur-base) var(--tp-ease-out), -webkit-backdrop-filter var(--tp-dur-base) var(--tp-ease-out); }
  /* On the way out the blur clears with the scrim, not on the slower open ramp. */
  .tp-sheet-backdrop[data-closing='true'] {
    transition: backdrop-filter var(--tp-dur-fast) ease-in, -webkit-backdrop-filter var(--tp-dur-fast) ease-in; }
  .tp-sheet-backdrop[data-entering='true'],
  .tp-sheet-backdrop[data-closing='true'] { backdrop-filter: blur(0); -webkit-backdrop-filter: blur(0); }
}
.tp-sheet h2 { font-family: var(--tp-font-display); font-size: var(--tp-fs-lg); }
.tp-sheet__header { position: sticky; inset-block-start: calc(-1 * var(--tp-space-5)); background: var(--tp-bg); z-index: var(--tp-z-sticky); padding-block: var(--tp-space-2); touch-action: none; }
/* The top margin keeps the pill off the sheet's rounded edge. It has to live on
   the grip: the .tp-sheet--panel .tp-sheet__header rule below zeroes padding-block
   and, as a two-class selector, outranks any padding set on .tp-sheet__drag. */
.tp-sheet__grip { inline-size: 2.5rem; block-size: 0.3rem; border-radius: var(--tp-radius-pill);
  /* --tp-border is the menu hairline: near-invisible on the sheet's white, which
     hid the one affordance telling a guest the sheet can be swiped away. Grey
     enough to read, still quiet enough not to be a control. */
  background: var(--tp-cafe-ink-soft); opacity: .55; margin-inline: auto;
  margin-block-start: var(--tp-space-3); margin-block-end: var(--tp-space-3); }
.tp-sheet__row { display: flex; align-items: center; justify-content: space-between; gap: var(--tp-space-3); padding-block: 0.6rem; }
.tp-sheet__group { margin-block-start: var(--tp-space-4); }
.tp-sheet__group--revealed { margin-inline-start: var(--tp-space-3); padding-inline-start: var(--tp-space-3); border-inline-start: 2px solid var(--tp-brown-40); }
.tp-sheet__group > h3 { font-size: 0.95rem; margin-block-end: 0.35rem; display: flex; gap: var(--tp-space-2); align-items: baseline; }
.tp-sheet__hint { color: var(--tp-muted-fg); font-size: 0.78rem; font-weight: 400; }
.tp-sheet__image { position: relative; aspect-ratio: 4 / 3; border-radius: var(--tp-radius-md); overflow: hidden; background: var(--tp-cafe-brown-tint); margin-block-end: var(--tp-space-4); }
.tp-sheet__image img { inline-size: 100%; block-size: 100%; object-fit: cover; display: block; }
.tp-opt { display: flex; align-items: center; gap: 0.6rem; padding-block: var(--tp-space-2); border-block-end: 1px solid var(--tp-border); }
.tp-opt input { inline-size: 1.15rem; block-size: 1.15rem; accent-color: var(--tp-accent); }
.tp-opt__price { margin-inline-start: auto; color: var(--tp-muted-fg); font-size: var(--tp-fs-sm); white-space: nowrap; }
/* Quantity: one segmented pill rather than two loose circles, so the control
   reads as a single object and balances the price across the footer row. The
   glyphs are drawn, not typed — a text minus/plus carries font metrics that
   never centre in a fixed box (see CloseIcon). */
.tp-qty { display: inline-flex; align-items: center; background: var(--tp-cafe-blue-tint);
  border-radius: var(--tp-radius-pill); padding: 0.2rem; }
.tp-qty__step { inline-size: 2.1rem; block-size: 2.1rem; border-radius: 50%; border: none; padding: 0;
  display: grid; place-items: center; background: transparent; color: var(--tp-cafe-blue);
  transition: background var(--tp-dur-fast) var(--tp-ease-out), color var(--tp-dur-fast) var(--tp-ease-out); }
/* The pressed state is a white knob on the tint, which also gives the tap a
   visible target on a touch screen where there is no hover. */
.tp-qty__step:active:not(:disabled) { background: var(--tp-bg); }
@media (hover: hover) {
  .tp-qty__step:hover:not(:disabled) { background: var(--tp-bg); }
}
/* At the bounds the button really is disabled now, so it has to say so: the
   glyph fades rather than the whole pill, which would read as the control
   itself being unavailable. */
.tp-qty__step:disabled { color: var(--tp-cafe-ink-soft); cursor: default; }
.tp-qty__value { min-inline-size: 2rem; text-align: center; font-family: var(--tp-font-display);
  font-weight: var(--tp-fw-display); font-size: 1.05rem; color: var(--tp-cafe-ink); font-variant-numeric: tabular-nums; }
.tp-textarea { inline-size: 100%; border: 1px solid var(--tp-border); border-radius: var(--tp-radius-sm); padding: 0.6rem;
  font: inherit; font-size: max(16px, 1rem); background: var(--tp-bg); color: var(--tp-fg); resize: vertical; min-block-size: 3.5rem; }
.tp-counter { font-size: var(--tp-fs-xs); color: var(--tp-muted-fg); text-align: end; }

/* ---------------------------------------------------------------------------
   Panel sheets (ItemSheet / BasketSheet): fixed header + scrolling body + foot.
   The sheet element itself never scrolls, so the drag header (touch-action:none)
   and the CTA stay put while the body scrolls.
   --------------------------------------------------------------------------- */
.tp-sheet--panel { padding: 0; overflow: hidden; display: flex; flex-direction: column; }
.tp-sheet--panel .tp-sheet__header { position: static; padding-block: 0; }
.tp-sheet__drag { padding-block-start: var(--tp-space-2); background: var(--tp-bg);
  border-start-start-radius: var(--tp-radius-sheet); border-start-end-radius: var(--tp-radius-sheet); }
.tp-sheet__scroll { flex: 1 1 auto; min-block-size: 0; overflow-y: auto; overscroll-behavior: contain;
  padding-inline: var(--tp-space-5); padding-block-end: var(--tp-space-4); }
.tp-sheet__foot { flex: none; padding-inline: var(--tp-space-5); padding-block: var(--tp-space-3);
  padding-block-end: calc(var(--tp-space-3) + env(safe-area-inset-bottom)); border-block-start: 1px solid var(--tp-border);
  background: var(--tp-bg); display: grid; gap: var(--tp-space-2); }
.tp-sheet__close { position: absolute; inset-block-start: var(--tp-space-3); inset-inline-end: var(--tp-space-3); z-index: var(--tp-z-sticky);
  inline-size: 2.25rem; block-size: 2.25rem; border-radius: 50%; border: none; display: grid; place-items: center;
  background: var(--tp-bg); color: var(--tp-fg); box-shadow: var(--tp-shadow-card); padding: 0; }
.tp-sheet__scrollhint { position: absolute; inset-inline: 0; inset-block-end: 0; block-size: 2.5rem; display: grid; place-items: end center;
  pointer-events: none; color: var(--tp-muted-fg); font-size: 1rem; transition: opacity var(--tp-dur-base);
  animation: tp-float 1.8s ease-in-out infinite; }
.tp-sheet__scrollhint[data-at-bottom='true'] { opacity: 0; }

/* item sheet -------------------------------------------------------------- */
.tp-itemsheet__media { position: relative; inline-size: 100%; aspect-ratio: 4 / 3; max-block-size: 42vh; overflow: hidden; background: var(--tp-cafe-brown-tint); }
.tp-itemsheet__layer { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; object-fit: cover; display: block; }
.tp-itemsheet__layer--blur { filter: blur(12px); scale: 1.1; }
.tp-itemsheet__layer--full { opacity: 0; transition: opacity var(--tp-dur-slow) var(--tp-ease-out); }
.tp-itemsheet__layer--full[data-loaded='true'] { opacity: 1; }
/* No photo yet: the band's tint under a large section icon, so the frame reads
   as a deliberate placeholder rather than an empty box. Matches the menu row's
   thumbnail treatment, one size up for the sheet's much larger frame.

   The tint has to run up through the drag header as well, or the header's own
   --tp-bg prints a pale strip above it and the placeholder looks clipped at the
   sheet's rounded top. The header keeps its padding so the drag target and the
   grip's clearance are unchanged; the grip simply sits on the tint, and gets a
   A real photo is untouched — the strip above it is intentional there. The grip
   needs no special case here: its own rule is already grey enough for the tint. */
.tp-sheet__drag[data-placeholder='true'] { background: var(--tp-cafe-blue-tint); }
.tp-sheet__drag[data-placeholder='true'][data-tone='green'] { background: var(--tp-cafe-green-tint); }
/* No photo yet: the band's tint under a large section icon, so the frame reads
   as a deliberate placeholder rather than an empty box. Matches the menu row's
   thumbnail treatment, one size up for the sheet's much larger frame. */
.tp-itemsheet__media[data-placeholder='true'] { background: var(--tp-cafe-blue-tint); }
.tp-itemsheet__media[data-placeholder='true'][data-tone='green'] { background: var(--tp-cafe-green-tint); }
.tp-itemsheet__placeholder { position: absolute; inset: 0; display: grid; place-items: center; }
.tp-itemsheet__placeholder-icon { inline-size: min(38%, 132px); block-size: auto; aspect-ratio: 1; opacity: .8; }

.tp-itemsheet__spinner { position: absolute; inset: 0; display: grid; place-items: center; }
.tp-itemsheet__expand { position: absolute; inset-block-end: var(--tp-space-3); inset-inline-end: var(--tp-space-3);
  inline-size: 2.25rem; block-size: 2.25rem; border-radius: 50%; border: none; display: grid; place-items: center; padding: 0;
  background: var(--tp-bg); color: var(--tp-fg); box-shadow: var(--tp-shadow-card); }
.tp-itemsheet__sticky { position: sticky; inset-block-start: 0; z-index: var(--tp-z-sticky); background: var(--tp-bg);
  padding-block: var(--tp-space-3); margin-inline: calc(-1 * var(--tp-space-5)); padding-inline: var(--tp-space-5);
  border-block-end: 1px solid var(--tp-border); }
.tp-itemsheet__eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: var(--tp-tracking-eyebrow); color: var(--tp-muted-fg); font-weight: 700; }
/* Sized to match the basket's own h2 and its empty state, so every sheet
   heading in the app sits at the same --tp-fs-lg. */
.tp-itemsheet__name { font-family: var(--tp-font-display); font-weight: var(--tp-fw-display); font-size: var(--tp-fs-lg);
  line-height: var(--tp-lh-tight); letter-spacing: var(--tp-tracking-caps); text-transform: uppercase; margin-block-start: 0.15rem; }
.tp-itemsheet__hook { font-size: 11px; text-transform: uppercase; letter-spacing: var(--tp-tracking-eyebrow); color: var(--tp-cafe-brown); font-weight: 700; margin-block-start: var(--tp-space-3); }
.tp-itemsheet__desc { color: var(--tp-muted-fg); font-size: 0.9rem; margin-block-start: var(--tp-space-2); }
.tp-itemsheet__prices { display: flex; align-items: baseline; gap: var(--tp-space-2); font-variant-numeric: tabular-nums; }
.tp-itemsheet__price { font-family: var(--tp-font-display); font-weight: var(--tp-fw-display); font-size: var(--tp-fs-lg); color: var(--tp-cafe-brown); }
.tp-itemsheet__price--list { text-decoration: line-through; color: var(--tp-muted-fg); font-size: var(--tp-fs-sm); font-weight: 400; font-family: inherit; }
.tp-req { font-size: var(--tp-fs-xs); font-weight: 700; padding-block: 0.1rem; padding-inline: 0.5rem; border-radius: var(--tp-radius-pill);
  border: 1px solid var(--tp-accent); color: var(--tp-accent); background: transparent; }
.tp-req[data-unsatisfied='true'] { background: var(--tp-accent); color: var(--tp-accent-contrast); }
.tp-suggest { display: flex; gap: var(--tp-space-3); overflow-x: auto; overscroll-behavior-inline: contain; padding-block: var(--tp-space-2); }
.tp-suggest__tile { flex: none; inline-size: 5.5rem; border: 1px solid var(--tp-border); border-radius: var(--tp-radius-sm);
  background: var(--tp-surface); padding: var(--tp-space-2); display: grid; gap: 0.25rem; justify-items: center; text-align: center; }
.tp-suggest__photo { position: relative; inline-size: 4rem; block-size: 4rem; border-radius: var(--tp-radius-xs); overflow: hidden; background: var(--tp-cafe-brown-tint); }
.tp-suggest__photo img { inline-size: 100%; block-size: 100%; object-fit: cover; display: block; }
.tp-suggest__name { font-size: var(--tp-fs-xs); font-weight: 700; }
.tp-suggest__price { font-size: var(--tp-fs-xs); color: var(--tp-cafe-brown); font-weight: 700; }

/* lightbox ---------------------------------------------------------------- */
.tp-lightbox { position: fixed; inset: 0; z-index: var(--tp-z-lightbox); background: var(--tp-fg); display: grid; place-items: center; touch-action: none; overflow: hidden; }
.tp-lightbox img { max-inline-size: 100%; max-block-size: 100%; object-fit: contain; }
.tp-lightbox__stage { inline-size: 100%; block-size: 100%; display: grid; place-items: center; will-change: transform; }
.tp-lightbox__close { position: absolute; inset-block-start: calc(var(--tp-space-3) + env(safe-area-inset-top)); inset-inline-end: var(--tp-space-3);
  inline-size: 2.5rem; block-size: 2.5rem; border-radius: 50%; border: none; display: grid; place-items: center;
  background: var(--tp-bg); color: var(--tp-fg); padding: 0; }

.tp-toast { position: fixed; inset-block-end: calc(4.5rem + env(safe-area-inset-bottom)); inset-inline: 0; z-index: var(--tp-z-toast); display: flex; justify-content: center; pointer-events: none; }
.tp-toast__pill { pointer-events: auto; background: var(--tp-fg); color: var(--tp-bg); border-radius: var(--tp-radius-pill); padding-block: 0.6rem; padding-inline: 1rem; font-size: var(--tp-fs-sm); font-weight: 600;
  max-inline-size: calc(100% - 2rem); box-shadow: var(--tp-shadow-card); animation: tp-slide-up var(--tp-dur-base) var(--tp-ease-out) both; }
.tp-toast__pill[data-kind='error'] { background: var(--tp-danger); color: var(--tp-danger-contrast); }
.tp-offline { position: fixed; inset-block-start: 0; inset-inline: 0; z-index: var(--tp-z-offline); background: var(--tp-warn-bg); color: var(--tp-warn-fg); text-align: center; font-size: var(--tp-fs-sm);
  padding-block: 0.4rem; padding-inline: var(--tp-space-4); padding-block-start: calc(0.4rem + env(safe-area-inset-top)); }
`;

/** Bottom sheets (item / basket / waiter / orders / QR-required) and their form controls. */
export const sheetCss = `
.tp-sheet-backdrop { position: fixed; inset: 0; z-index: var(--tp-z-sheet); background: var(--tp-backdrop); animation: tp-fade-in var(--tp-dur-base) both; }
.tp-sheet { position: fixed; inset-inline: 0; inset-block-end: 0; z-index: calc(var(--tp-z-sheet) + 1); background: var(--tp-bg); color: var(--tp-fg);
  border-start-start-radius: var(--tp-radius-sheet); border-start-end-radius: var(--tp-radius-sheet); max-block-size: 85vh; max-block-size: 92dvh; overflow-y: auto; overscroll-behavior: contain;
  padding: var(--tp-space-5); padding-block-end: calc(var(--tp-space-5) + env(safe-area-inset-bottom)); max-inline-size: var(--tp-column-w); margin-inline: auto;
  box-shadow: var(--tp-shadow-sheet); animation: tp-slide-up var(--tp-dur-base) var(--tp-ease-out) both; }
.tp-sheet h2 { font-family: var(--tp-font-display); font-size: var(--tp-fs-lg); }
.tp-sheet__header { position: sticky; inset-block-start: calc(-1 * var(--tp-space-5)); background: var(--tp-bg); z-index: var(--tp-z-sticky); padding-block: var(--tp-space-2); touch-action: none; }
.tp-sheet__grip { inline-size: 2.5rem; block-size: 0.3rem; border-radius: var(--tp-radius-pill); background: var(--tp-border); margin-inline: auto; margin-block-end: var(--tp-space-3); }
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
.tp-qty { display: inline-flex; align-items: center; gap: var(--tp-space-3); }
.tp-qty button { inline-size: 2.25rem; block-size: 2.25rem; border-radius: 50%; border: 1px solid var(--tp-border);
  background: var(--tp-surface); font-size: 1.1rem; font-weight: 700; color: var(--tp-fg); }
.tp-qty span { min-inline-size: 1.5rem; text-align: center; font-weight: 700; }
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
  background: var(--tp-bg); color: var(--tp-fg); box-shadow: var(--tp-shadow-card); font-size: 1.1rem; line-height: 1; }
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
.tp-itemsheet__spinner { position: absolute; inset: 0; display: grid; place-items: center; }
.tp-itemsheet__expand { position: absolute; inset-block-end: var(--tp-space-3); inset-inline-end: var(--tp-space-3);
  inline-size: 2.25rem; block-size: 2.25rem; border-radius: 50%; border: none; display: grid; place-items: center;
  background: var(--tp-bg); color: var(--tp-fg); box-shadow: var(--tp-shadow-card); }
.tp-itemsheet__sticky { position: sticky; inset-block-start: 0; z-index: var(--tp-z-sticky); background: var(--tp-bg);
  padding-block: var(--tp-space-3); margin-inline: calc(-1 * var(--tp-space-5)); padding-inline: var(--tp-space-5);
  border-block-end: 1px solid var(--tp-border); }
.tp-itemsheet__eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: var(--tp-tracking-eyebrow); color: var(--tp-muted-fg); font-weight: 700; }
.tp-itemsheet__name { font-family: var(--tp-font-display); font-weight: var(--tp-fw-display); font-size: var(--tp-fs-xl);
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
  background: var(--tp-bg); color: var(--tp-fg); font-size: 1.2rem; line-height: 1; }

.tp-toast { position: fixed; inset-block-end: calc(4.5rem + env(safe-area-inset-bottom)); inset-inline: 0; z-index: var(--tp-z-toast); display: flex; justify-content: center; pointer-events: none; }
.tp-toast__pill { pointer-events: auto; background: var(--tp-fg); color: var(--tp-bg); border-radius: var(--tp-radius-pill); padding-block: 0.6rem; padding-inline: 1rem; font-size: var(--tp-fs-sm); font-weight: 600;
  max-inline-size: calc(100% - 2rem); box-shadow: var(--tp-shadow-card); animation: tp-slide-up var(--tp-dur-base) var(--tp-ease-out) both; }
.tp-toast__pill[data-kind='error'] { background: var(--tp-danger); color: var(--tp-danger-contrast); }
.tp-offline { position: fixed; inset-block-start: 0; inset-inline: 0; z-index: var(--tp-z-offline); background: var(--tp-warn-bg); color: var(--tp-warn-fg); text-align: center; font-size: var(--tp-fs-sm);
  padding-block: 0.4rem; padding-inline: var(--tp-space-4); padding-block-start: calc(0.4rem + env(safe-area-inset-top)); }
`;

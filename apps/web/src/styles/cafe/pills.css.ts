/**
 * Category rail — the design's sticky nav: a white bar under the masthead
 * carrying pill links. Resting pill is blue-on-blue-tint; the active one is a
 * green fill with deep-blue ink.
 */
export const pillsCss = `
.tp-cattabs { display: flex; flex-wrap: nowrap; gap: 8px; overflow-x: auto; overflow-y: hidden;
  padding-block: 10px; padding-inline: 14px; scrollbar-width: none; scroll-snap-type: inline proximity;
  scroll-padding-inline: 14px; }
.tp-cattabs::-webkit-scrollbar { display: none; }
.tp-cattabs button { flex: 0 0 auto; scroll-snap-align: start; border: 0; background: var(--tp-cafe-blue-tint); color: var(--tp-accent);
  border-radius: var(--tp-radius-pill); padding-block: 4px; padding-inline: 16px; font-weight: 700; font-size: 14px;
  white-space: nowrap; line-height: 1.6;
  transition: background var(--tp-dur-fast), color var(--tp-dur-fast); }
.tp-cattabs button[aria-current='true'] { background: var(--tp-cafe-green-light); color: var(--tp-cafe-blue-ink); font-weight: 800; }
/* Sticks to the top of .tp-app__scroll — the topbar sits ABOVE that scroller
   in the flex shell, so inset-block-start: 0 lands right under it. The rail
   needs its own opaque background and a hairline, or the menu scrolls through. */
.tp-cattabs--sticky { position: sticky; inset-block-start: 0; z-index: var(--tp-z-sticky); background: var(--tp-bg);
  border-block-end: 1px solid var(--tp-cafe-rule); }
/* The design's nav carries text only; the thumbnails collapse to nothing and
   are kept in the DOM so a photo-led rail stays one operator setting away. */
.tp-cattabs__thumb { inline-size: 0; block-size: 1.5rem; border-radius: 50%; object-fit: cover; opacity: 0; margin-inline-end: 0;
  transition: inline-size var(--tp-dur-slow) var(--tp-ease-out), opacity var(--tp-dur-slow); }
`;

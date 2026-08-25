/** Category pills: sticky rail, active = blue fill, fade to inline-end. */
export const pillsCss = `
.tp-cattabs { display: flex; gap: var(--tp-space-2); overflow-x: auto; overflow-y: hidden; padding-block: var(--tp-space-3); scrollbar-width: none; scroll-snap-type: inline proximity;
  mask-image: linear-gradient(to inline-end, var(--tp-fg) 92%, transparent); -webkit-mask-image: linear-gradient(to inline-end, var(--tp-fg) 92%, transparent); }
.tp-cattabs::-webkit-scrollbar { display: none; }
.tp-cattabs button { flex: none; scroll-snap-align: start; border: 1px solid var(--tp-border); background: var(--tp-surface); color: var(--tp-fg);
  border-radius: var(--tp-radius-pill); padding-block: 0.4rem; padding-inline: 0.9rem; font-weight: 600; min-block-size: 2.25rem;
  transition: background var(--tp-dur-fast), color var(--tp-dur-fast); }
.tp-cattabs button[aria-current='true'] { background: var(--tp-accent); color: var(--tp-accent-contrast); border-color: transparent; }
.tp-cattabs--sticky { position: sticky; inset-block-start: 0; z-index: var(--tp-z-sticky); background: var(--tp-bg); }
.tp-cattabs__thumb { inline-size: 1.5rem; block-size: 1.5rem; border-radius: 50%; object-fit: cover; margin-inline-end: 0.4rem; vertical-align: middle;
  transition: inline-size var(--tp-dur-slow) var(--tp-ease-out), opacity var(--tp-dur-slow); }
.tp-cattabs[data-compact='true'] .tp-cattabs__thumb { inline-size: 0; margin-inline-end: 0; opacity: 0; }
`;

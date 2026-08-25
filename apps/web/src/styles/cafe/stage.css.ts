/** Menu stage: category sections with photo band + ALL-CAPS name, collapsible. */
export const stageCss = `
.tp-menu-cat { margin-block-start: var(--tp-space-6); }
.tp-menu-cat > h2 { font-family: var(--tp-font-display); font-size: 1.3rem; font-weight: var(--tp-fw-display); text-transform: uppercase; letter-spacing: var(--tp-tracking-caps);
  padding-block-end: var(--tp-space-2); border-block-end: 2px solid var(--tp-accent-2); margin-block-end: var(--tp-space-3); }
[dir='rtl'] .tp-menu-cat > h2 { font-family: var(--tp-font-arabic); font-weight: 700; }
.tp-stage__head { display: flex; align-items: center; gap: var(--tp-space-3); inline-size: 100%; background: none; border: 0; padding-block: var(--tp-space-3); padding-inline: 0; text-align: start; }
.tp-stage__band { position: relative; inline-size: 4.5rem; block-size: 3rem; border-radius: var(--tp-radius-sm); overflow: hidden; background: var(--tp-cafe-brown-tint); flex: none; }
.tp-stage__band img { inline-size: 100%; block-size: 100%; object-fit: cover; }
.tp-stage__count { color: var(--tp-muted-fg); font-size: var(--tp-fs-sm); }
.tp-stage__chevron { margin-inline-start: auto; transition: transform var(--tp-dur-base) var(--tp-ease-out); }
.tp-stage[data-open='false'] .tp-stage__chevron { transform: rotate(-90deg); }
.tp-stage__body { display: grid; grid-template-rows: 1fr; transition: grid-template-rows var(--tp-dur-base) var(--tp-ease-out); }
.tp-stage[data-open='false'] .tp-stage__body { grid-template-rows: 0fr; }
.tp-stage__body > * { min-block-size: 0; overflow: hidden; }
.tp-menu-unavailable { text-align: center; padding-block: var(--tp-space-6); padding-inline: var(--tp-space-5); display: flex; flex-direction: column; align-items: center; gap: var(--tp-space-3); }
.tp-menu-unavailable h2 { font-family: var(--tp-font-display); font-size: var(--tp-fs-lg); }
.tp-menu-unavailable p { color: var(--tp-muted-fg); max-inline-size: 26rem; }
`;

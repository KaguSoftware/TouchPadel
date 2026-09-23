/**
 * Public legal pages (/privacy, /support): one readable column of prose on the
 * page ground — a white sheet capped at ~68 characters a line, logical
 * properties only so the Arabic page mirrors without a second stylesheet.
 */
export const legalCss = `
.tp-legal { max-inline-size: calc(68ch + 2 * var(--tp-space-5)); margin-inline: auto; min-block-size: 100dvh;
  padding-block: var(--tp-space-5) var(--tp-space-6); padding-inline: var(--tp-space-5);
  background: var(--tp-bg); color: var(--tp-fg); box-shadow: var(--tp-shadow-column);
  font-size: var(--tp-fs-md); line-height: 1.65; }
.tp-legal__header { display: grid; gap: var(--tp-space-2); padding-block-end: var(--tp-space-4); border-block-end: 1px solid var(--tp-border); }
.tp-legal__nav { display: flex; flex-wrap: wrap; gap: var(--tp-space-2) var(--tp-space-4); font-size: var(--tp-fs-sm); margin-block-end: var(--tp-space-4); }
.tp-legal__nav a { font-weight: 600; text-underline-offset: 0.2em; }
.tp-legal__nav a[aria-current='page'] { color: var(--tp-fg); text-decoration: none; }
.tp-legal__title { font-family: var(--tp-font-display); font-size: var(--tp-fs-2xl); line-height: var(--tp-lh-tight); }
.tp-legal__updated { font-size: var(--tp-fs-sm); color: var(--tp-muted-fg); }
.tp-legal__intro { margin-block-start: var(--tp-space-2); }
.tp-legal__section { margin-block-start: var(--tp-space-5); display: grid; gap: var(--tp-space-3); }
.tp-legal__heading { font-family: var(--tp-font-display); font-size: var(--tp-fs-lg); line-height: var(--tp-lh-tight); }
.tp-legal__subtitle { font-size: var(--tp-fs-md); margin-block: var(--tp-space-2) 0; }
.tp-legal ul { margin-block: 0; padding-inline-start: 1.25rem; display: grid; gap: var(--tp-space-2); }
.tp-legal li::marker { color: var(--tp-accent); }
.tp-legal__phone { direction: ltr; unicode-bidi: isolate; font-weight: 700; font-variant-numeric: tabular-nums; font-family: var(--tp-font-numeric); }
.tp-legal__hours { max-inline-size: 22rem; }
.tp-legal__email { direction: ltr; unicode-bidi: isolate; font-weight: 700; }
/* /delete-account: the sign-in and confirmation form. */
.tp-legal__form { display: grid; gap: var(--tp-space-3); padding: var(--tp-space-4); border: 1px solid var(--tp-border);
  border-radius: var(--tp-radius-sm); background: var(--tp-surface); }
.tp-legal__methods { display: flex; flex-wrap: wrap; gap: var(--tp-space-2) var(--tp-space-4); border: 0; padding: 0; margin: 0; }
.tp-legal__methods legend { font-weight: 700; margin-block-end: var(--tp-space-2); }
.tp-legal__method { display: inline-flex; align-items: center; gap: var(--tp-space-2); }
.tp-legal__method input { accent-color: var(--tp-accent); }
.tp-legal__field { display: grid; gap: var(--tp-space-1); font-weight: 600; }
.tp-legal__input { inline-size: 100%; min-block-size: 2.75rem; border: 1px solid var(--tp-border); border-radius: var(--tp-radius-sm);
  padding-block: 0.5rem; padding-inline: 0.75rem; background: var(--tp-bg); color: var(--tp-fg); }
.tp-legal__actions { display: flex; flex-wrap: wrap; gap: var(--tp-space-2); }
.tp-legal__danger { background: var(--tp-danger); color: var(--tp-danger-contrast); }
.tp-legal__error { padding: var(--tp-space-2) var(--tp-space-3); border: 1px solid var(--tp-error-border);
  border-radius: var(--tp-radius-sm); background: var(--tp-error-bg); }
`;

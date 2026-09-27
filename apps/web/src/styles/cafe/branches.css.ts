/**
 * Branches (multi-venue slice 4): the walk-in branch chooser on /{locale}/menu
 * when several branches are open, and the one-line "which branch" strip above
 * the hero once a walk-in has chosen. Neither is drawn while one branch is open.
 */
export const branchesCss = `
.tp-branches { gap: var(--tp-space-4); text-align: center; padding-block: var(--tp-space-6); padding-inline: var(--tp-space-5); }
.tp-branches__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--tp-space-3); inline-size: 100%; max-inline-size: 26rem; }
.tp-branches__option { display: flex; flex-direction: column; align-items: flex-start; gap: var(--tp-space-1); text-align: start;
  background: var(--tp-surface); color: var(--tp-fg); border: 1px solid var(--tp-border); border-radius: var(--tp-radius-md);
  padding-block: var(--tp-space-3); padding-inline: var(--tp-space-4); text-decoration: none; }
.tp-branches__option:hover, .tp-branches__option:focus-visible { border-color: var(--tp-accent); }
.tp-branches__name { font-weight: 800; font-size: var(--tp-fs-lg); }
.tp-branches__address { font-size: var(--tp-fs-sm); color: var(--tp-muted-fg); }
.tp-branchbar { display: flex; align-items: center; justify-content: space-between; gap: var(--tp-space-3);
  padding-block: var(--tp-space-2); padding-inline: var(--tp-space-5); font-size: var(--tp-fs-sm);
  background: var(--tp-surface); border-block-end: 1px solid var(--tp-border); }
.tp-branchbar__name { font-weight: 800; }
.tp-branchbar a { color: var(--tp-accent); font-weight: 700; white-space: nowrap; }
`;

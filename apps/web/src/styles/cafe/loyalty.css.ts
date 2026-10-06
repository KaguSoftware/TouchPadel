/**
 * The "earn points" chip on a bound table (loyalty plan §5.2), under the live-orders strip and
 * set on the menu stage's own 24 px gutter. The signed-out chip is a link in the strip's tint;
 * linked, it reads as a quiet status line; a failed link is muted text with a small retry.
 */
export const loyaltyCss = `
.tp-earn-chip { display: flex; flex-wrap: wrap; align-items: center; gap: var(--tp-space-2); inline-size: fit-content; max-inline-size: calc(100% - 48px);
  margin-block-start: var(--tp-space-3); margin-inline: 24px; padding-block: 0.4rem; padding-inline: 0.9rem;
  border-radius: var(--tp-radius-pill); background: var(--tp-cafe-blue-tint); color: var(--tp-accent); font-weight: 700; font-size: var(--tp-fs-sm); text-decoration: none; }
.tp-earn-chip__dot { inline-size: 0.5rem; block-size: 0.5rem; border-radius: 50%; background: var(--tp-accent); }
.tp-earn-chip--linked { background: transparent; padding-inline: 0; color: var(--tp-fg); }
.tp-earn-chip__balance { color: var(--tp-muted-fg); font-weight: 600; }
.tp-earn-chip--quiet { background: transparent; padding-inline: 0; color: var(--tp-muted-fg); font-weight: 400; }
.tp-earn-chip__retry { border: 0; background: transparent; padding: 0; color: var(--tp-accent); font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }
`;

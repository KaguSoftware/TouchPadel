/**
 * Tokens bridge — the ONLY module allowed to contain raw colour literals
 * (cafe-css.test.ts exempts it). It carries UA-level fallbacks for the moment
 * before the theme block applies and component-scoped derived properties that
 * are pure functions of the @touch/ui tokens.
 */
export const tokensBridgeCss = `
:root { color-scheme: light; }
/* Fallback ground if the theme attribute is ever missing (never on a real page). */
html:not([data-theme]) { --tp-bg: #FFFFFF; --tp-fg: #1E2B45; --tp-accent: #2456B4; --tp-accent-contrast: #FFFFFF; }

.tp-cafe, .tp-app {
  /* bean-pattern default opacities (BeanPattern can override via inline --tp-beans-opacity) */
  --tp-beans-opacity-brown: 0.06;
  --tp-beans-opacity-white: 0.08;
  /* highlight tints: 10 % brand colour over the surface + 3 px inset ring.
     The DB enum still spells the second one 'brown' (menu_items.highlight), so
     the -brown names stay; only the colour behind them is now the design green. */
  --tp-highlight-blue-bg: color-mix(in srgb, var(--tp-cafe-blue) 10%, var(--tp-bg));
  --tp-highlight-green-bg: color-mix(in srgb, var(--tp-cafe-green) 10%, var(--tp-bg));
  --tp-highlight-brown-bg: var(--tp-highlight-green-bg);
  --tp-highlight-ring-blue: inset 0 0 0 3px var(--tp-cafe-blue);
  --tp-highlight-ring-green: inset 0 0 0 3px var(--tp-cafe-green);
  --tp-highlight-ring-brown: var(--tp-highlight-ring-green);
  --tp-brown-40: color-mix(in srgb, var(--tp-cafe-green) 40%, transparent);
}
::selection { background: var(--tp-cafe-blue-tint-2); color: var(--tp-accent); }
`;

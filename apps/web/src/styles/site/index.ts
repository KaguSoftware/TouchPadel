/**
 * The Touch Padel site stylesheet: the home page, the legal pages and the 404. Inlined by
 * `SiteStyles` into those pages only (never into the root layout, so the café menu and a
 * table guest on venue wifi never download it), after the layout's theme tokens.
 *
 * Enforced by site-css.test.ts (which also runs over the court's `courtCss`): CSS logical
 * properties only; colours only via `var(--tp-*)` (raw literals only in the tokens
 * bridge); a `prefers-reduced-motion` block in every module that moves. House style, not
 * tested: z-index via `--tp-site-z-*`, animate only transform / opacity / clip-path /
 * stroke-dashoffset, and none of the café's own scale (`--tp-fs-*`, `--tp-radius-*`,
 * `--tp-space-*`, `--tp-cafe-*`) inside the site.
 */
import { siteTokensBridgeCss } from './tokens-bridge.css';
import { siteBaseCss } from './base.css';
import { siteHeaderCss } from './header.css';
import { sitePhotoCss } from './photo.css';
import { siteHeroCss } from './hero.css';
import { siteClubCss } from './club.css';
import { siteStoriesCss } from './stories.css';
import { siteEventsCss } from './events.css';
import { siteAppBandCss } from './appband.css';
import { siteFaqCss } from './faq.css';
import { siteVisitCss } from './visit.css';
import { siteFooterCss } from './footer.css';
import { siteLegalCss } from './legal.css';
import { siteLostCss } from './lost.css';
import { siteMotionCss } from './motion.css';

/** Module map (name → css): the guard test iterates this so nothing slips past it. */
export const siteCssModules = {
  'tokens-bridge': siteTokensBridgeCss,
  base: siteBaseCss,
  header: siteHeaderCss,
  photo: sitePhotoCss,
  hero: siteHeroCss,
  club: siteClubCss,
  stories: siteStoriesCss,
  events: siteEventsCss,
  appband: siteAppBandCss,
  faq: siteFaqCss,
  visit: siteVisitCss,
  footer: siteFooterCss,
  legal: siteLegalCss,
  lost: siteLostCss,
  motion: siteMotionCss,
} as const;

export const siteCss: string = Object.entries(siteCssModules)
  .map(([name, css]) => `/* ---- site/${name} ---- */${css}`)
  .join('\n');

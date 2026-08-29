/**
 * Touch Cafe app stylesheet — inlined by the root layout after the @touch/ui
 * token CSS (`${themeCss}\n${cafeCss}`), zero render-blocking requests.
 *
 * Rules (enforced by cafe-css.test.ts): CSS LOGICAL PROPERTIES ONLY, colours
 * only via var(--tp-*) (raw literals only in tokens-bridge), one breakpoint,
 * z-index only via --tp-z-*.
 */
import { tokensBridgeCss } from './tokens-bridge.css';
import { baseCss } from './base.css';
import { layoutCss } from './layout.css';
import { topbarCss } from './topbar.css';
import { heroCss } from './hero.css';
import { pillsCss } from './pills.css';
import { stageCss } from './stage.css';
import { cardCss } from './card.css';
import { sheetCss } from './sheet.css';
import { basketCss } from './basket.css';
import { waiterCss } from './waiter.css';
import { ordersCss } from './orders.css';
import { tutorialCss } from './tutorial.css';
import { footerCss } from './footer.css';
import { motionCss } from './motion.css';

/** Module map (name → css) — the guard test iterates this so nothing slips past it. */
export const cafeCssModules = {
  'tokens-bridge': tokensBridgeCss,
  base: baseCss,
  layout: layoutCss,
  topbar: topbarCss,
  hero: heroCss,
  pills: pillsCss,
  stage: stageCss,
  card: cardCss,
  sheet: sheetCss,
  basket: basketCss,
  waiter: waiterCss,
  orders: ordersCss,
  tutorial: tutorialCss,
  footer: footerCss,
  motion: motionCss,
} as const;

export const cafeCss: string = Object.entries(cafeCssModules)
  .map(([name, css]) => `/* ---- cafe/${name} ---- */${css}`)
  .join('\n');

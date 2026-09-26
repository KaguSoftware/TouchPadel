import { padelPalette } from '@touch/ui/tokens/palette';
import { siteNightVars } from '@touch/ui/tokens/site';
import type { SiteMode } from './mode';

/**
 * `<meta name="theme-color">` per mode: the ground the browser chrome should blend
 * into. Read from the tokens, never retyped: night is the page ground (#172C4F), light
 * the app's light ground (#F3F5F9). Server side; the toggle receives both as a prop.
 */
export const SITE_THEME_COLOR: Record<SiteMode, string> = {
  night: siteNightVars['--tp-site-page'],
  light: padelPalette['--tp-bg'],
};

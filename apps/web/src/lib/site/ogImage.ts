import type { Locale } from '@touch/i18n';
import { siteOrigin } from './origin';

/**
 * Bump when `og-touch-padel-{en,ar}.png` is re-rendered. Link-preview crawlers (WhatsApp,
 * Telegram, X, Facebook) cache an image by URL; the query makes the new poster a new URL.
 */
export const OG_IMAGE_VERSION = 2;

/** The Touch Padel share poster for `locale`: absolute, versioned. */
export function siteOgImage(locale: Locale, origin: string = siteOrigin()): string {
  return `${origin}/brand/site/og-touch-padel-${locale}.png?v=${OG_IMAGE_VERSION}`;
}

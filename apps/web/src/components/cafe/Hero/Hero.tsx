'use client';

import type { Locale } from '@touch/i18n';
import type { CafeSettings, MenuItem } from '@/lib/menu';
import { HeroBrand } from './HeroBrand';
import { HeroMedia } from './HeroMedia';
import { HeroFeatured } from './HeroFeatured';

/**
 * The hero. Three operator-chosen modes (`cafe_settings_public.hero_mode`);
 * `featured` silently falls back to the brand panel when the promoted item has
 * left the menu, so a stale setting can never blank the top of the page.
 *
 * The default mode is the design's masthead: the brand sweep on white, under a
 * white topbar. There is no blue crown and therefore no swoosh closing one —
 * the design's column is white from the logo down to the footer's blue arch.
 *
 * The hero does not collapse: it is an ordinary block at the top of the column
 * and simply scrolls away. It used to animate itself to zero height once the
 * guest scrolled past it, which shortened the column UNDER the scroll — enough
 * to land a category jump in the wrong place.
 */
export function Hero({
  locale,
  settings,
  featured,
  onOpenFeatured,
}: {
  locale: Locale;
  settings: CafeSettings;
  featured: MenuItem | null;
  onOpenFeatured(item: MenuItem): void;
}) {
  const mode =
    settings.hero_mode === 'featured' && !featured
      ? 'none'
      : settings.hero_mode === 'media' && !settings.hero_media_path
        ? 'none'
        : settings.hero_mode;

  return (
    <section className="tp-hero" data-mode={mode}>
      {mode === 'media' ? (
        <HeroMedia settings={settings} />
      ) : mode === 'featured' && featured ? (
        <HeroFeatured locale={locale} item={featured} settings={settings} onOpen={onOpenFeatured} />
      ) : (
        <HeroBrand locale={locale} />
      )}
    </section>
  );
}

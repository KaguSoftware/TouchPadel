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
 * Collapse is CSS-only: `[data-collapsed]` animates `grid-template-rows`
 * 1fr → 0fr (hero.css.ts). Nothing unmounts, so scrolling back up restores the
 * hero without a re-layout jump or a re-decode of the image.
 */
export function Hero({
  locale,
  settings,
  featured,
  collapsed,
  onOpenFeatured,
}: {
  locale: Locale;
  settings: CafeSettings;
  featured: MenuItem | null;
  collapsed: boolean;
  onOpenFeatured(item: MenuItem): void;
}) {
  const mode =
    settings.hero_mode === 'featured' && !featured
      ? 'none'
      : settings.hero_mode === 'media' && !settings.hero_media_path
        ? 'none'
        : settings.hero_mode;

  return (
    <section className="tp-hero" data-mode={mode} data-collapsed={collapsed ? 'true' : 'false'}>
      <div className="tp-hero__collapse" aria-hidden={collapsed ? true : undefined}>
        <div>
          {mode === 'media' ? (
            <HeroMedia settings={settings} />
          ) : mode === 'featured' && featured ? (
            <HeroFeatured
              locale={locale}
              item={featured}
              settings={settings}
              onOpen={onOpenFeatured}
            />
          ) : (
            <HeroBrand locale={locale} />
          )}
        </div>
      </div>
    </section>
  );
}

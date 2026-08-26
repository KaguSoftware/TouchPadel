'use client';

import type { Locale } from '@touch/i18n';
import type { CafeSettings, MenuItem, VenueOpeningHours } from '@/lib/menu';
import { todayHours } from '@/lib/cafe/hours';
import { Swoosh } from '../brand/Swoosh';
import { HeroBrand } from './HeroBrand';
import { HeroMedia } from './HeroMedia';
import { HeroFeatured } from './HeroFeatured';

/**
 * The hero. Three operator-chosen modes (`cafe_settings_public.hero_mode`);
 * `featured` silently falls back to the brand panel when the promoted item has
 * left the menu, so a stale setting can never blank the top of the page.
 *
 * The hero is the lower half of ONE blue crown: the topbar ends flat and this
 * section continues the same `--tp-accent` field, so bar + hero read as a
 * single shape closed by a single swoosh.
 *
 * Collapse is CSS-only: `[data-collapsed]` animates `grid-template-rows`
 * 1fr → 0fr (hero.css.ts). Nothing unmounts, so scrolling back up restores the
 * hero without a re-layout jump or a re-decode of the image. The swoosh sits
 * OUTSIDE that collapsing row — it is the crown's bottom edge, so it rides up
 * against the topbar as the hero collapses instead of vanishing with it.
 */
export function Hero({
  locale,
  settings,
  featured,
  itemCount,
  venue,
  collapsed,
  onOpenFeatured,
}: {
  locale: Locale;
  settings: CafeSettings;
  featured: MenuItem | null;
  itemCount: number;
  venue: VenueOpeningHours | null;
  collapsed: boolean;
  onOpenFeatured(item: MenuItem): void;
}) {
  const hours = todayHours(venue);
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
            <HeroBrand locale={locale} itemCount={itemCount} hours={hours} />
          )}
        </div>
      </div>
      {/* The crown's single bottom edge — never collapses. */}
      <div className="tp-hero__band" aria-hidden="true">
        <Swoosh />
      </div>
    </section>
  );
}

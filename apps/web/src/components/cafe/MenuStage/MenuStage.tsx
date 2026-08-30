'use client';

import { makeT, type Locale } from '@touch/i18n';
import type { MenuCategory, MenuItem } from '@/lib/menu';
import { MenuCard } from '../MenuCard/MenuCard';
import { SectionIllustration, sectionArtFor } from './sectionArt';
import { TempChips } from '../TempChips';

/**
 * The menu itself: one section per category, drawn as the approved design does.
 *
 *                                  [بارد]
 *   ┌────────────────────────┐
 *   │ قهوة              ☕  │
 *   └────────────────────────┘
 *   لاتيه [حار][بارد]      3000
 *   كابتشينو [حار]         3000
 *
 * The band IS the section heading — the category is named once, inside the
 * tinted band, in the reading language (Arabic name in Arabic, the design's
 * Latin word in English). There is no second heading above the band.
 *
 * Sections are plain sections, not collapsibles: the design lists the whole
 * menu open, so there is no chevron and nothing to expand. They stay in the SSR
 * HTML (that is the point of the ISR read model), which keeps the scroll-spy
 * offsets and in-page search working.
 *
 * Every row carries a thumbnail. Until the items have their own photography it
 * is the section's own icon on the band's tint (`art` below), so a row reads as
 * belonging to its category instead of showing a hole where a picture goes.
 *
 * Every item is sold in ONE size, so no section carries size headers and every
 * row prints a single price in the same fixed-width column at the end of the
 * row — the numbers run straight down the section.
 */
export function MenuStage({
  locale,
  categories,
  onOpenItem,
  sectionId = (id) => `cat-${id}`,
}: {
  locale: Locale;
  categories: MenuCategory[];
  onOpenItem(item: MenuItem): void;
  sectionId?: (categoryId: string) => string;
}) {
  const tr = makeT(locale);
  const ar = locale === 'ar';

  return (
    <>
      {categories.map((cat) => {
        const art = sectionArtFor(cat.name_en);
        // The band's word is the section's only name, so it follows the
        // reading language: the operator's Arabic name in Arabic, the design's
        // Latin word in English. Arabic names are not in the design's art, so
        // their size step is measured from the name itself.
        const word = ar ? cat.name_ar : (art?.word ?? cat.name_en.toUpperCase());
        const len = ar ? lenFor(word) : (art?.len ?? 'medium');
        return (
          <section key={cat.id} id={sectionId(cat.id)} className="tp-menu-cat tp-stage">
            {cat.serve_temp !== 'none' && (
              <div className="tp-stage__head">
                <TempChips temp={cat.serve_temp} locale={locale} className="tp-stage__badge" />
              </div>
            )}

            {/* data-cat-hero: the scroll spy's activation anchor — this band
                reaching the top of the reading area is what flips the rail. */}
            <div className="tp-stage__band" data-cat-hero="" data-tone={art?.tone ?? 'blue'}>
              <h2 className="tp-stage__word" data-len={len}>
                {word}
              </h2>
              <SectionIllustration art={art} />
            </div>

            <div className="tp-stage__rows">
              {cat.items.map((item) => (
                <MenuCard
                  key={item.id}
                  item={item}
                  locale={locale}
                  art={art}
                  onOpen={onOpenItem}
                />
              ))}
            </div>
            <span className="tp-visually-hidden">
              {tr('cafe.hero.itemsCount', { count: cat.items.length })}
            </span>
          </section>
        );
      })}
    </>
  );
}

/**
 * Size step for a name the design has no art for (every Arabic name): the
 * same three buckets `SectionArt.len` uses, measured on the rendered word so a
 * long name steps down instead of colliding with the illustration.
 */
function lenFor(word: string): 'short' | 'medium' | 'long' {
  if (word.length <= 6) return 'short';
  if (word.length <= 10) return 'medium';
  return 'long';
}

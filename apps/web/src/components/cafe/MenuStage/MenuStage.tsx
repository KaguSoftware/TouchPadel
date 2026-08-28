'use client';

import { makeT, type Locale } from '@touch/i18n';
import type { MenuCategory, MenuItem } from '@/lib/menu';
import { MenuCard } from '../MenuCard/MenuCard';
import { sizeHeaders } from '../MenuCard/sizeColumns';
import { SectionIllustration, SectionRule, sectionArtFor } from './sectionArt';
import { TempChips } from '../TempChips';

/**
 * The menu itself: one section per category, drawn as the approved design does.
 *
 *   قهوة ~~~~~~ [بارد]
 *   ┌────────────────────────┐
 *   │ COFFEE            ☕  │
 *   └────────────────────────┘
 *              MEDIUM  LARGE
 *   لاتيه [حار][بارد]  3000  4000
 *
 * Sections are plain sections, not collapsibles: the design lists the whole
 * menu open, so there is no chevron and nothing to expand. They stay in the SSR
 * HTML (that is the point of the ISR read model), which keeps the scroll-spy
 * offsets and in-page search working.
 *
 * The size headers are derived from the category's own variants
 * (`sizeHeaders`), so a section priced at one size prints no header row at all
 * — exactly as the design does for شاي and حلويات.
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
        const name = ar ? cat.name_ar : cat.name_en;
        const art = sectionArtFor(cat.name_en);
        const columns = sizeHeaders(cat, locale);
        return (
          <section key={cat.id} id={sectionId(cat.id)} className="tp-menu-cat tp-stage">
            <div className="tp-stage__head">
              <h2>{name}</h2>
              <SectionRule width={art?.rule ?? 84} />
              <TempChips temp={cat.serve_temp} locale={locale} className="tp-stage__badge" />
            </div>

            <div className="tp-stage__band" data-tone={art?.tone ?? 'blue'}>
              <span className="tp-stage__word" data-len={art?.len ?? 'medium'} aria-hidden="true">
                {art?.word ?? cat.name_en.toUpperCase()}
              </span>
              <SectionIllustration art={art} />
            </div>

            {/* One named column still prints its header (Signature is LARGE-only);
                a section with no named size prints none (Tea, Desserts). */}
            {columns.length > 0 && (
              <div className="tp-stage__cols" aria-hidden="true">
                {columns.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
            )}

            <div className="tp-stage__rows">
              {cat.items.map((item) => (
                <MenuCard
                  key={item.id}
                  item={item}
                  locale={locale}
                  columns={columns}
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

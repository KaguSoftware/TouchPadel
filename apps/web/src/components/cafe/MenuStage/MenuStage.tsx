'use client';

import { useState } from 'react';
import Image from 'next/image';
import { makeT, type Locale } from '@touch/i18n';
import type { MenuCategory, MenuItem } from '@/lib/menu';
import { MenuCard } from '../MenuCard/MenuCard';

/**
 * The menu itself: one collapsible section per category, each headed by a
 * photo band, the ALL-CAPS category name, its item count and a chevron.
 *
 * Sections are rendered in the SSR HTML (that is the whole point of the ISR
 * read model) and collapse via `grid-template-rows` — the items stay in the
 * DOM, so the scroll-spy offsets and in-page search keep working.
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
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  return (
    <>
      {categories.map((cat) => {
        const open = !closed[cat.id];
        const name = ar ? cat.name_ar : cat.name_en;
        return (
          <section
            key={cat.id}
            id={sectionId(cat.id)}
            className="tp-menu-cat tp-stage"
            data-open={open ? 'true' : 'false'}
          >
            <button
              type="button"
              className="tp-stage__head"
              aria-expanded={open}
              onClick={() => setClosed((prev) => ({ ...prev, [cat.id]: open }))}
            >
              {cat.photo_url && (
                <span className="tp-stage__band">
                  <Image
                    src={cat.photo_url}
                    alt=""
                    fill
                    quality={40}
                    sizes="72px"
                    placeholder={cat.photo_blur ? 'blur' : undefined}
                    blurDataURL={cat.photo_blur ?? undefined}
                  />
                </span>
              )}
              <h2>{name}</h2>
              <span className="tp-stage__count">
                {tr('cafe.hero.itemsCount', { count: cat.items.length })}
              </span>
              <svg
                className="tp-stage__chevron"
                viewBox="0 0 24 24"
                width="20"
                height="20"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M6 9l6 6 6-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div className="tp-stage__body">
              <div>
                {cat.items.map((item) => (
                  <MenuCard key={item.id} item={item} locale={locale} onOpen={onOpenItem} />
                ))}
              </div>
            </div>
          </section>
        );
      })}
    </>
  );
}

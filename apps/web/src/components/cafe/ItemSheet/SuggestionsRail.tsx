'use client';

import Image from 'next/image';
import { formatIQD, type Locale } from '@touch/i18n';
import type { MenuItem } from '@/lib/menu';

/** "Goes well with" tiles — tapping one swaps the sheet to the suggested item. */
export function SuggestionsRail({
  locale,
  label,
  items,
  onOpen,
}: {
  locale: Locale;
  label: string;
  items: readonly MenuItem[];
  onOpen(item: MenuItem): void;
}) {
  if (items.length === 0) return null;
  const ar = locale === 'ar';
  return (
    <div className="tp-sheet__group">
      <h3>{label}</h3>
      <div className="tp-suggest" role="list">
        {items.map((s) => {
          const variant = s.variants.find((v) => v.is_default) ?? s.variants[0];
          return (
            <button
              key={s.id}
              type="button"
              role="listitem"
              className="tp-suggest__tile"
              onClick={() => onOpen(s)}
            >
              <span className="tp-suggest__photo">
                {s.photo_url && (
                  <Image
                    src={s.photo_url}
                    alt=""
                    fill
                    quality={40}
                    sizes="64px"
                    aria-hidden="true"
                  />
                )}
              </span>
              <span className="tp-suggest__name">{ar ? s.name_ar : s.name_en}</span>
              {variant && (
                <span className="tp-suggest__price">{formatIQD(variant.price_iqd, locale)}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

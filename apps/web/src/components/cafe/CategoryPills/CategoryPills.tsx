'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import type { Locale } from '@touch/i18n';
import { makeT } from '@touch/i18n';
import type { MenuCategory } from '@/lib/menu';

/**
 * Sticky category rail. Each pill carries a round category thumbnail that
 * COLLAPSES (inline-size → 0) once the hero is out of the way, so the rail
 * shrinks to a thin thumb bar as the guest reads the menu.
 *
 * `data-cat-rail` marks it for the scroll spy: the rail's own height IS the top
 * of the reading area, the line a category's hero band has to reach before the
 * rail hands it the active pill (useScrollSpy).
 *
 * The active pill is kept centred by scrolling THE RAIL by a physical delta —
 * never `pill.scrollIntoView()`, which also scrolls every ancestor and so
 * cancelled the vertical smooth scroll a pill tap had just started, leaving the
 * tap dead at the top of the page. `scrollBy` takes a signed pixel delta, so it
 * needs no RTL special case either.
 *
 * The trailing fade is a `mask-image` to `inline-end` (pills.css.ts), which
 * mirrors itself under `dir=rtl`.
 */
export function CategoryPills({
  locale,
  categories,
  activeId,
  compact,
  onSelect,
}: {
  locale: Locale;
  categories: MenuCategory[];
  activeId: string | null;
  compact: boolean;
  onSelect(category: MenuCategory): void;
}) {
  const tr = makeT(locale);
  const ar = locale === 'ar';
  const railRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const rail = railRef.current;
    if (!activeId || !rail) return;
    const pill = rail.querySelector<HTMLElement>(`[data-cat="${CSS.escape(activeId)}"]`);
    if (!pill) return;
    const railBox = rail.getBoundingClientRect();
    const pillBox = pill.getBoundingClientRect();
    const delta = pillBox.left + pillBox.width / 2 - (railBox.left + railBox.width / 2);
    if (Math.abs(delta) > 1) rail.scrollBy({ left: delta, behavior: 'smooth' });
  }, [activeId]);

  if (categories.length === 0) return null;

  return (
    <nav
      ref={railRef}
      className="tp-cattabs tp-cattabs--sticky"
      data-cat-rail=""
      data-compact={compact ? 'true' : 'false'}
      aria-label={tr('cafe.menu')}
    >
      {categories.map((cat) => (
        <button
          key={cat.id}
          type="button"
          data-cat={cat.id}
          aria-current={cat.id === activeId ? 'true' : undefined}
          onClick={() => onSelect(cat)}
        >
          {cat.photo_url && (
            <Image
              className="tp-cattabs__thumb"
              src={cat.photo_url}
              alt=""
              width={32}
              height={32}
              quality={40}
              sizes="32px"
            />
          )}
          {ar ? cat.name_ar : cat.name_en}
        </button>
      ))}
    </nav>
  );
}

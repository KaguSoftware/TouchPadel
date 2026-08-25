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
 * The active pill is kept centred via `scrollIntoView({ inline: 'center' })` —
 * logical inline centring works in both directions, so no RTL special case.
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
    if (!activeId || !railRef.current) return;
    const pill = railRef.current.querySelector<HTMLElement>(`[data-cat="${CSS.escape(activeId)}"]`);
    pill?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeId]);

  if (categories.length === 0) return null;

  return (
    <nav
      ref={railRef}
      className="tp-cattabs tp-cattabs--sticky"
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

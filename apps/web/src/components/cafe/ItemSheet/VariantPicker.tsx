'use client';

import { formatIQD, type Locale } from '@touch/i18n';
import type { MenuVariant } from '@/lib/menu';

/** Size / variant radios — rendered only when an item has more than one. */
export function VariantPicker({
  locale,
  label,
  variants,
  value,
  onChange,
}: {
  locale: Locale;
  label: string;
  variants: readonly MenuVariant[];
  value: string;
  onChange(variantId: string): void;
}) {
  if (variants.length < 2) return null;
  const ar = locale === 'ar';
  return (
    <div className="tp-sheet__group">
      <h3>{label}</h3>
      {variants.map((v) => (
        <label key={v.id} className="tp-opt">
          <input
            type="radio"
            name="tp-variant"
            checked={value === v.id}
            onChange={() => onChange(v.id)}
          />
          <span>{ar ? v.name_ar : v.name_en}</span>
          <span className="tp-opt__price">{formatIQD(v.price_iqd, locale)}</span>
        </label>
      ))}
    </div>
  );
}

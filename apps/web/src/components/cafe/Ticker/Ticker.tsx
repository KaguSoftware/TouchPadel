'use client';

import { useMemo } from 'react';
import { makeT, type Locale } from '@touch/i18n';
import type { CafeSettings } from '@/lib/menu';

/**
 * Bottom marquee strip (brand: brown band). Phrases come from
 * `cafe_settings_public.ticker_{locale}`; an unconfigured venue gets the three
 * i18n fallbacks so the strip is never an empty brown bar.
 *
 * The track is TRIPLED and travels exactly one third of its width, so the loop
 * is seamless; `--tp-dir-sign` (ticker.css.ts) reverses it under RTL without a
 * second keyframe set. Decorative: `aria-hidden` — every phrase is marketing
 * copy that also exists elsewhere on the page.
 */
export function Ticker({ locale, settings }: { locale: Locale; settings: CafeSettings }) {
  const phrases = useMemo(() => {
    const tr = makeT(locale);
    const configured = locale === 'ar' ? settings.ticker_ar : settings.ticker_en;
    const list = configured.filter((p) => p.trim() !== '');
    return list.length > 0
      ? list
      : [tr('cafe.ticker.fallback1'), tr('cafe.ticker.fallback2'), tr('cafe.ticker.fallback3')];
  }, [locale, settings.ticker_ar, settings.ticker_en]);

  return (
    <div className="tp-ticker" aria-hidden="true">
      <div className="tp-ticker__track">
        {[0, 1, 2].map((copy) =>
          phrases.map((phrase, i) => (
            <span className="tp-ticker__item" key={`${copy}-${i}`}>
              {phrase}
            </span>
          )),
        )}
      </div>
    </div>
  );
}

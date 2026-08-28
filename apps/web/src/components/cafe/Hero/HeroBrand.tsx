'use client';

import { makeT, type Locale } from '@touch/i18n';
import { HeroArt } from './HeroArt';

/**
 * Hero mode `none` — the design's masthead: the brand sweep filling a 320 px
 * white panel, with المنيو and the JUST ONE TOUCH strapline set in the open
 * half of the composition.
 *
 * The design states no opening hours here; today's window and the full week
 * live in the footer, so nothing is lost by keeping this panel to the two lines
 * the design draws.
 */
export function HeroBrand({ locale }: { locale: Locale }) {
  const tr = makeT(locale);
  return (
    <div className="tp-hero__brand">
      <HeroArt />
      <div className="tp-hero__headline-wrap">
        <h1 className="tp-hero__headline">{tr('cafe.hero.menuWord')}</h1>
        <p className="tp-hero__strapline">{tr('cafe.hero.strapline')}</p>
      </div>
    </div>
  );
}

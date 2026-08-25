'use client';

import { makeT, isolate, type Locale } from '@touch/i18n';
import { Swoosh } from '../brand/Swoosh';
import { BeanPattern } from '../brand/BeanPattern';
import type { TodayHours } from '@/lib/cafe/hours';

/**
 * Hero mode `none` — the brand panel (deck p08): solid Touch Blue, an ALL-CAPS
 * extra-bold two-line headline, a faint white outline-bean pattern, and the
 * white swoosh closing the panel into the page.
 *
 * The meta line is the only live data here: today's opening window and how
 * many items are on the menu, so the hero is never purely decorative.
 */
export function HeroBrand({
  locale,
  itemCount,
  hours,
}: {
  locale: Locale;
  itemCount: number;
  hours: TodayHours;
}) {
  const tr = makeT(locale);
  const window0 = hours.windows[0];
  return (
    <div className="tp-hero__brand">
      <BeanPattern tone="white" />
      <h1 className="tp-hero__headline">
        {tr('cafe.hero.line1')}
        <br />
        {tr('cafe.hero.line2')}
      </h1>
      <p className="tp-hero__meta">
        {hours.closed || !window0
          ? tr('cafe.hero.closedToday')
          : tr('cafe.hero.openToday', {
              from: isolate(window0[0]),
              to: isolate(window0[1]),
            })}
        {itemCount > 0 && <> · {tr('cafe.hero.itemsCount', { count: itemCount })}</>}
      </p>
      <Swoosh />
    </div>
  );
}

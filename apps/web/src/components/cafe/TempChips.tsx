import { makeT, type Locale } from '@touch/i18n';
import type { ServeTemp } from '@/lib/menu';

/**
 * The design's serve-temperature chips — a red "حار" and/or a blue "بارد".
 *
 * Used twice with the same data: beside an item name (`.tp-temp`) and, with
 * `className="tp-stage__badge"`, once on a section heading where the design
 * states the temperature for the whole category instead of on every row.
 */
export function TempChips({
  temp,
  locale,
  className,
}: {
  temp: ServeTemp;
  locale: Locale;
  className?: string;
}) {
  const tr = makeT(locale);
  if (temp === 'none') return null;
  const hot = temp === 'hot' || temp === 'both';
  const cold = temp === 'cold' || temp === 'both';
  // `className` only ADDS placement (the section badge sits on the heading
  // baseline); the colour always comes from the --hot / --cold modifier, so a
  // section badged "حار" is red on a heading exactly as it is on a row.
  const cls = (mod: string) => ['tp-temp', mod, className].filter(Boolean).join(' ');
  return (
    <>
      {hot && (
        <span className={cls('tp-temp--hot')} data-temp="hot">
          {tr('cafe.tempHot')}
        </span>
      )}
      {cold && (
        <span className={cls('tp-temp--cold')} data-temp="cold">
          {tr('cafe.tempCold')}
        </span>
      )}
    </>
  );
}

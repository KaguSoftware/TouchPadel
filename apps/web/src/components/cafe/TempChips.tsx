import { makeT, type Locale } from '@touch/i18n';
import type { ServeTemp } from '@/lib/menu';

/**
 * The design's serve-temperature chips — red rising wisps for "حار" and/or a
 * blue snowflake for "بارد".
 *
 * The temperature reads as an icon, so the translated word rides along in a
 * `.tp-visually-hidden` span: the chip stays announced to a screen reader
 * exactly as it was when the word was the whole chip.
 *
 * Rendered beside an item name. `className` is kept for a caller that needs to
 * place the chips differently; it only ADDS placement, never colour.
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
  // `className` only ADDS placement; the colour always comes from the
  // --hot / --cold modifier. --icon centres the mark in the pill, which the
  // word-bearing chips elsewhere do not want.
  const cls = (mod: string) => ['tp-temp', 'tp-temp--icon', mod, className].filter(Boolean).join(' ');
  return (
    <>
      {hot && (
        <span className={cls('tp-temp--hot')} data-temp="hot">
          <HotIcon />
          <span className="tp-visually-hidden">{tr('cafe.tempHot')}</span>
        </span>
      )}
      {cold && (
        <span className={cls('tp-temp--cold')} data-temp="cold">
          <ColdIcon />
          <span className="tp-visually-hidden">{tr('cafe.tempCold')}</span>
        </span>
      )}
    </>
  );
}

/**
 * Three rising wisps. Inherits the chip's colour via `currentColor`.
 *
 * The viewBox is cropped to the drawing instead of the nominal 24x24, because
 * the wisps only fill the middle ~11 units of it and read tiny beside the
 * snowflake, which fills its box. Cropping magnifies the stroke by the same
 * factor, so the nominal width is well under the 2 this was drawn at.
 */
function HotIcon() {
  return (
    <svg
      className="tp-temp__icon"
      viewBox="5.6 5.6 12.8 12.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 16.5c-1.4-2 1.4-2.8 0-4.8S6.6 9.5 8 7.5" />
      <path d="M12 16.5c-1.4-2 1.4-2.8 0-4.8S10.6 9.5 12 7.5" />
      <path d="M16 16.5c-1.4-2 1.4-2.8 0-4.8S14.6 9.5 16 7.5" />
    </svg>
  );
}

/** A six-spoke snowflake, one arm rotated about the centre. */
function ColdIcon() {
  const arm = 'M12 12V1.4M8.27 3.27 12 5.6l3.73-2.33';
  return (
    <svg
      className="tp-temp__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {[0, 60, 120, 180, 240, 300].map((deg) => (
        <path key={deg} d={arm} transform={deg ? `rotate(${deg} 12 12)` : undefined} />
      ))}
    </svg>
  );
}

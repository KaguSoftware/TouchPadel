import { formatWeekdayShort, isolateLtr, makeT, type Locale } from '@touch/i18n';

/**
 * The app's Book screen, redrawn in HTML for the app band (apps/mobile): the day strip
 * (`DayChip`, the first day selected), the merged time grid (`SlotCell` with its
 * capacity line) and the green "Reserve court". Same shapes, radii, weights and palette
 * as the app (the site tokens mirror its light and blue-mode palettes), in the page's
 * language.
 *
 * A picture of the app, not data, and it must not read as tonight's availability (copy
 * finding, 2026-09-24): the days are a fixed run of weekday names, never today's date or
 * the word "Today", and the slot states are an example. No prices and no court names
 * (neither is confirmed). The whole screen is `aria-hidden`; the band's heading and
 * sentence carry the meaning. Times are on the 24-hour clock every other time on the page
 * uses (the hours line reads 09:00–02:00), inside the venue's evening; "2 courts free" is
 * the app's own wording.
 */

/** 2026-01-01, a Thursday, at noon Baghdad time: the fixed first chip. */
const FIRST_DAY = Date.UTC(2026, 0, 1, 9, 0);

type SlotState = 'free' | 'last' | 'booked';

const SLOTS: readonly { hour: number; state: SlotState }[] = [
  { hour: 20, state: 'free' },
  { hour: 21, state: 'last' },
  { hour: 22, state: 'booked' },
  { hour: 23, state: 'free' },
];

/** `20:00`: the page's 24-hour form, LTR-isolated like every time on the site. */
export function slotTime(hour: number): string {
  return isolateLtr(`${String(hour).padStart(2, '0')}:00`);
}

export function BookScreen({ locale }: { locale: Locale }) {
  const tr = makeT(locale);
  const days = [0, 1, 2, 3, 4].map((offset) => ({
    offset,
    dow: formatWeekdayShort(new Date(FIRST_DAY + offset * 86_400_000), locale),
  }));
  const sub = (state: SlotState) =>
    state === 'booked'
      ? tr('site.app.vBooked')
      : state === 'last'
        ? tr('site.app.vOneCourtLeft')
        : tr('site.app.vTwoCourtsFree');
  return (
    <div className="tp-screen" aria-hidden="true">
      <div className="tp-v-days">
        {days.map((d) => (
          <span key={d.offset} className="tp-v-day" data-selected={d.offset === 0 ? '' : undefined}>
            <span className="tp-v-day__dow">{d.dow}</span>
          </span>
        ))}
      </div>
      <div className="tp-v-grid">
        {SLOTS.map((slot) => (
          <span key={slot.hour} className="tp-v-slot" data-state={slot.state}>
            <span className="tp-v-slot__time tp-num">{slotTime(slot.hour)}</span>
            <span className="tp-v-slot__sub">{sub(slot.state)}</span>
          </span>
        ))}
      </div>
      <span className="tp-v-cta">{tr('site.app.vReserve')}</span>
    </div>
  );
}

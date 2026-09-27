import { makeT, type Locale } from '@touch/i18n';
import type { VenueOpeningHours } from '@/lib/menu';
import { DAY_LABEL, weekHours } from '@/lib/cafe/hours';
import { everyDayHours, formatWindows } from '@/lib/site/hours';

/**
 * The venue's published hours, live from venue_settings_public: ONE line ("Every day
 * 09:00–02:00") when the venue keeps one window every day, the week as a list when the
 * days differ, and null when the read failed or nothing is published (the caller then
 * drops its title too). Shared by the site footer and the Visit section. Every window
 * goes through lib/site/hours.ts, so it reads in the same order as everywhere else.
 */
export function hasPublishedHours(venue: VenueOpeningHours | null | undefined): boolean {
  if (!venue) return false;
  return (
    everyDayHours(venue) !== null || weekHours(venue).some(({ windows }) => windows.length > 0)
  );
}

export function HoursList({
  locale,
  venue,
  className,
}: {
  locale: Locale;
  venue: VenueOpeningHours | null;
  className?: string;
}) {
  if (!venue || !hasPublishedHours(venue)) return null;
  const tr = makeT(locale);
  const every = everyDayHours(venue);
  if (every) {
    return (
      <p className={['tp-hours-list', className].filter(Boolean).join(' ')}>
        <span>{tr('site.hours.everyDay')}</span>{' '}
        <span className="tp-num tp-hours-list__window">{every}</span>
      </p>
    );
  }
  return (
    <dl className={['tp-hours-list tp-hours-list--week', className].filter(Boolean).join(' ')}>
      {weekHours(venue).map(({ dayKey, windows }) => (
        <div key={dayKey}>
          <dt>{tr(DAY_LABEL[dayKey])}</dt>
          <dd className="tp-num">
            {windows.length === 0
              ? tr('cafe.footer.closed')
              : formatWindows(windows, locale)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

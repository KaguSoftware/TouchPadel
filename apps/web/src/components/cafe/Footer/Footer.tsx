'use client';

import { useEffect, useRef } from 'react';
import { makeT, isolate, type Locale, type MessageKey } from '@touch/i18n';
import type { VenueOpeningHours } from '@/lib/menu';
import { todayHours, weekHours, type DayKey } from '@/lib/cafe/hours';
import { BeanPattern } from '../brand/BeanPattern';

const DAY_LABEL: Record<DayKey, MessageKey> = {
  mon: 'cafe.days.mon',
  tue: 'cafe.days.tue',
  wed: 'cafe.days.wed',
  thu: 'cafe.days.thu',
  fri: 'cafe.days.fri',
  sat: 'cafe.days.sat',
  sun: 'cafe.days.sun',
};

/**
 * Coffee-brown footer: the week's opening hours (today in bold), the venue
 * phone as a real `tel:` link, the pay-at-desk reminder and the Kagu credit.
 *
 * The phone is `dir="ltr"` + isolated: an Iraqi number inside an Arabic
 * sentence otherwise renders with its `+` at the wrong end.
 *
 * An IntersectionObserver reports visibility upward so the FABs can get out of
 * the way when the guest reaches the bottom.
 */
export function Footer({
  locale,
  venue,
  onVisibilityChange,
}: {
  locale: Locale;
  venue: VenueOpeningHours | null;
  onVisibilityChange(visible: boolean): void;
}) {
  const tr = makeT(locale);
  const ref = useRef<HTMLElement | null>(null);
  const notify = useRef(onVisibilityChange);
  notify.current = onVisibilityChange;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => notify.current(entry?.isIntersecting ?? false),
      { threshold: 0.01 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      notify.current(false);
    };
  }, []);

  const today = todayHours(venue);
  const phone = venue?.phone?.trim() ?? '';

  return (
    <footer className="tp-footer" ref={ref}>
      <BeanPattern tone="white" opacity={0.05} />
      <div className="tp-footer__inner">
        <section>
          <h2 className="tp-footer__title">{tr('cafe.footer.hours')}</h2>
          <dl className="tp-hours">
            {weekHours(venue).map(({ dayKey, windows }) => (
              <div key={dayKey} style={{ display: 'contents' }}>
                <dt data-today={dayKey === today.dayKey ? 'true' : undefined}>
                  {tr(DAY_LABEL[dayKey])}
                </dt>
                <dd data-today={dayKey === today.dayKey ? 'true' : undefined}>
                  {windows.length === 0
                    ? tr('cafe.footer.closed')
                    : windows
                        .map(([from, to]) => `${isolate(from)}–${isolate(to)}`)
                        .join(locale === 'ar' ? '، ' : ', ')}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {phone && (
          <section>
            <h2 className="tp-footer__title">{tr('cafe.footer.phone')}</h2>
            <a className="tp-footer__phone" href={`tel:${phone.replace(/\s+/g, '')}`} dir="ltr">
              {phone}
            </a>
          </section>
        )}

        <p>{tr('cafe.payAtDesk')}</p>
        <p className="tp-footer__credit">{tr('cafe.footer.developedBy')}</p>
      </div>
    </footer>
  );
}

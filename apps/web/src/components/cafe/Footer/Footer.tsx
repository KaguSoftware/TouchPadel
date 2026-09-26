'use client';

import { useEffect, useRef } from 'react';
import { makeT, type Locale } from '@touch/i18n';
import type { VenueOpeningHours } from '@/lib/menu';
import { DAY_LABEL, todayHours, weekHours } from '@/lib/cafe/hours';
import { displayPhone, telUrl } from '@/lib/site/contact';
import { formatWindows } from '@/lib/site/hours';

/**
 * The design's footer: a blue field with a shallow arched top that caps the
 * white column, carrying the JUST ONE TOUCH strapline, the venue line and a
 * green rule.
 *
 * The week's opening hours, the phone and the pay-at-desk notice sit under that
 * masthead - the design does not draw them, but they are the only place on the
 * page a guest can find them, so they keep their home here in the design's
 * type and colour.
 *
 * The phone is `dir="ltr"`: an Iraqi number inside an Arabic sentence otherwise
 * renders with its `+` at the wrong end. It is printed and dialled the way the
 * site footer and the legal pages print and dial it (lib/site/contact.ts:
 * `+964 770 123 4567`, `tel:+9647701234567`), and the hours read in the same
 * order as theirs (lib/site/hours.ts), so a number or a window never appears two
 * ways on the public pages. A number that cannot be dialled is not printed.
 *
 * The last row (2026-09-23) is a quiet way off the menu: Touch Padel's home
 * page, Support, Privacy and Terms, in the site footer's words (`site.footer.*`).
 * Plain `<a>`, not `next/link`: these pages are full documents in another
 * shell, and nothing here should prefetch. The "Developed by Kagu" credit moved
 * to the site footer with the landing page; the menu no longer carries it.
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
  const phone = displayPhone(venue?.phone);
  const tel = telUrl(venue?.phone);
  const venueName = venue?.venue_name?.trim() ?? '';

  return (
    <footer className="tp-footer" ref={ref}>
      <div className="tp-footer__inner">
        <div>
          <div className="tp-footer__strapline" lang="en" dir="ltr">
            {tr('cafe.hero.strapline')}
          </div>
          {venueName && <div className="tp-footer__venue">{venueName}</div>}
          <svg
            className="tp-footer__rule"
            viewBox="0 0 100 12"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M2 10 Q 50 -6 98 8"
              stroke="var(--tp-cafe-green-light)"
              strokeWidth="5"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <section>
          <h2 className="tp-footer__title">{tr('cafe.footer.hours')}</h2>
          <dl className="tp-hours">
            {weekHours(venue).map(({ dayKey, windows }) => (
              <div key={dayKey} style={{ display: 'contents' }}>
                <dt data-today={dayKey === today.dayKey ? 'true' : undefined}>
                  {tr(DAY_LABEL[dayKey])}
                </dt>
                <dd data-today={dayKey === today.dayKey ? 'true' : undefined}>
                  {windows.length === 0 ? tr('cafe.footer.closed') : formatWindows(windows, locale)}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {phone && tel && (
          <section>
            <h2 className="tp-footer__title">{tr('cafe.footer.phone')}</h2>
            <a className="tp-footer__phone" href={tel} dir="ltr">
              {phone}
            </a>
          </section>
        )}

        <p>{tr('cafe.payAtDesk')}</p>

        <nav className="tp-footer__links" aria-label={tr('site.footer.exploreTitle')}>
          <a href={`/${locale}`}>{tr('site.footer.exploreTitle')}</a>
          <a href={`/${locale}/support`}>{tr('site.footer.support')}</a>
          <a href={`/${locale}/privacy`}>{tr('site.footer.privacy')}</a>
          <a href={`/${locale}/terms`}>{tr('site.footer.terms')}</a>
        </nav>
      </div>
    </footer>
  );
}

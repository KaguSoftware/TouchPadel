import type { CSSProperties } from 'react';
import { makeT, type Locale } from '@touch/i18n';
import { CallButton, WhatsAppButton } from '@/components/site/ContactButton';
import { OpenNowPill } from '@/components/site/OpenNowPill';
import type { OpeningHoursBlob } from '@/lib/site/openNow';
import { Photo } from './Photo';

/** The load stagger: each line rises `--tp-i` × `--tp-site-stagger` after the first. */
const stagger = (i: number) => ({ '--tp-i': i }) as CSSProperties;

/**
 * The first screen: the club at night. A full-bleed padel photo in the grade's `night`
 * exposure (never brighter than Touch Blue, the ball kept green), and on it, start-aligned:
 * "● Open now", "TOUCH IS / A LIFESTYLE", where the club is and when it is open (live
 * hours), and the two ways to get a court: Book on WhatsApp (green, the pre-filled court
 * message) and Call the desk. With no usable venue phone the green button becomes "Plan
 * your visit" and the call button is not drawn.
 *
 * On a landscape screen the words stand at the top (the deck's top-leading headline) and
 * the photo's lower half is left to the play: the ball on the turf and, under it, the
 * deck's thin green line, set like the ball's path. On a portrait screen the words sit at
 * the foot and the crop gives the top half to the player.
 */
export function Hero({
  locale,
  hours,
  openingHours,
  closedDates,
  phone,
}: {
  locale: Locale;
  /** The every-day window, formatted and isolated (lib/site/hours.ts), or null when the
   *  venue read failed or the days differ. */
  hours: string | null;
  openingHours: OpeningHoursBlob;
  closedDates: readonly string[];
  phone: string | null;
}) {
  const tr = makeT(locale);
  return (
    <section className="tp-front tp-on-dark" aria-labelledby="hero-title">
      <Photo
        name="hero"
        alt={tr('site.photos.heroAlt')}
        sizes="100vw"
        preload
        grade="night"
        className="tp-front__photo"
      />
      <svg
        className="tp-front__line"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M-1 100 L101 4" />
      </svg>
      <div className="tp-front__inner">
        <div className="tp-front__copy tp-fit">
          {hours ? (
            <OpenNowPill
              className="tp-front__open tp-rise"
              hours={hours}
              openingHours={openingHours}
              closedDates={closedDates}
              labels={{
                openNow: tr('site.hours.openNow'),
                closedNow: tr('site.hours.closedNow'),
                everyDay: tr('site.hours.everyDay'),
                opensAt: tr('site.hours.opensAt'),
              }}
            />
          ) : null}
          <h1 id="hero-title" className="tp-display tp-front__title">
            <span className="tp-display__l1 tp-rise" style={stagger(1)}>
              {tr('site.hero.lineOne')}
            </span>{' '}
            <span className="tp-display__l2 tp-rise" style={stagger(2)}>
              {tr('site.hero.lineTwo')}
            </span>
          </h1>
          <p className="tp-front__lead tp-rise" style={stagger(3)}>
            {hours ? tr('site.hero.lead', { hours }) : tr('site.hero.leadNoHours')}
          </p>
          <div className="tp-front__ctas tp-rise" style={stagger(4)}>
            <WhatsAppButton
              locale={locale}
              phone={phone}
              message={tr('site.whatsapp.court')}
              label={tr('site.hero.ctaWhatsApp')}
              onHome
              className="tp-site-btn tp-site-btn--go tp-site-btn--lg"
            />
            <CallButton
              phone={phone}
              label={tr('site.hero.ctaCall')}
              className="tp-site-btn tp-site-btn--ghost tp-site-btn--lg"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

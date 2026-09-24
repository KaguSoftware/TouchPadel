import { makeT, type Locale } from '@touch/i18n';
import { CourtStage } from '@/features/court3d';
import { BrandBall } from '@/components/site/brand/BrandLockup';
import { CourtPattern } from '@/components/site/brand/CourtPattern';
import { WhatsAppButton } from '@/components/site/ContactButton';
import { Photo } from './Photo';

/**
 * `#club`, "PURE GAME, / PERFECT TOUCH." (the deck's roll-ups, full-brand2.pdf p18): what
 * playing here is. The words and the club's four confirmed facts (indoor, the live hours,
 * rackets and balls to rent, lockers) on one side, each marked with the brand's own ball;
 * on the other, the app's live court, rallying on a full-bleed Touch Blue field with the
 * court-line bands, standing for the two courts, and "Book a court" riding its net the way
 * "Check availability" does in the app (WhatsApp, pre-filled). A photo of a court under
 * the facts says the rest.
 */
export function Club({
  locale,
  hours,
  phone,
}: {
  locale: Locale;
  /** The every-day window, formatted and isolated (lib/site/hours.ts), or null. */
  hours: string | null;
  phone: string | null;
}) {
  const tr = makeT(locale);
  const points = [
    tr('site.club.pointIndoor'),
    hours ? tr('site.club.pointHours', { hours }) : tr('site.club.pointHoursNoHours'),
    tr('site.club.pointRent'),
    tr('site.club.pointLockers'),
  ];
  return (
    <section id="club" className="tp-club" aria-labelledby="club-title">
      <div className="tp-club__inner">
        <div className="tp-club__copy">
          <div className="tp-club__head tp-fit" data-reveal="">
            <h2 id="club-title" className="tp-display tp-display--section">
              <span className="tp-display__l1">{tr('site.club.titleOne')}</span>{' '}
              <span className="tp-display__l2">{tr('site.club.titleTwo')}</span>
            </h2>
          </div>
          <p className="tp-club__body" data-reveal="">
            {tr('site.club.body')}
          </p>
          <ul className="tp-points" data-reveal="">
            {points.map((point) => (
              <li key={point} className="tp-point">
                <BrandBall className="tp-point__ball" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
        {/* The stage stands on Touch Blue in both modes (`tp-on-blue`), so the focus
            ring of the button on the net turns white instead of vanishing into it. */}
        <div className="tp-club__stage tp-on-blue">
          {/* The court's own field: a full-bleed Touch Blue block with the court-line
              bands, bleeding off the page's inline end (and across it on phones). */}
          <div className="tp-club__field" aria-hidden="true">
            <CourtPattern weight="texture" />
          </div>
          <div className="tp-club__court-box">
            <CourtStage
              label={tr('site.club.courtLabel')}
              pauseLabel={tr('site.club.courtPause')}
              scrollLinked
              className="tp-club__court"
            >
              <WhatsAppButton
                locale={locale}
                phone={phone}
                message={tr('site.whatsapp.court')}
                label={tr('site.club.courtCta')}
                cue={tr('site.onWhatsApp')}
                onHome
                className="tp-site-btn tp-site-btn--go tp-site-btn--xl tp-club__cta"
              />
            </CourtStage>
          </div>
        </div>
        <Photo
          name="club"
          alt={tr('site.photos.clubAlt')}
          sizes="(min-width: 60rem) 45vw, 100vw"
          className="tp-club__photo"
        />
      </div>
    </section>
  );
}

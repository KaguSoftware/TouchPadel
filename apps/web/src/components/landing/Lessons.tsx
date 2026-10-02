import { makeT, type Locale } from '@touch/i18n';
import { WhatsAppButton } from '@/components/site/ContactButton';
import { CoachPhoto } from '@/components/coaching/CoachPhoto';
import { coachName, type CoachingRead } from '@/lib/coaching';
import { coachLinkPath } from '@/lib/site/coachLink';
import { Photo } from './Photo';

/** How many coaches the strip shows (guest.md §4.14.4): a glance, not the list. */
const STRIP_SIZE = 4;

/**
 * `#lessons`: "YOUR FIRST TOUCH? / START HERE." On a wide screen the photo runs to the edge of
 * the screen on the reading-start side and the words sit beside it; narrower, the whole frame
 * sits under the words (the club section above ends on a photo), so the player's face and the
 * ball both stay in it.
 *
 * Until coaching is live with a public coach (`coaching.status !== 'ok'`) the section is exactly
 * what it was: the club runs lessons and hands over to the desk, "Ask about lessons" opening
 * WhatsApp with the lesson message pre-filled. Once it is (docs/design/coaching/guest.md
 * §4.14.4), the words say lessons are booked in the app, a strip shows up to four coaches (each
 * its `/{locale}/c/<id>` link), and "Meet the coaches" leads on to `/{locale}/coaching` beside
 * the WhatsApp button, which stays. No price here, ever.
 */
export function Lessons({
  locale,
  phone,
  coaching,
}: {
  locale: Locale;
  phone: string | null;
  coaching: CoachingRead;
}) {
  const tr = makeT(locale);
  const coaches =
    coaching.status === 'ok' ? (coaching.coaching?.coaches ?? []).slice(0, STRIP_SIZE) : [];
  const live = coaches.length > 0;
  const ask = (
    <WhatsAppButton
      locale={locale}
      phone={phone}
      message={tr('site.whatsapp.lesson')}
      label={tr('site.lessons.cta')}
      cue={tr('site.onWhatsApp')}
      onHome
      className="tp-site-btn tp-site-btn--go tp-site-btn--lg"
    />
  );
  return (
    <section id="lessons" className="tp-lessons" aria-labelledby="lessons-title">
      <Photo
        name="lessons"
        alt={tr('site.photos.lessonsAlt')}
        sizes="(min-width: 60rem) 50vw, 100vw"
        className="tp-lessons__photo"
      />
      <div className="tp-lessons__copy">
        <div className="tp-lessons__head tp-fit" data-reveal="">
          <h2 id="lessons-title" className="tp-display tp-display--section">
            <span className="tp-display__l1">{tr('site.lessons.titleOne')}</span>{' '}
            <span className="tp-display__l2">{tr('site.lessons.titleTwo')}</span>
          </h2>
        </div>
        <div className="tp-lessons__act" data-reveal="">
          <p className="tp-lessons__body">
            {live ? tr('coaching.web.landing.body') : tr('site.lessons.body')}
          </p>
          {live ? (
            <>
              <div className="tp-lessons__coaches">
                <p className="tp-lessons__coaches-label" id="lessons-coaches">
                  {tr('coaching.web.landing.coachesLabel')}
                </p>
                <ul className="tp-coach-face-list" aria-labelledby="lessons-coaches">
                  {coaches.map((coach) => (
                    <li key={coach.id}>
                      <a className="tp-coach-face" href={coachLinkPath(locale, coach.id)}>
                        <CoachPhoto
                          coach={coach}
                          locale={locale}
                          className="tp-coach-face__photo"
                          sizes="44px"
                        />
                        <span className="tp-coach-face__name">{coachName(coach, locale)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="tp-lessons__ctas">
                <a
                  className="tp-site-btn tp-site-btn--primary tp-site-btn--lg"
                  href={`/${locale}/coaching`}
                >
                  {tr('coaching.web.landing.cta')}
                </a>
                {ask}
              </div>
            </>
          ) : (
            ask
          )}
        </div>
      </div>
    </section>
  );
}

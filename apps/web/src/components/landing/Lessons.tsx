import { makeT, type Locale } from '@touch/i18n';
import { WhatsAppButton } from '@/components/site/ContactButton';
import { Photo } from './Photo';

/**
 * `#lessons`: "NEW TO PADEL? / START HERE." The club offers lessons today and promises
 * nothing more specific (no levels, formats or coach names are confirmed), so the page
 * says exactly that and hands over to the desk: "Ask about lessons" opens WhatsApp with
 * the lesson message pre-filled. On a wide screen the photo runs to the edge of the
 * screen on the reading-start side and the words sit beside it; narrower, the whole frame
 * sits under the words (the club section above ends on a photo), so the player's face and
 * the ball both stay in it.
 */
export function Lessons({ locale, phone }: { locale: Locale; phone: string | null }) {
  const tr = makeT(locale);
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
          <p className="tp-lessons__body">{tr('site.lessons.body')}</p>
          <WhatsAppButton
            locale={locale}
            phone={phone}
            message={tr('site.whatsapp.lesson')}
            label={tr('site.lessons.cta')}
            cue={tr('site.onWhatsApp')}
            onHome
            className="tp-site-btn tp-site-btn--go tp-site-btn--lg"
          />
        </div>
      </div>
    </section>
  );
}

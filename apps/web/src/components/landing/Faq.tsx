import { makeT, type Locale } from '@touch/i18n';
import { WhatsAppButton } from '@/components/site/ContactButton';
import { CourtPattern } from '@/components/site/brand/CourtPattern';
import { TitleSquiggle } from '@/components/site/brand/TitleSquiggle';
import { PlusIcon } from '@/components/site/icons';

/**
 * The ask card's window onto the court-line pattern, in panel units: four bands, each
 * crossing the card edge to edge. It lies inside PATTERN_OPEN_CROP's x range and above
 * y 206, so no band starts or stops in the open black, and the start-top corner, where
 * the title sits, is left almost clear. Line weight as on the events poster.
 */
const ASK_CROP = [100, 0, 124, 200] as const;

/**
 * `#faq`, "Your first visit": the seven questions a first-timer asks the desk, each a
 * numbered card on the page ground that turns Touch Blue when opened. Each card is a
 * native `<details>`: a real button to keyboards and screen readers (Enter or Space
 * toggles it, the expanded state is announced), no script, and the answer is in the
 * page for search engines and find-in-page. Only confirmed facts: WhatsApp / call / walk
 * in, pay at the desk, rackets and balls to rent, lockers, lessons, cancelling through the
 * desk, and the live hours ("past midnight" only when the live window says so).
 * They share one `name`, so the browser keeps at most one open: opening another closes
 * the last (an exclusive accordion, still no script).
 *
 * After the questions, a poster-black "still wondering?" card, court lines behind it,
 * hands over to the desk on WhatsApp (or "Plan your visit" when there is no usable phone,
 * like every contact button). It comes last in the source, so a phone and the tab order
 * both read it after the questions; on a wide screen the grid sets it under the title.
 */
export function Faq({
  locale,
  hours,
  late = false,
  phone,
}: {
  locale: Locale;
  /** The every-day window, formatted and isolated (lib/site/hours.ts), or null. */
  hours: string | null;
  /** The live window closes after midnight. */
  late?: boolean;
  phone: string | null;
}) {
  const tr = makeT(locale);
  const items = [
    { key: 'book', q: tr('site.faq.bookQ'), a: tr('site.faq.bookA') },
    { key: 'pay', q: tr('site.faq.payQ'), a: tr('site.faq.payA') },
    { key: 'racket', q: tr('site.faq.racketQ'), a: tr('site.faq.racketA') },
    { key: 'lockers', q: tr('site.faq.lockersQ'), a: tr('site.faq.lockersA') },
    { key: 'beginner', q: tr('site.faq.beginnerQ'), a: tr('site.faq.beginnerA') },
    { key: 'cancel', q: tr('site.faq.cancelQ'), a: tr('site.faq.cancelA') },
    {
      key: 'hours',
      q: tr('site.faq.hoursQ'),
      a: hours
        ? tr(late ? 'site.faq.hoursALate' : 'site.faq.hoursA', { hours })
        : tr('site.faq.hoursANoHours'),
    },
  ];
  return (
    <section id="faq" className="tp-faq" aria-labelledby="faq-title">
      <div className="tp-faq__inner">
        <div className="tp-faq__head" data-reveal="">
          <h2 id="faq-title" className="tp-faq__title">
            {tr('site.faq.title')}
          </h2>
          <TitleSquiggle className="tp-faq__squiggle" />
          <p className="tp-faq__lead">{tr('site.faq.lead')}</p>
        </div>
        <div className="tp-faq__list" data-reveal="">
          {items.map((item, i) => (
            <details key={item.key} name="tp-faq" className="tp-faq__item">
              <summary className="tp-faq__q">
                <span className="tp-faq__n tp-num" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="tp-faq__qtext">{item.q}</span>
                <span className="tp-faq__mark">
                  <PlusIcon />
                </span>
              </summary>
              <p className="tp-faq__a">{item.a}</p>
            </details>
          ))}
        </div>
        <div className="tp-faq__ask tp-on-dark" data-reveal="">
          <CourtPattern band={3} crop={ASK_CROP} className="tp-faq__pattern" />
          <p className="tp-faq__ask-title">{tr('site.faq.askTitle')}</p>
          <WhatsAppButton
            locale={locale}
            phone={phone}
            message={tr('site.whatsapp.general')}
            label={tr('site.faq.askCta')}
            cue={tr('site.onWhatsApp')}
            onHome
            className="tp-site-btn tp-site-btn--go tp-faq__ask-btn"
          />
        </div>
      </div>
    </section>
  );
}

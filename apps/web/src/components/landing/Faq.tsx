import { makeT, type Locale } from '@touch/i18n';
import { TitleSquiggle } from '@/components/site/brand/TitleSquiggle';
import { PlusIcon } from '@/components/site/icons';

/**
 * `#faq`, "Your first visit": the seven questions a first-timer asks the desk, each a
 * native `<details>`: a real button to keyboards and screen readers (Enter or Space
 * toggles it, the expanded state is announced), no script, and the answer is in the
 * page for search engines and find-in-page. Only confirmed facts: WhatsApp / call / walk
 * in, pay at the desk, rackets and balls to rent, lockers, lessons, cancelling through the
 * desk, and the live hours ("past midnight" only when the live window says so).
 */
export function Faq({
  locale,
  hours,
  late = false,
}: {
  locale: Locale;
  /** The every-day window, formatted and isolated (lib/site/hours.ts), or null. */
  hours: string | null;
  /** The live window closes after midnight. */
  late?: boolean;
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
        </div>
        <div className="tp-faq__list" data-reveal="">
          {items.map((item) => (
            <details key={item.key} className="tp-faq__item">
              <summary className="tp-faq__q">
                <span>{item.q}</span>
                <PlusIcon className="tp-faq__mark" />
              </summary>
              <p className="tp-faq__a">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

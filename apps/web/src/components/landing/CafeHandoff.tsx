import { formatIQD, formatNumber, makeT, type Locale, type MessageKey } from '@touch/i18n';
import { QrIllustration } from '@/components/cafe/QrRequiredSheet/QrIllustration';
import { CafeMark } from '@/components/site/brand/CafeMark';
import { ArrowIcon } from '@/components/site/icons';
import type { CafePhoneMenu } from '@/lib/site/landing';

const STEPS: readonly { title: MessageKey; body: MessageKey }[] = [
  { title: 'site.cafe.step1Title', body: 'site.cafe.step1Body' },
  { title: 'site.cafe.step2Title', body: 'site.cafe.step2Body' },
  { title: 'site.cafe.step3Title', body: 'site.cafe.step3Body' },
];

/**
 * Touch Cafe, part of the club: "BEFORE THE GAME. / AFTER IT.", and how ordering works,
 * as three drawn steps with no photograph: take a table (a table from above, a cup and
 * the table's code), scan the code (a phone framing it), order from your phone (a phone
 * showing a real menu section with its list prices, `cafePhoneMenu`; the café's mark
 * when the menu read failed). The drawings are pictures of the words beside them, so
 * they are hidden from screen readers; the steps are an ordered list.
 *
 * The menu is a separate app at /menu that reads the table cookie, so the way in is a
 * plain `<a>`: a prefetch would render a table guest's session for nothing.
 */
export function CafeHandoff({ locale, phone }: { locale: Locale; phone: CafePhoneMenu | null }) {
  const tr = makeT(locale);
  const basket = phone ? phone.rows.slice(0, 2).reduce((sum, r) => sum + r.priceIqd, 0) : 0;
  const art = [
    <div key="table" className="tp-cafe-table">
      <span className="tp-cafe-table__no">{tr('site.cafe.artTable')}</span>
      <span className="tp-cafe-table__cup" />
      <span className="tp-cafe-table__tent">
        <QrIllustration className="tp-cafe-qr" />
      </span>
    </div>,
    <div key="scan" className="tp-cafe-phone">
      <div className="tp-cafe-phone__screen tp-cafe-phone__screen--scan">
        <span className="tp-cafe-scan">
          <QrIllustration className="tp-cafe-qr" />
          <span className="tp-cafe-scan__line" />
        </span>
        <span className="tp-cafe-phone__cap">{tr('site.cafe.artScan')}</span>
      </div>
    </div>,
    <div key="order" className="tp-cafe-phone">
      {phone ? (
        <div className="tp-cafe-phone__screen tp-cafe-phone__screen--menu">
          <span className="tp-cafe-phone__bar">
            <span>{tr('site.cafe.artTable')}</span>
            <span>{phone.section}</span>
          </span>
          {phone.rows.map((row) => (
            <span key={row.id} className="tp-cafe-phone__row">
              <span>
                <b>{row.name}</b>
                <span className="tp-num">{formatIQD(row.priceIqd, locale)}</span>
              </span>
              <i>+</i>
            </span>
          ))}
          <span className="tp-cafe-phone__basket">
            <span>{tr('site.cafe.artBasket')}</span>
            <span className="tp-num">{formatIQD(basket, locale)}</span>
          </span>
        </div>
      ) : (
        <div className="tp-cafe-phone__screen">
          <CafeMark className="tp-cafe-phone__mark" />
        </div>
      )}
    </div>,
  ];

  return (
    <section className="tp-cafe-handoff" aria-labelledby="cafe-title">
      <div className="tp-cafe-handoff__inner">
        <div className="tp-cafe-handoff__top" data-reveal="">
          <div className="tp-cafe-handoff__head tp-fit">
            <h2 id="cafe-title" className="tp-display tp-display--section">
              <span className="tp-display__l1">{tr('site.cafe.titleOne')}</span>{' '}
              <span className="tp-display__l2">{tr('site.cafe.titleTwo')}</span>
            </h2>
          </div>
          <div className="tp-cafe-handoff__lead">
            <p className="tp-cafe-handoff__body">{tr('site.cafe.body')}</p>
            <a
              className="tp-site-btn tp-site-btn--primary tp-site-btn--lg"
              href={`/${locale}/menu`}
            >
              {tr('site.cafe.cta')}
              <ArrowIcon />
            </a>
          </div>
        </div>
        <ol className="tp-cafe-steps" aria-label={tr('site.cafe.stepsLabel')}>
          {STEPS.map((step, i) => (
            <li key={step.title} className="tp-cafe-step" data-reveal="">
              <div className="tp-cafe-step__art" aria-hidden="true">
                {art[i]}
              </div>
              <div className="tp-cafe-step__words">
                <span className="tp-cafe-step__no tp-num" aria-hidden="true">
                  {formatNumber(i + 1, locale)}
                </span>
                <div>
                  <h3 className="tp-cafe-step__title">{tr(step.title)}</h3>
                  <p className="tp-cafe-step__body">{tr(step.body)}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

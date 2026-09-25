import { makeT, type Locale } from '@touch/i18n';
import { CafeMark } from '@/components/site/brand/CafeMark';
import { ArrowIcon } from '@/components/site/icons';
import type { CafeCategories } from '@/lib/site/landing';
import { Photo } from './Photo';

/**
 * Touch Cafe, part of the club: "BEFORE THE GAME. / AFTER IT.", the live café category
 * names from the menu (the category-free line when the menu read failed or is empty),
 * and the way in. The photo stands on the reading-start side (the page's photographs
 * alternate sides as it scrolls, styles/site/stories.css.ts), with the café's mark (blue
 * and green, no brown) set flat on its corner nearest the words: no tilt, no shadow
 * (logo rules, style reference §2.4).
 *
 * The menu is a separate app at /menu that reads the table cookie, so this is a plain
 * `<a>`: a prefetch would render a table guest's session for nothing.
 */
export function CafeHandoff({
  locale,
  categories,
}: {
  locale: Locale;
  categories: CafeCategories | null;
}) {
  const tr = makeT(locale);
  return (
    <section className="tp-cafe-handoff" aria-labelledby="cafe-title">
      <div className="tp-cafe-handoff__inner">
        <div className="tp-cafe-handoff__copy" data-reveal="">
          <div className="tp-cafe-handoff__head tp-fit">
            <h2 id="cafe-title" className="tp-display tp-display--section">
              <span className="tp-display__l1">{tr('site.cafe.titleOne')}</span>{' '}
              <span className="tp-display__l2">{tr('site.cafe.titleTwo')}</span>
            </h2>
          </div>
          <p className="tp-cafe-handoff__body">
            {categories
              ? tr(categories.more ? 'site.cafe.bodyMore' : 'site.cafe.body', {
                  categories: categories.list,
                })
              : tr('site.cafe.bodyNoCategories')}
          </p>
          <a className="tp-site-btn tp-site-btn--primary tp-site-btn--lg" href={`/${locale}/menu`}>
            {tr('site.cafe.cta')}
            <ArrowIcon />
          </a>
        </div>
        <div className="tp-cafe-handoff__art" data-reveal="">
          <Photo
            name="cafe"
            alt={tr('site.photos.cafeAlt')}
            sizes="(min-width: 60rem) 48vw, 100vw"
            className="tp-cafe-handoff__photo"
          />
          <CafeMark title={tr('common.cafeName')} className="tp-cafe-handoff__mark" />
        </div>
      </div>
    </section>
  );
}

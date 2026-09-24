import { makeT, type Locale } from '@touch/i18n';
import { StoreButtons } from '@/components/site/StoreButtons';
import type { StoreLinks } from '@/lib/site/stores';
import { BookScreen } from './BookScreen';

/**
 * The app, in one compact band and no more (owner, 2026-09-23: "a short section, not the
 * story"): "Booking in the app. Soon.", one sentence on what it will do and how to
 * book until then, the store buttons (coming soon until a listing exists), and one
 * redrawn app screen.
 */
export function AppBand({ locale, stores }: { locale: Locale; stores: StoreLinks }) {
  const tr = makeT(locale);
  return (
    <section className="tp-appband" aria-labelledby="app-title">
      <div className="tp-appband__inner">
        <div className="tp-appband__copy" data-reveal="">
          <h2 id="app-title" className="tp-appband__title">
            {tr('site.app.title')}
          </h2>
          <p className="tp-appband__body">{tr('site.app.body')}</p>
          <StoreButtons locale={locale} links={stores} />
        </div>
        <div className="tp-appband__art" data-reveal="">
          <BookScreen locale={locale} />
        </div>
      </div>
    </section>
  );
}

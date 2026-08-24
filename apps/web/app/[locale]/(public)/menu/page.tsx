import type { Metadata } from 'next';
import { formatIQD, makeT, type Locale } from '@touch/i18n';
import { asLocale } from '@/lib/locales';
import { createStaticSupabase } from '@/lib/supabase/static';
import { fetchMenu, type MenuItem } from '@/lib/menu';
import { MenuLive } from './MenuLive';

// Public read-only menu — server-rendered from the same rows the till edits
// (SOW module 6 acceptance: an availability change at the till shows without a
// redeploy). Short ISR is the safety net; the MenuLive client island refreshes
// instantly on the 'menu' broadcast topic (0022).
export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const tr = makeT(locale);
  return {
    title: tr('seo.menuTitle'),
    description: tr('seo.menuDescription'),
    openGraph: { title: tr('seo.menuTitle'), description: tr('seo.menuDescription') },
  };
}

export default async function MenuPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  const tr = makeT(locale);
  let categories: Awaited<ReturnType<typeof fetchMenu>> = [];
  try {
    categories = await fetchMenu(createStaticSupabase());
  } catch {
    // Build/preview without a reachable Supabase still produces a page; the
    // 60s ISR window re-fills it as soon as the stack answers.
  }

  return (
    <main>
      <MenuLive />
      <section className="tp-hero" style={{ paddingBlock: '1.5rem' }}>
        <h1>{tr('seo.menuTitle')}</h1>
        <p>{tr('cafe.payAtDesk')}</p>
      </section>

      {categories.map((cat) => (
        <section key={cat.id} className="tp-menu-cat">
          <h2>{locale === 'ar' ? cat.name_ar : cat.name_en}</h2>
          {cat.items.map((item) => (
            <MenuRow key={item.id} item={item} locale={locale} unavailableLabel={tr('cafe.itemUnavailable')} />
          ))}
        </section>
      ))}
    </main>
  );
}

function MenuRow({
  item,
  locale,
  unavailableLabel,
}: {
  item: MenuItem;
  locale: Locale;
  unavailableLabel: string;
}) {
  const ar = locale === 'ar';
  const multiSize = item.variants.length > 1;
  return (
    <article className={item.orderable ? 'tp-menu-item' : 'tp-menu-item tp-menu-item--off'}>
      <div className="tp-menu-item__body">
        <div className="tp-menu-item__name">{ar ? item.name_ar : item.name_en}</div>
        {(ar ? item.description_ar : item.description_en) && (
          <p className="tp-menu-item__desc">{ar ? item.description_ar : item.description_en}</p>
        )}
        {(item.allergens.length > 0 || !item.orderable) && (
          <div className="tp-chips">
            {item.allergens.map((a) => (
              <span key={a.code} className="tp-chip">
                {ar ? a.label_ar : a.label_en}
              </span>
            ))}
            {!item.orderable && <span className="tp-chip tp-chip--muted">{unavailableLabel}</span>}
          </div>
        )}
      </div>
      <div className="tp-menu-item__prices">
        {item.variants.map((v) => (
          <div key={v.id}>
            {multiSize && (
              <span className="tp-menu-item__price-size">{ar ? v.name_ar : v.name_en} · </span>
            )}
            <span>{formatIQD(v.price_iqd, locale)}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

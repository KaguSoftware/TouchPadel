/**
 * Did the home-screen promo surfaces do anything? Clicks alone flatter a promo,
 * so the card pairs each surface with its FOLLOW-THROUGH (sessions that clicked
 * and then ordered) and, where the featured discount ran, what it actually cost.
 */
import { useLocale } from '../../../lib/i18n';
import type { RawAnalytics } from '../derive';
import type { Formatters } from '../format';
import { CardShell, muted, type CardState } from './CardShell';

export function PromoPerformance({ raw, state, f }: { raw: RawAnalytics | null; state: CardState; f: Formatters }) {
  const { tr } = useLocale();
  const surfaces = raw?.posthog?.promo ?? [];
  const sales = raw?.promoSales ?? null;
  const empty = surfaces.length === 0 && (sales === null || sales.qty === 0);

  return (
    <CardShell
      title={tr('analytics.cards.promo')}
      state={state === 'ready' && empty ? 'empty' : state}
      emptyKey="analytics.empty.promo"
    >
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {surfaces.map((s) => {
          const follow = s.sessions > 0 ? Math.round((s.sessionsOrdered / s.sessions) * 100) : 0;
          return (
            <div key={s.kind} style={{ fontSize: '0.85rem' }}>
              <strong>{tr(s.kind === 'featured' ? 'analytics.cards.featured' : 'analytics.cards.suggested')}</strong>
              <span style={{ ...muted, marginInlineStart: '0.4rem' }}>
                {tr('analytics.cards.clicks')} {f.num(s.clicks)} · {tr('analytics.cards.sessions')} {f.num(s.sessions)} ·{' '}
                {tr('analytics.cards.followThrough')} {f.pct(follow)}
              </span>
            </div>
          );
        })}
        {sales && sales.qty > 0 && (
          <p style={{ ...muted, margin: 0 }}>
            {f.num(sales.qty)} · {f.money(sales.revenueIqd)} · −{f.money(sales.discountIqd)}
          </p>
        )}
      </div>
    </CardShell>
  );
}

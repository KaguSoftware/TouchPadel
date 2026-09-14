/**
 * Menu-engineering 2×2 (stars / plowhorses / puzzles / dogs) with the cost
 * coverage stated up front: a quadrant computed from a third of the menu is a
 * hint, not a verdict, so the card says how much of revenue actually has a cost.
 */
import { Link } from '@tanstack/react-router';
import { pickLocale, type MenuQuadrant } from '@touch/core';
import type { MessageKey } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import type { Derived } from '../derive';
import type { Formatters } from '../format';
import { CardShell, type CardState } from './CardShell';
import { StatusBadge } from '../../../components/kit';

const QUADRANTS: readonly MenuQuadrant[] = ['star', 'plowhorse', 'puzzle', 'dog'];
const TITLE: Record<MenuQuadrant, MessageKey> = {
  star: 'analytics.matrix.star',
  plowhorse: 'analytics.matrix.plowhorse',
  puzzle: 'analytics.matrix.puzzle',
  dog: 'analytics.matrix.dog',
};
const ACTION: Record<MenuQuadrant, MessageKey> = {
  star: 'analytics.matrix.actions.star',
  plowhorse: 'analytics.matrix.actions.plowhorse',
  puzzle: 'analytics.matrix.actions.puzzle',
  dog: 'analytics.matrix.actions.dog',
};

export function MenuMatrixCard({ derived, state, f }: { derived: Derived | null; state: CardState; f: Formatters }) {
  const { tr, locale } = useLocale();
  const me = derived?.menuEngineering ?? null;
  // Coverage from the server's margin rows (the same rows the matrix is built on).
  const cov = derived?.marginsCoverage ?? null;
  const noCost = cov ? Math.max(0, cov.itemsTotal - cov.itemsWithCost) : 0;
  // Sold below cost — the single most urgent thing this card can say (same
  // maths as the retired overview card: the worst first, the loss summed).
  const below = me ? me.items.filter((i) => i.losingMoney).sort((a, b) => a.profitIqd - b.profitIqd) : [];
  const lost = Math.abs(below.reduce((s, i) => s + i.profitIqd, 0));
  const itemName = (i: { id: string; nameEn: string; nameAr: string }) => pickLocale({ en: i.nameEn, ar: i.nameAr }, locale) || i.id;

  return (
    <CardShell
      title={tr('analytics.matrix.title')}
      state={state === 'ready' && (!me || !me.hasData) ? 'empty' : state}
      emptyKey="analytics.empty.matrix"
      tip={
        <span style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          {QUADRANTS.map((q) => (
            <span key={q}>
              <strong>{tr(TITLE[q])}</strong>: {tr(ACTION[q])}
            </span>
          ))}
        </span>
      }
      note={
        me && me.hasData && cov ? (
          <>
            {tr('analytics.matrix.coverage', { pct: f.num(Math.round(cov.revenueWithCostPct)) })}
            {noCost > 0 && ` · ${tr('analytics.matrix.noCost', { count: f.num(noCost) })}`}{' '}
            <Link to="/admin/menu" style={{ color: 'var(--tp-accent)' }}>
              {tr('analytics.matrix.setupLink')}
            </Link>
            {!me.coverage.reliable && ` · ${tr('analytics.matrix.unreliable')}`}
            {below.length > 0 && (
              <span style={{ display: 'block', color: 'var(--tp-danger)' }}>
                {below.length === 1
                  ? tr('analytics.matrix.belowCostOne', { name: itemName(below[0]!), money: f.money(below[0]!.unitMarginIqd), lost: f.money(lost) })
                  : tr('analytics.matrix.belowCostMany', { count: f.num(below.length), names: below.slice(0, 2).map(itemName).join(', '), lost: f.money(lost) })}
              </span>
            )}
          </>
        ) : undefined
      }
    >
      {me && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          {QUADRANTS.map((q) => {
            const items = me.items.filter((i) => i.quadrant === q).sort((a, b) => b.profitIqd - a.profitIqd);
            return (
              <div key={q} style={{ border: '1px solid var(--tp-border)', borderRadius: '0.4rem', padding: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <strong style={{ fontSize: 'var(--tp-fs-sm)' }}>{tr(TITLE[q])}</strong>
                  <StatusBadge size="sm" dot={false} tone={q === 'star' ? 'success' : q === 'dog' ? 'danger' : 'neutral'} label={f.num(me.counts[q])} />
                </div>
                <ul style={{ margin: 0, paddingInlineStart: '1rem', fontSize: 'var(--tp-fs-sm)' }}>
                  {items.slice(0, 4).map((i) => (
                    <li key={i.id} style={{ color: i.losingMoney ? 'var(--tp-danger)' : undefined }}>
                      {pickLocale({ en: i.nameEn, ar: i.nameAr }, locale) || i.id} — {f.money(i.unitMarginIqd)} · {f.num(i.qty)}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </CardShell>
  );
}

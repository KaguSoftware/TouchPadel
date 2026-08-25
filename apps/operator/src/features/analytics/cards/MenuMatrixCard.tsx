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
import { CardShell, Chip, muted, type CardState } from './CardShell';

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
  const noCost = me ? Math.max(0, me.coverage.soldItems - me.coverage.costedItems) : 0;

  return (
    <CardShell
      title={tr('analytics.matrix.title')}
      state={state === 'ready' && (!me || !me.hasData) ? 'empty' : state}
      emptyKey="analytics.empty.matrix"
      note={
        me && me.hasData ? (
          <>
            {tr('analytics.matrix.coverage', { pct: f.num(Math.round(me.coverage.revenueRatio * 100)) })}
            {noCost > 0 && ` · ${tr('analytics.matrix.noCost', { count: f.num(noCost) })}`}{' '}
            <Link to="/admin/menu" style={{ color: 'var(--tp-accent)' }}>
              {tr('analytics.matrix.setupLink')}
            </Link>
            {!me.coverage.reliable && ` · ${tr('analytics.matrix.unreliable')}`}
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
                  <strong style={{ fontSize: '0.85rem' }}>{tr(TITLE[q])}</strong>
                  <Chip tone={q === 'star' ? 'good' : q === 'dog' ? 'bad' : 'neutral'}>{f.num(me.counts[q])}</Chip>
                </div>
                <p style={{ ...muted, marginBlock: '0.25rem' }}>{tr(ACTION[q])}</p>
                <ul style={{ margin: 0, paddingInlineStart: '1rem', fontSize: '0.8rem' }}>
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

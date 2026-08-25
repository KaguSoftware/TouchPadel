/**
 * The items that actually make the money — ranked by TOTAL gross profit, not by
 * revenue or by margin percent (a 70 % margin on three sales is not a top item).
 */
import { pickLocale } from '@touch/core';
import { useLocale } from '../../../lib/i18n';
import type { Derived } from '../derive';
import type { Formatters } from '../format';
import { CardShell, muted, type CardState } from './CardShell';

export function TopProfit({ derived, state, f }: { derived: Derived | null; state: CardState; f: Formatters }) {
  const { tr, locale } = useLocale();
  const items = (derived?.menuEngineering.items ?? []).slice().sort((a, b) => b.profitIqd - a.profitIqd).slice(0, 8);

  return (
    <CardShell
      title={tr('analytics.cards.topProfit')}
      state={state === 'ready' && items.length === 0 ? 'empty' : state}
      emptyKey="analytics.empty.matrix"
    >
      <ol style={{ margin: 0, paddingInlineStart: '1.2rem', display: 'grid', gap: '0.25rem' }}>
        {items.map((i) => (
          <li key={i.id} style={{ fontSize: '0.85rem' }}>
            <span>{pickLocale({ en: i.nameEn, ar: i.nameAr }, locale) || i.id}</span>
            <span style={{ ...muted, marginInlineStart: '0.4rem' }}>
              {f.money(i.profitIqd)} · {f.pct(i.marginPct)} · {f.num(i.qty)}
            </span>
          </li>
        ))}
      </ol>
    </CardShell>
  );
}

/**
 * The items that actually make the money — ranked by TOTAL gross profit, not by
 * revenue or by margin percent (a 70 % margin on three sales is not a top item).
 * Each row carries a bar of its profit against the first, so the drop from
 * the leader reads before the numbers do; a loss draws no bar.
 */
import { pickLocale } from '@touch/core';
import { useLocale } from '../../../lib/i18n';
import type { Derived } from '../derive';
import type { Formatters } from '../format';
import { CardShell, muted, type CardState } from './CardShell';
import { useChartColors } from '../charts/colors';

export function TopProfit({ derived, state, f }: { derived: Derived | null; state: CardState; f: Formatters }) {
  const { tr, locale } = useLocale();
  const { HIGHLIGHT, BAR_MUTED, HEAT_RAMP } = useChartColors();
  const items = (derived?.menuEngineering.items ?? []).slice().sort((a, b) => b.profitIqd - a.profitIqd).slice(0, 8);
  const top = Math.max(0, items[0]?.profitIqd ?? 0);

  return (
    <CardShell
      title={tr('analytics.cards.topProfit')}
      state={state === 'ready' && items.length === 0 ? 'empty' : state}
      emptyKey="analytics.empty.matrix"
    >
      <ol style={{ margin: 0, paddingInlineStart: '1.2rem', display: 'grid', gap: 'var(--tp-sp-2)' }}>
        {items.map((i, n) => (
          <li key={i.id} style={{ fontSize: 'var(--tp-fs-sm)' }}>
            <span>{pickLocale({ en: i.nameEn, ar: i.nameAr }, locale) || i.id}</span>
            <span style={{ ...muted, marginInlineStart: '0.4rem' }}>
              {tr('analytics.cards.topProfitLine', { money: f.money(i.profitIqd), margin: f.pct(i.marginPct), qty: f.num(i.qty) })}
            </span>
            <span aria-hidden="true" style={{ display: 'block', blockSize: 5, marginBlockStart: 3, borderRadius: 3, background: HEAT_RAMP[1], overflow: 'hidden' }}>
              <span
                style={{
                  display: 'block',
                  blockSize: '100%',
                  inlineSize: `${top > 0 && i.profitIqd > 0 ? Math.max(2, (i.profitIqd / top) * 100) : 0}%`,
                  borderRadius: 3,
                  background: n === 0 ? HIGHLIGHT : BAR_MUTED,
                }}
              />
            </span>
          </li>
        ))}
      </ol>
    </CardShell>
  );
}

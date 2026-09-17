/**
 * Market-basket pairs. `confidencePct` = of the orders containing A, how many
 * also contained B; `lift` > 1 means the pair happens more than chance — a lift
 * near 1 on a popular item is a coincidence, not a combo, so both are shown.
 */
import { pickLocale } from '@touch/core';
import { useLocale } from '../../../lib/i18n';
import type { Derived } from '../derive';
import type { Formatters } from '../format';
import { CardShell, muted, type CardState } from './CardShell';

export function BoughtTogether({ derived, state, f }: { derived: Derived | null; state: CardState; f: Formatters }) {
  const { tr, locale } = useLocale();
  const pairs = derived?.pairs ?? [];
  const name = (id: string) => {
    const ref = derived?.names.get(id);
    return ref ? pickLocale({ en: ref.nameEn, ar: ref.nameAr }, locale) || id : id;
  };
  return (
    <CardShell
      title={tr('analytics.cards.boughtTogether')}
      state={state === 'ready' && pairs.length === 0 ? 'empty' : state}
      emptyKey="analytics.empty.boughtTogether"
    >
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.3rem' }}>
        {pairs.map((p) => (
          <li key={`${p.a}-${p.b}`} style={{ fontSize: 'var(--tp-fs-sm)' }}>
            <span>
              {name(p.a)} + {name(p.b)}
            </span>
            {/* Every number named: the old line read "with 67% of orders · ×92 · 2". */}
            <span style={{ ...muted, display: 'block' }}>
              {p.lift != null
                ? tr('analytics.cards.pairLine', { pct: f.num(p.confidencePct), lift: f.num1(p.lift), n: f.num(p.count) })
                : tr('analytics.cards.pairLineNoLift', { pct: f.num(p.confidencePct), n: f.num(p.count) })}
            </span>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

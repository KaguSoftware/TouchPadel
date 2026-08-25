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
          <li key={`${p.a}-${p.b}`} style={{ fontSize: '0.85rem' }}>
            <span>
              {name(p.a)} + {name(p.b)}
            </span>
            <span style={{ ...muted, marginInlineStart: '0.4rem' }}>
              {tr('analytics.cards.withX', { pct: f.num(p.confidencePct) })}
              {p.lift != null && ` · ×${p.lift}`} · {f.num(p.count)}
            </span>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

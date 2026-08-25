/**
 * Items almost nobody sees but nearly everyone who does buys — the cheapest
 * lever on the menu: move them up, no price change needed.
 */
import { pickLocale } from '@touch/core';
import { useLocale } from '../../../lib/i18n';
import type { Derived } from '../derive';
import type { Formatters } from '../format';
import { CardShell, muted, type CardState } from './CardShell';

export function HiddenGems({ derived, state, f }: { derived: Derived | null; state: CardState; f: Formatters }) {
  const { tr, locale } = useLocale();
  const gems = derived?.hiddenGems ?? [];
  return (
    <CardShell
      title={tr('analytics.cards.hiddenGems')}
      state={state === 'ready' && gems.length === 0 ? 'empty' : state}
      emptyKey="analytics.empty.engagement"
      note={tr('analytics.cards.hiddenGemsHint')}
    >
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.25rem' }}>
        {gems.map((g) => (
          <li key={g.id} style={{ fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
            <span>{pickLocale({ en: g.nameEn, ar: g.nameAr }, locale) || g.id}</span>
            <span style={muted}>
              {f.pct(g.convPct)} · {f.num(g.views)} / {f.num(g.sold)}
            </span>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

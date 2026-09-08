/**
 * Rising / fading item attention. `itemMomentum` normalises by the number of
 * RECORDED days in each window, so a shorter comparison window cannot fake a
 * fall — and when the two windows are not comparable the card says so instead
 * of printing a number.
 */
import { pickLocale, type ItemMomentum } from '@touch/core';
import { useLocale } from '../../../lib/i18n';
import type { Derived } from '../derive';
import type { Formatters } from '../format';
import { CardShell, muted, type CardState } from './CardShell';
import { StatusBadge } from '../../../components/kit';

export function Momentum({ derived, state, f }: { derived: Derived | null; state: CardState; f: Formatters }) {
  const { tr } = useLocale();
  const m = derived?.momentum ?? null;
  const empty = m !== null && m.rising.length === 0 && m.fading.length === 0;

  return (
    <CardShell
      title={tr('analytics.cards.momentum')}
      state={state === 'ready' && (m === null || empty) ? 'empty' : state}
      emptyKey="analytics.empty.engagement"
      actions={m && !m.comparable ? <StatusBadge size="sm" tone="warn" label={tr('analytics.cards.notComparable')} /> : undefined}
    >
      {m && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
          <Column title={tr('analytics.cards.rising')} rows={m.rising.slice(0, 5)} f={f} />
          <Column title={tr('analytics.cards.fading')} rows={m.fading.slice(0, 5)} f={f} />
        </div>
      )}
    </CardShell>
  );
}

function Column({ title, rows, f }: { title: string; rows: readonly ItemMomentum[]; f: Formatters }) {
  const { locale } = useLocale();
  return (
    <div>
      <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>{title}</span>
      <ul style={{ margin: '0.2rem 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: '0.2rem' }}>
        {rows.map((r) => (
          <li key={r.id} style={{ fontSize: 'var(--tp-fs-sm)', display: 'flex', justifyContent: 'space-between', gap: '0.4rem' }}>
            <span>{pickLocale({ en: r.nameEn, ar: r.nameAr }, locale) || r.id}</span>
            <span style={muted}>{r.deltaPct == null ? '—' : f.signedPct(r.deltaPct)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

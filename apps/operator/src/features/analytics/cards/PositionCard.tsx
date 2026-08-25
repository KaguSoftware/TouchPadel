/**
 * Menu position vs sales (Spearman per category). The copy says "related",
 * never "causes": guests may buy the top item because it is first, or it may be
 * first because it sells — the card states the assumption instead of hiding it.
 */
import { pickLocale } from '@touch/core';
import type { MessageKey } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import type { Derived } from '../derive';
import type { Formatters } from '../format';
import { CardShell, Chip, muted, type CardState } from './CardShell';

const VERDICT: Record<string, MessageKey> = {
  'top-sells': 'analytics.position.verdictTop',
  'bottom-sells': 'analytics.position.verdictBottom',
  none: 'analytics.position.verdictNone',
};

function strengthKey(rho: number, significant: boolean): MessageKey {
  const abs = Math.abs(rho);
  if (!significant || abs < 0.2) return 'analytics.position.strength.none';
  if (abs >= 0.5) return 'analytics.position.strength.strong';
  if (abs >= 0.35) return 'analytics.position.strength.moderate';
  return 'analytics.position.strength.weak';
}

export function PositionCard({ derived, state, f }: { derived: Derived | null; state: CardState; f: Formatters }) {
  const { tr, locale } = useLocale();
  const pos = derived?.menuPosition ?? null;
  const name = (r: { nameEn: string; nameAr: string; id: string }) => pickLocale({ en: r.nameEn, ar: r.nameAr }, locale) || r.id;

  return (
    <CardShell
      title={tr('analytics.position.title')}
      state={state === 'ready' && (!pos || !pos.hasData) ? 'empty' : state}
      emptyKey="analytics.empty.position"
      note={
        pos && pos.hasData ? (
          <>
            {tr('analytics.position.asOf', { date: f.date(pos.positionAsOf, true) })} · {tr('analytics.position.assumption')}
          </>
        ) : undefined
      }
      actions={pos && pos.hasData ? <Chip tone="neutral">{tr(strengthKey(pos.overallRho, pos.significant))}</Chip> : undefined}
    >
      {pos && (
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>{tr(VERDICT[pos.direction] ?? 'analytics.position.verdictNone')}</p>
          <Bucket
            title={tr('analytics.position.buried')}
            hint={tr('analytics.position.buriedHint')}
            rows={pos.buriedWinners.slice(0, 4).map((i) => ({ id: i.id, label: name(i), gap: i.rankGap }))}
            f={f}
          />
          <Bucket
            title={tr('analytics.position.squatters')}
            hint={tr('analytics.position.squattersHint')}
            rows={pos.squatters.slice(0, 4).map((i) => ({ id: i.id, label: name(i), gap: i.rankGap }))}
            f={f}
          />
          <details>
            <summary style={{ ...muted, cursor: 'pointer' }}>{tr('analytics.position.showLadder')}</summary>
            <div style={{ display: 'grid', gap: '0.4rem', marginBlockStart: '0.4rem' }}>
              {pos.categories.map((cat) => (
                <div key={cat.categoryId ?? 'none'}>
                  <strong style={{ fontSize: '0.8rem' }}>
                    {pickLocale({ en: cat.categoryNameEn, ar: cat.categoryNameAr }, locale)}
                  </strong>
                  <ol style={{ margin: '0.15rem 0 0', paddingInlineStart: '1.4rem', fontSize: '0.78rem' }}>
                    {cat.items.map((i) => (
                      <li key={i.id}>
                        {name(i)} — {f.num(i.qty)}
                        {i.rankGap !== 0 && (
                          <span style={{ color: i.rankGap > 0 ? 'var(--tp-accent)' : 'var(--tp-muted-fg)' }}>
                            {' '}
                            ({tr('analytics.position.rankGap')} {i.rankGap > 0 ? '+' : ''}
                            {f.num(i.rankGap)})
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </CardShell>
  );
}

function Bucket({
  title,
  hint,
  rows,
  f,
}: {
  title: string;
  hint: string;
  rows: readonly { id: string; label: string; gap: number }[];
  f: Formatters;
}) {
  const { tr } = useLocale();
  return (
    <div>
      <span style={{ fontSize: '0.82rem', fontWeight: 700 }}>{title}</span>
      <span style={{ ...muted, marginInlineStart: '0.4rem' }}>{hint}</span>
      {rows.length === 0 ? (
        <p style={muted}>{tr('analytics.empty.generic')}</p>
      ) : (
        <ul style={{ margin: '0.15rem 0 0', paddingInlineStart: '1.1rem', fontSize: '0.8rem' }}>
          {rows.map((r) => (
            <li key={r.id}>
              {r.label} <span style={{ color: 'var(--tp-muted-fg)' }}>({f.num(r.gap)})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

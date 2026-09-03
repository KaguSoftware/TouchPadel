/**
 * On-hand — the stock module's front page (SOW L539 "every movement traceable":
 * a row click opens its full ledger). Live batches vs the ledger's theoretical,
 * with par/low-stock badges (L543-545).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, card } from '../../components/ui';
import { LedgerDrawer } from './LedgerDrawer';
import { SK, fetchOnHand, type OnHandRow } from './stockKeys';

export function OnHand() {
  const { tr, locale } = useLocale();
  const [belowParOnly, setBelowParOnly] = useState(false);
  const [open, setOpen] = useState<OnHandRow | null>(null);

  const onHandQ = useQuery({ queryKey: SK.onHand, queryFn: fetchOnHand });
  const rows = (onHandQ.data ?? [])
    .filter((r) => r.is_active)
    .filter((r) => !belowParOnly || (r.par_level !== null && r.on_hand < r.par_level));

  return (
    <div style={{ maxInlineSize: '46rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ marginBlock: '0.4rem' }}>{tr('op.stock.onHandTitle')}</h2>
        <Button
          kind={belowParOnly ? 'primary' : 'default'}
          aria-pressed={belowParOnly}
          onClick={() => setBelowParOnly((v) => !v)}
        >
          {tr('op.stock.belowPar')}
        </Button>
      </div>

      <div style={card}>
        <table style={{ inlineSize: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'start', color: 'var(--tp-muted-fg)', fontSize: '0.8rem' }}>
              <th style={{ textAlign: 'start', paddingBlock: '0.3rem' }}>{tr('op.stock.ingredient')}</th>
              <th style={{ textAlign: 'end' }}>{tr('op.stock.onHand')}</th>
              <th style={{ textAlign: 'end' }}>{tr('op.stock.theoretical')}</th>
              <th style={{ textAlign: 'end' }}>{tr('op.stock.par')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const low =
                r.low_stock_threshold !== null && r.on_hand <= r.low_stock_threshold;
              const belowPar = r.par_level !== null && r.on_hand < r.par_level;
              return (
                <tr key={r.ingredient_id} style={{ borderBlockStart: '1px solid var(--tp-border)' }}>
                  <td style={{ paddingBlock: '0.35rem' }}>
                    {pickName(locale, r)}{' '}
                    <span style={{ color: 'var(--tp-muted-fg)', fontSize: '0.8rem' }}>({r.unit})</span>
                    {low && (
                      <span style={{ color: 'var(--tp-danger)', fontWeight: 700 }}>
                        {' '}
                        · {tr('op.stock.lowStock')}
                      </span>
                    )}
                    {!low && belowPar && (
                      <span style={{ color: 'var(--tp-accent-2)', fontWeight: 700 }}>
                        {' '}
                        · {tr('op.stock.underPar')}
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>{r.on_hand}</td>
                  <td style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums', color: 'var(--tp-muted-fg)' }}>
                    {r.theoretical}
                  </td>
                  <td style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums', color: 'var(--tp-muted-fg)' }}>
                    {r.par_level ?? '—'}
                  </td>
                  <td style={{ textAlign: 'end' }}>
                    <Button kind="ghost" onClick={() => setOpen(r)}>
                      {tr('op.stock.ledger')}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {onHandQ.isSuccess && rows.length === 0 && (
          <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('op.stock.empty')}</p>
        )}
      </div>

      {open && <LedgerDrawer ingredient={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

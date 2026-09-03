/**
 * The variance report — Module 5's ACCEPTANCE SURFACE (SOW L509-514: "a
 * physical count is run against a period of trading and the variance report
 * reconciles to Touch's satisfaction, with every movement traceable to the
 * order, delivery or waste entry that caused it"). v_variance_report carries
 * the reconciliation columns; the per-row movements button IS the "one click
 * away" clause (movement_ids drill straight into the ledger).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, card, inputStyle } from '../../components/ui';
import { LedgerDrawer } from './LedgerDrawer';
import { SK } from './stockKeys';

interface CountOption {
  id: string;
  finalized_at: string;
}

interface VarianceRow {
  count_id: string;
  period_start: string | null;
  period_end: string;
  ingredient_id: string;
  name_en: string;
  name_ar: string;
  unit: string;
  theoretical_qty: number;
  counted_qty: number;
  variance_qty: number;
  sold_qty: number;
  expected_waste_qty: number;
  recorded_waste_qty: number;
  void_qty: number;
  expired_qty: number;
  movement_ids: number[] | null;
}

export function VarianceReport() {
  const { tr, locale } = useLocale();
  const [countId, setCountId] = useState('');
  const [drill, setDrill] = useState<VarianceRow | null>(null);

  const countsQ = useQuery({
    queryKey: SK.counts,
    queryFn: async (): Promise<CountOption[]> => {
      const { data, error } = await supabase
        .from('stock_counts')
        .select('id, finalized_at')
        .not('finalized_at', 'is', null)
        .order('finalized_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data as CountOption[];
    },
  });

  const chosen = countId || countsQ.data?.[0]?.id || '';

  const varianceQ = useQuery({
    queryKey: SK.variance(chosen),
    enabled: !!chosen,
    queryFn: async (): Promise<VarianceRow[]> => {
      const { data, error } = await supabase
        .from('v_variance_report')
        .select('*')
        .eq('count_id', chosen)
        .order('name_en');
      if (error) throw error;
      return data as VarianceRow[];
    },
  });
  const rows = varianceQ.data ?? [];

  return (
    <div style={{ maxInlineSize: '58rem' }}>
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
        <h2 style={{ marginBlock: '0.4rem' }}>{tr('op.stock.varianceTitle')}</h2>
        <select style={{ ...inputStyle, inlineSize: 'auto' }} value={chosen} onChange={(e) => setCountId(e.target.value)}>
          {(countsQ.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {formatTime(new Date(c.finalized_at), locale)}
            </option>
          ))}
        </select>
      </div>
      {rows[0] && (
        <p style={{ marginBlockStart: 0, color: 'var(--tp-muted-fg)', fontSize: '0.85rem' }}>
          {tr('op.stock.period', {
            from: rows[0].period_start ? formatTime(new Date(rows[0].period_start), locale) : '—',
            to: formatTime(new Date(rows[0].period_end), locale),
          })}
        </p>
      )}

      <div style={{ ...card, overflowX: 'auto' }}>
        <table style={{ inlineSize: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ color: 'var(--tp-muted-fg)' }}>
              <th style={{ textAlign: 'start' }}>{tr('op.stock.ingredient')}</th>
              <th style={{ textAlign: 'end' }}>{tr('op.stock.theoretical')}</th>
              <th style={{ textAlign: 'end' }}>{tr('op.stock.counted')}</th>
              <th style={{ textAlign: 'end' }}>{tr('op.stock.variance')}</th>
              <th style={{ textAlign: 'end' }}>{tr('op.stock.sold')}</th>
              <th style={{ textAlign: 'end' }}>{tr('op.stock.expectedWaste')}</th>
              <th style={{ textAlign: 'end' }}>{tr('op.stock.recordedWaste')}</th>
              <th style={{ textAlign: 'end' }}>{tr('op.stock.voids')}</th>
              <th style={{ textAlign: 'end' }}>{tr('op.stock.expired')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ingredient_id} style={{ borderBlockStart: '1px solid var(--tp-border)' }}>
                <td style={{ paddingBlock: '0.3rem' }}>
                  {pickName(locale, r)}{' '}
                  <span style={{ color: 'var(--tp-muted-fg)', fontSize: '0.75rem' }}>({r.unit})</span>
                </td>
                <td style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>{r.theoretical_qty}</td>
                <td style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>{r.counted_qty}</td>
                <td
                  style={{
                    textAlign: 'end',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 700,
                    color:
                      r.variance_qty < 0
                        ? 'var(--tp-danger)'
                        : r.variance_qty > 0
                          ? 'var(--tp-accent)'
                          : 'inherit',
                  }}
                >
                  {r.variance_qty > 0 ? '+' : ''}
                  {r.variance_qty}
                </td>
                <td style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>{r.sold_qty}</td>
                <td style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>{r.expected_waste_qty}</td>
                <td style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>{r.recorded_waste_qty}</td>
                <td style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>{r.void_qty}</td>
                <td style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>{r.expired_qty}</td>
                <td style={{ textAlign: 'end' }}>
                  <Button kind="ghost" onClick={() => setDrill(r)}>
                    {tr('op.stock.movements')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {varianceQ.isSuccess && rows.length === 0 && (
          <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('op.stock.noCounts')}</p>
        )}
      </div>

      {drill && (
        <LedgerDrawer
          ingredient={drill}
          movementIds={drill.movement_ids ?? []}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

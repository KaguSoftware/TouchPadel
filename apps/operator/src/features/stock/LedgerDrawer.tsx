/**
 * The append-only ledger for one ingredient (SOW L524-525: "stock as an
 * append-only ledger, never an editable number"; L539: every movement
 * traceable to the order, delivery or waste entry that caused it).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, Modal } from '../../components/ui';
import { LEDGER_PAGE, SK, fetchLedger, type MovementRow } from './stockKeys';

function refLabel(m: MovementRow): string {
  if (m.order_item_id) return `order ${m.order_item_id.slice(0, 8)}`;
  if (m.delivery_line_id) return `delivery ${m.delivery_line_id.slice(0, 8)}`;
  if (m.count_id) return `count ${m.count_id.slice(0, 8)}`;
  return '—';
}

export function LedgerDrawer({
  ingredient,
  onClose,
  movementIds,
}: {
  ingredient: { ingredient_id: string; name_en: string; name_ar: string; unit: string };
  onClose: () => void;
  /** Variance drill-down: show only these movement ids (SOW "one click away"). */
  movementIds?: number[];
}) {
  const { tr, locale } = useLocale();
  const [page, setPage] = useState(0);

  const ledgerQ = useQuery({
    queryKey: [...SK.ledger(ingredient.ingredient_id), page, movementIds ?? null],
    staleTime: 0,
    queryFn: async () => {
      if (movementIds) {
        // Variance drill-down: exactly the period's movements, whatever page
        // of history they live on.
        const { data, error } = await supabase
          .from('stock_movements')
          .select(
            'id, at, movement_type, qty_delta, unit_cost_iqd, reason_code, order_item_id, delivery_line_id, count_id',
          )
          .in('id', movementIds)
          .order('at', { ascending: false });
        if (error) throw error;
        return data as MovementRow[];
      }
      return fetchLedger(ingredient.ingredient_id, page);
    },
  });
  const rows = ledgerQ.data ?? [];

  return (
    <Modal title={`${tr('op.stock.ledger')} — ${pickName(locale, ingredient)}`} onClose={onClose}>
      <table style={{ inlineSize: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ color: 'var(--tp-muted-fg)' }}>
            <th style={{ textAlign: 'start' }}>{tr('op.stock.when')}</th>
            <th style={{ textAlign: 'start' }}>{tr('op.stock.movement')}</th>
            <th style={{ textAlign: 'end' }}>{tr('op.stock.qty')}</th>
            <th style={{ textAlign: 'start' }}>{tr('op.stock.ref')}</th>
            <th style={{ textAlign: 'start' }}>{tr('op.common.reason')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} style={{ borderBlockStart: '1px solid var(--tp-border)' }}>
              <td style={{ whiteSpace: 'nowrap', paddingBlock: '0.25rem' }}>
                {formatTime(new Date(m.at), locale)}
              </td>
              <td>{m.movement_type}</td>
              <td
                style={{
                  textAlign: 'end',
                  fontVariantNumeric: 'tabular-nums',
                  color: m.qty_delta < 0 ? 'var(--tp-danger)' : 'var(--tp-accent)',
                }}
              >
                {m.qty_delta > 0 ? '+' : ''}
                {m.qty_delta} {ingredient.unit}
              </td>
              <td style={{ color: 'var(--tp-muted-fg)' }}>{refLabel(m)}</td>
              <td style={{ color: 'var(--tp-muted-fg)' }}>{m.reason_code ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ledgerQ.isSuccess && rows.length === 0 && (
        <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('op.stock.noMovements')}</p>
      )}
      {!movementIds && (
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginBlockStart: '0.5rem' }}>
          <Button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            ‹
          </Button>
          <Button
            disabled={(ledgerQ.data?.length ?? 0) < LEDGER_PAGE}
            onClick={() => setPage((p) => p + 1)}
          >
            ›
          </Button>
        </div>
      )}
    </Modal>
  );
}

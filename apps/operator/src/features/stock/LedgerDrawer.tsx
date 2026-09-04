/**
 * The append-only ledger for one ingredient (SOW L524-525: "stock as an
 * append-only ledger, never an editable number"; L539: every movement
 * traceable to the order, delivery or waste entry that caused it).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, Modal } from '../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, Money, asyncStatus, type Column } from '../../components/kit';
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
          .select('id, at, movement_type, qty_delta, unit_cost_iqd, reason_code, order_item_id, delivery_line_id, count_id')
          .in('id', movementIds)
          .order('at', { ascending: false });
        if (error) throw error;
        return data as MovementRow[];
      }
      return fetchLedger(ingredient.ingredient_id, page);
    },
  });
  const rows = ledgerQ.data ?? [];

  const columns: Column<MovementRow>[] = [
    { key: 'when', header: tr('op.stock.when'), render: (m) => <bdi>{formatDateTime(new Date(m.at), locale)}</bdi> },
    { key: 'type', header: tr('op.stock.movement'), render: (m) => <code style={{ fontSize: 'var(--tp-fs-xs)' }}>{m.movement_type}</code> },
    {
      key: 'qty',
      header: tr('op.stock.qty'),
      numeric: true,
      render: (m) => (
        <span style={{ color: m.qty_delta < 0 ? 'var(--tp-danger-fg)' : 'var(--tp-success-fg)', fontWeight: 600 }} dir="ltr">
          {m.qty_delta > 0 ? '+' : ''}
          {m.qty_delta} {ingredient.unit}
        </span>
      ),
    },
    { key: 'cost', header: tr('ws.manager.stock.expiry.unitCost'), numeric: true, render: (m) => <Money amount={m.unit_cost_iqd} /> },
    { key: 'ref', header: tr('op.stock.ref'), render: (m) => <span style={{ color: 'var(--tp-muted-fg)' }} dir="ltr">{refLabel(m)}</span> },
    { key: 'reason', header: tr('op.common.reason'), render: (m) => <span style={{ color: 'var(--tp-muted-fg)' }}>{m.reason_code ?? '—'}</span> },
  ];

  return (
    <Modal
      title={`${tr('op.stock.ledger')} — ${pickName(locale, ingredient)}`}
      subtitle={tr('ws.manager.stock.ledger.lead')}
      onClose={onClose}
      size="lg"
      footer={
        !movementIds ? (
          <>
            <Button size="sm" icon="chevronStart" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              {tr('ws.manager.stock.ledger.newerPage')}
            </Button>
            <Button size="sm" iconEnd="chevronEnd" disabled={(ledgerQ.data?.length ?? 0) < LEDGER_PAGE} onClick={() => setPage((p) => p + 1)}>
              {tr('ws.manager.stock.ledger.olderPage')}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{tr('common.close')}</Button>
        )
      }
    >
      <AsyncStateWrapper
        compact
        status={asyncStatus(ledgerQ, (d) => d.length === 0)}
        error={ledgerQ.error}
        onRetry={() => void ledgerQ.refetch()}
        emptyContent={<EmptyState compact icon="fileText" title={tr('op.stock.noMovements')} />}
      >
        <DataTable dense columns={columns} rows={rows} rowKey={(m) => String(m.id)} maxBlockSize="60vh" aria-label={tr('op.stock.ledger')} />
      </AsyncStateWrapper>
    </Modal>
  );
}

/**
 * One ingredient's history — the append-only ledger (SOW L524-525: "stock as
 * an append-only ledger, never an editable number"; L539: every movement
 * traceable to the order, delivery or waste entry that caused it).
 *
 * Staff read it to answer "why is this number what it is?", so every row says
 * what happened in words ("Delivery", "Sold", "Count correction"), who did it,
 * and by how much. The previous version printed the raw movement code
 * (`goods_in`) and a truncated record id ("delivery f1f70000"), neither of
 * which means anything at the counter, and its cost column crashed on the
 * fractional per-gram costs deliveries produce.
 *
 * Wave 5 (wave5-addendum-2026-09-25 §5.2): every movement is at a store, so
 * the history has a Store column, and a move between the stores reads "Moved
 * between stores" with "To the bakery store" or "From the cafe store" as its
 * note, rather than its `transfer:<id>` reason code.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDateTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, Modal } from '../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, TableSkeleton, asyncStatus, type Column } from '../../components/kit';
import { useStockFormat, useStoreName } from './stockUi';
import { LEDGER_PAGE, MOVEMENT_SELECT, SK, fetchLedger, type MovementRow } from './stockKeys';
import { isMovementType, transferNote } from './storeLogic';

/** A product test's reason code, `run:<run id>`: the release it was made for. */
const RUN_REASON = /^run:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function LedgerDrawer({
  ingredient,
  onClose,
  movementIds,
}: {
  ingredient: { ingredient_id: string; name_en: string; name_ar: string; unit: string; on_hand?: number };
  onClose: () => void;
  /** Count differences drill-down: only these movements (the period between two counts). */
  movementIds?: number[];
}) {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const storeName = useStoreName();

  const ledgerQ = useQuery({
    queryKey: [...SK.ledger(ingredient.ingredient_id), page, movementIds ?? null],
    staleTime: 0,
    queryFn: async () => {
      if (movementIds) {
        if (movementIds.length === 0) return [];
        // Exactly the period's movements, whatever page of history they live on.
        const { data, error } = await supabase.from('stock_movements').select(MOVEMENT_SELECT).in('id', movementIds).order('at', { ascending: false });
        if (error) throw error;
        return data as unknown as MovementRow[];
      }
      return fetchLedger(ingredient.ingredient_id, page);
    },
  });
  const rows = ledgerQ.data ?? [];

  const what = (m: MovementRow) => (isMovementType(m.movement_type) ? tr(`op.stock.movement.${m.movement_type}`) : m.movement_type);

  const columns: Column<MovementRow>[] = [
    { key: 'when', header: tr('ws.manager.stock.ledger.when'), render: (m) => <bdi>{formatDateTime(new Date(m.at), locale)}</bdi> },
    {
      key: 'what',
      header: tr('ws.manager.stock.ledger.what'),
      render: (m) => (
        <span style={{ display: 'grid' }}>
          <span>{what(m)}</span>
          {/* A line with no batch is the part of a sale that went past the
              batches on record — the reason the shelf and the records differ. */}
          {m.batch_id === null && m.qty_delta < 0 && (
            <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-warn-fg)' }}>{tr('ws.manager.stock.ledger.beyondStock')}</span>
          )}
        </span>
      ),
    },
    {
      key: 'change',
      header: tr('ws.manager.stock.ledger.change'),
      numeric: true,
      render: (m) => (
        <span style={{ color: m.qty_delta < 0 ? 'var(--tp-danger-fg)' : 'var(--tp-success-fg)', fontWeight: 600 }}>
          <bdi>{fmt.change(m.qty_delta, ingredient.unit)}</bdi>
        </span>
      ),
    },
    {
      key: 'store',
      header: tr('ws.stores.ledger.store'),
      render: (m) => (m.location ? <span>{storeName(m.location)}</span> : <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>),
    },
    {
      key: 'cost',
      header: tr('ws.manager.stock.ledger.costPer', { unit: fmt.one(ingredient.unit) }),
      numeric: true,
      render: (m) => <bdi style={{ color: 'var(--tp-muted-fg)' }}>{fmt.cost(m.unit_cost_iqd)}</bdi>,
    },
    { key: 'by', header: tr('ws.manager.stock.ledger.by'), render: (m) => (m.staff ? <bdi>{m.staff.display_name}</bdi> : <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>) },
    {
      key: 'note',
      header: tr('ws.manager.stock.ledger.note'),
      render: (m) => {
        // A move names the other store, never its transfer:<id> reason code.
        if (m.movement_type === 'transfer') {
          const note = transferNote(m.qty_delta, m.location);
          if (note) return <span>{tr(`ws.stores.ledger.${note.dir}.${note.store}`)}</span>;
        }
        // A product test names its release; open it rather than print its id.
        const run = m.movement_type === 'product_test' ? RUN_REASON.exec(m.reason_code ?? '')?.[1] : undefined;
        if (run) {
          return (
            <Button
              kind="ghost"
              size="sm"
              icon="fileText"
              onClick={() => {
                onClose();
                void navigate({ to: '/protocols', search: { run: run.toLowerCase() } });
              }}
            >
              {tr('ws.release.ledger.openRun')}
            </Button>
          );
        }
        return m.reason_code ? <bdi>{m.reason_code}</bdi> : <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>;
      },
    },
  ];

  return (
    <Modal
      title={tr('ws.manager.stock.ledger.title', { name: pickName(locale, ingredient) })}
      subtitle={
        movementIds
          ? tr('ws.manager.stock.ledger.periodLead')
          : ingredient.on_hand !== undefined
            ? tr('ws.manager.stock.ledger.leadWithOnHand', { qty: fmt.qty(ingredient.on_hand, ingredient.unit) })
            : tr('ws.manager.stock.ledger.lead')
      }
      onClose={onClose}
      size="xl"
      footer={(close) => (
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
          <Button onClick={close}>{tr('common.close')}</Button>
        )
      )}
    >
      <AsyncStateWrapper
        compact
        status={asyncStatus(ledgerQ, (d) => d.length === 0)}
        error={ledgerQ.error}
        onRetry={() => void ledgerQ.refetch()}
        skeleton={<TableSkeleton columns={columns} rows={4} />}
        emptyContent={<EmptyState compact kind="nothingToDo" icon="fileText" title={tr('ws.manager.stock.ledger.empty')} />}
      >
        <DataTable columns={columns} rows={rows} rowKey={(m) => String(m.id)} maxBlockSize="60vh" dense aria-label={tr('ws.manager.stock.ledger.title', { name: pickName(locale, ingredient) })} />
      </AsyncStateWrapper>
    </Modal>
  );
}

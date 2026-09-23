/**
 * Stock alerts (SOW L544-545 low-stock / negative stock, the nightly expiry
 * flags, plus the replay conflicts the sync path raises). Dismissing is
 * optimistic — it's an idempotent flag flip that never changes stock.
 *
 * The old screen was one flat table whose first column printed the raw kind
 * code for most rows ("expiring_soon" — the kind it had no label for), with
 * a bare "(100)" beside some names and an "Acknowledge" button that was the
 * only thing to do. Now alerts are grouped by what they mean, each group says
 * what to do about it and has the button that goes there, and each row reads
 * as a sentence built from the alert's own payload ("300 g left, reorder at
 * 1,000 g"). A group can be dismissed at once: seventeen expiry flags raised
 * by one nightly run are one decision, not seventeen clicks.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDate, formatDateTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button } from '../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, PageHeader, Panel, StatusBadge, TableSkeleton, asyncStatus, type Column } from '../../components/kit';
import { CardTitle } from '../ops/OpsVisuals';
import { useStockFormat } from './stockUi';
import { ALERT_ORDER, alertKind, type AlertKind } from './stockLogic';
import { SK, fetchIngredients, type IngredientRow } from './stockKeys';

interface AlertRow {
  id: string;
  kind: string;
  payload: {
    ingredient_id?: string;
    shortfall?: number;
    on_hand?: number;
    threshold?: number;
    qty_remaining?: number;
    expiry_date?: string;
    expired?: boolean;
    device_id?: string;
    [k: string]: unknown;
  };
  created_at: string;
}

const KIND_TONE: Record<AlertKind, 'danger' | 'warn' | 'neutral'> = {
  negative_stock: 'danger',
  out_of_stock: 'danger',
  expired: 'danger',
  low_stock: 'warn',
  expiring_soon: 'warn',
  replay_conflict: 'danger',
};

/** Where each kind is resolved. Replay conflicts have no screen that fixes them — the group says what to do instead. */
const KIND_HREF: Partial<Record<AlertKind, string>> = {
  negative_stock: '/stock/counts',
  out_of_stock: '/stock?filter=out',
  expired: '/stock/expiry',
  low_stock: '/stock?filter=low',
  expiring_soon: '/stock/expiry',
};

export function AlertsPanel() {
  const { tr } = useLocale();
  const queryClient = useQueryClient();
  const toast = useToast();

  const alertsQ = useQuery({
    queryKey: SK.alerts,
    refetchInterval: 60_000, // no realtime topic for alerts — advisory cadence
    queryFn: async (): Promise<AlertRow[]> => {
      const { data, error } = await supabase.from('manager_alerts').select('id, kind, payload, created_at').is('acknowledged_at', null).order('created_at', { ascending: false });
      if (error) throw error;
      return data as AlertRow[];
    },
  });
  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const ingredientOf = new Map((ingredientsQ.data ?? []).map((i) => [i.id, i]));

  const dismiss = useMutation({
    mutationFn: async (alertIds: string[]) => {
      for (const id of alertIds) await appRpc('acknowledge_alert', { p_alert_id: id });
    },
    onMutate: async (alertIds) => {
      await queryClient.cancelQueries({ queryKey: SK.alerts });
      const prev = queryClient.getQueryData<AlertRow[]>(SK.alerts);
      const gone = new Set(alertIds);
      queryClient.setQueryData<AlertRow[]>(SK.alerts, (rows) => rows?.filter((r) => !gone.has(r.id)));
      return { prev };
    },
    onError: (e, _ids, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(SK.alerts, ctx.prev);
      toast.err(e);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SK.alerts });
      void queryClient.invalidateQueries({ queryKey: SK.alertCount });
    },
  });

  const all = alertsQ.data ?? [];
  const groups = ALERT_ORDER.map((kind) => ({ kind, rows: all.filter((a) => alertKind(a.kind, a.payload) === kind) })).filter((g) => g.rows.length > 0);
  const unknown = all.filter((a) => alertKind(a.kind, a.payload) === null);

  return (
    <div>
      <PageHeader title={tr('op.stockNav.alerts')} subtitle={tr('ws.manager.stock.alerts.lead')} />
      <AsyncStateWrapper
        status={asyncStatus(alertsQ, (d) => d.length === 0)}
        error={alertsQ.error}
        onRetry={() => void alertsQ.refetch()}
        skeleton={<TableSkeleton columns={[{ key: 'a', header: '' }, { key: 'b', header: '' }]} rows={3} />}
        emptyContent={<EmptyState kind="nothingToDo" icon="checkCircle" title={tr('ws.manager.stock.alerts.empty')} body={tr('ws.manager.stock.alerts.emptyBody')} />}
      >
        <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
          {groups.map((g) => (
            <AlertGroup
              key={g.kind}
              kind={g.kind}
              rows={g.rows}
              ingredientOf={ingredientOf}
              busyIds={dismiss.isPending ? (dismiss.variables ?? []) : []}
              onDismiss={(ids) => dismiss.mutate(ids)}
            />
          ))}
          {unknown.length > 0 && (
            <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.stock.alerts.unknown')}</p>
          )}
        </div>
      </AsyncStateWrapper>
    </div>
  );
}

function AlertGroup({
  kind,
  rows,
  ingredientOf,
  busyIds,
  onDismiss,
}: {
  kind: AlertKind;
  rows: AlertRow[];
  ingredientOf: Map<string, IngredientRow>;
  busyIds: string[];
  onDismiss: (ids: string[]) => void;
}) {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const navigate = useNavigate();
  const href = KIND_HREF[kind];

  const detail = (a: AlertRow): string => {
    const ing = a.payload.ingredient_id ? ingredientOf.get(a.payload.ingredient_id) : undefined;
    const q = (n: unknown) => (typeof n === 'number' && ing ? fmt.qty(n, ing.unit) : typeof n === 'number' ? fmt.num(n) : '—');
    const date = typeof a.payload.expiry_date === 'string' ? formatDate(new Date(`${a.payload.expiry_date}T00:00:00`), locale) : '—';
    switch (kind) {
      case 'low_stock':
        return tr('ws.manager.stock.alerts.detail.low_stock', { onHand: q(a.payload.on_hand), threshold: q(a.payload.threshold) });
      // No "reorder point" clause: an empty shelf raises this whether or not
      // the ingredient has one, and most here do not.
      case 'out_of_stock':
        return tr('ws.manager.stock.alerts.detail.out_of_stock');
      case 'negative_stock':
        return tr('ws.manager.stock.alerts.detail.negative_stock', { qty: q(a.payload.shortfall) });
      case 'expiring_soon':
        return tr('ws.manager.stock.alerts.detail.expiring_soon', { qty: q(a.payload.qty_remaining), date });
      case 'expired':
        return tr('ws.manager.stock.alerts.detail.expired', { qty: q(a.payload.qty_remaining), date });
      case 'replay_conflict':
        return tr('ws.manager.stock.alerts.detail.replay_conflict', { station: typeof a.payload.device_id === 'string' ? a.payload.device_id : '—' });
    }
  };

  const columns: Column<AlertRow>[] = [
    {
      key: 'what',
      header: kind === 'replay_conflict' ? tr('ws.manager.stock.alerts.what') : tr('op.stock.ingredient'),
      render: (a) => {
        const ing = a.payload.ingredient_id ? ingredientOf.get(a.payload.ingredient_id) : undefined;
        return (
          <span style={{ display: 'grid' }}>
            {kind !== 'replay_conflict' && <bdi style={{ fontWeight: 600 }}>{ing ? pickName(locale, ing) : tr('ws.manager.stock.alerts.unknownIngredient')}</bdi>}
            <bdi style={{ fontSize: 'var(--tp-fs-sm)', color: kind === 'replay_conflict' ? 'var(--tp-fg)' : 'var(--tp-muted-fg)' }}>{detail(a)}</bdi>
          </span>
        );
      },
    },
    { key: 'when', header: tr('ws.manager.stock.alerts.raised'), render: (a) => <bdi style={{ color: 'var(--tp-muted-fg)' }}>{formatDateTime(new Date(a.created_at), locale)}</bdi> },
    {
      key: 'dismiss',
      header: '',
      align: 'end',
      render: (a) => (
        <Button size="sm" kind="ghost" icon="check" busy={busyIds.includes(a.id)} onClick={() => onDismiss([a.id])}>
          {tr('ws.manager.stock.alerts.dismiss')}
        </Button>
      ),
    },
  ];

  return (
    <Panel
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
          <CardTitle icon={kind === 'replay_conflict' ? 'wifiOff' : kind === 'expired' || kind === 'expiring_soon' ? 'hourglass' : kind === 'out_of_stock' ? 'ban' : 'package'}>
            {tr(`ws.manager.stock.alerts.kind.${kind}`)}
          </CardTitle>
          <StatusBadge size="sm" tone={KIND_TONE[kind]} label={fmt.num(rows.length)} />
        </span>
      }
      actions={
        rows.length > 1 ? (
          <Button size="sm" kind="ghost" icon="check" onClick={() => onDismiss(rows.map((r) => r.id))}>
            {tr('ws.manager.stock.alerts.dismissAll')}
          </Button>
        ) : undefined
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', marginBlockEnd: 'var(--tp-sp-2)' }}>
        <p style={{ flex: '1 1 20rem', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0 }}>{tr(`ws.manager.stock.alerts.hint.${kind}`)}</p>
        {href && (
          <Button size="sm" iconEnd="arrowUpRight" onClick={() => void navigate({ href })}>
            {tr(`ws.manager.stock.alerts.action.${kind as Exclude<AlertKind, 'replay_conflict'>}`)}
          </Button>
        )}
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(a) => a.id} dense aria-label={tr(`ws.manager.stock.alerts.kind.${kind}`)} />
    </Panel>
  );
}

/**
 * Manager alerts (SOW L544-545 low-stock / negative stock, plus the replay
 * conflicts the sync path raises). Acknowledge is optimistic — it's an
 * idempotent flag flip that never changes stock.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button } from '../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, PageHeader, ResultCount, StatusBadge, TableSkeleton, asyncStatus, type Column, type Tone } from '../../components/kit';
import { SK, fetchIngredients } from './stockKeys';

interface AlertRow {
  id: string;
  kind: string;
  payload: { ingredient_id?: string; shortfall?: number; [k: string]: unknown };
  created_at: string;
}

const KIND_TONE: Record<string, Tone> = { negative_stock: 'danger', low_stock: 'warn', replay_conflict: 'danger' };

export function AlertsPanel() {
  const { tr, locale } = useLocale();
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
  const nameOf = new Map((ingredientsQ.data ?? []).map((i) => [i.id, i]));

  const acknowledge = useMutation({
    mutationFn: (alertId: string) => appRpc('acknowledge_alert', { p_alert_id: alertId }),
    onMutate: async (alertId) => {
      await queryClient.cancelQueries({ queryKey: SK.alerts });
      const prev = queryClient.getQueryData<AlertRow[]>(SK.alerts);
      queryClient.setQueryData<AlertRow[]>(SK.alerts, (rows) => rows?.filter((r) => r.id !== alertId));
      return { prev };
    },
    onError: (e, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(SK.alerts, ctx.prev);
      toast.err(e);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: SK.alerts }),
  });

  const alertLabel: Record<string, string> = {
    negative_stock: tr('op.stock.alertNegative'),
    low_stock: tr('op.stock.alertLow'),
    replay_conflict: tr('op.stock.alertReplay'),
  };

  const columns: Column<AlertRow>[] = [
    { key: 'kind', header: tr('op.stock.alertsTitle'), render: (a) => <StatusBadge tone={KIND_TONE[a.kind] ?? 'neutral'} label={alertLabel[a.kind] ?? a.kind} /> },
    {
      key: 'ingredient',
      header: tr('op.stock.ingredient'),
      render: (a) => {
        const ing = a.payload.ingredient_id ? nameOf.get(a.payload.ingredient_id) : null;
        return (
          <span>
            {ing ? <bdi>{pickName(locale, ing)}</bdi> : '—'}
            {typeof a.payload.shortfall === 'number' && (
              <span style={{ color: 'var(--tp-muted-fg)' }} dir="ltr">
                {' '}
                ({a.payload.shortfall})
              </span>
            )}
          </span>
        );
      },
    },
    { key: 'when', header: tr('op.stock.when'), render: (a) => <bdi>{formatDateTime(new Date(a.created_at), locale)}</bdi> },
    {
      key: 'ack',
      header: '',
      align: 'end',
      render: (a) => (
        <Button size="sm" icon="check" busy={acknowledge.isPending && acknowledge.variables === a.id} onClick={() => acknowledge.mutate(a.id)}>
          {tr('op.stock.acknowledge')}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={tr('op.stock.alertsTitle')} subtitle={tr('ws.manager.stock.alerts.lead')}>
        <ResultCount shown={alertsQ.data?.length ?? 0} total={alertsQ.data?.length ?? 0} />
      </PageHeader>
      <AsyncStateWrapper
        status={asyncStatus(alertsQ, (d) => d.length === 0)}
        error={alertsQ.error}
        onRetry={() => void alertsQ.refetch()}
        skeleton={<TableSkeleton columns={columns} rows={3} />}
        emptyContent={<EmptyState kind="nothingToDo" icon="checkCircle" title={tr('op.stock.noAlerts')} body={tr('ws.manager.stock.alerts.emptyBody')} />}
      >
        <DataTable columns={columns} rows={alertsQ.data ?? []} rowKey={(a) => a.id} aria-label={tr('op.stock.alertsTitle')} />
      </AsyncStateWrapper>
    </div>
  );
}

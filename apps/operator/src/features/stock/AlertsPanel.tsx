/**
 * Manager alerts (SOW L544-545 low-stock / negative stock, plus the replay
 * conflicts the sync path raises). Acknowledge is optimistic — it's an
 * idempotent flag flip.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, card } from '../../components/ui';
import { SK, fetchIngredients } from './stockKeys';

interface AlertRow {
  id: string;
  kind: string;
  payload: { ingredient_id?: string; shortfall?: number; [k: string]: unknown };
  created_at: string;
}

export function AlertsPanel() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const toast = useToast();

  const alertsQ = useQuery({
    queryKey: SK.alerts,
    refetchInterval: 60_000, // no realtime topic for alerts — advisory cadence
    queryFn: async (): Promise<AlertRow[]> => {
      const { data, error } = await supabase
        .from('manager_alerts')
        .select('id, kind, payload, created_at')
        .is('acknowledged_at', null)
        .order('created_at', { ascending: false });
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
      queryClient.setQueryData<AlertRow[]>(SK.alerts, (rows) =>
        rows?.filter((r) => r.id !== alertId),
      );
      return { prev };
    },
    onError: (e, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(SK.alerts, ctx.prev);
      toast.err(e);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: SK.alerts }),
  });

  const rows = alertsQ.data ?? [];

  const alertLabel: Record<string, string> = {
    negative_stock: tr('op.stock.alertNegative'),
    low_stock: tr('op.stock.alertLow'),
    replay_conflict: tr('op.stock.alertReplay'),
  };

  return (
    <div style={{ maxInlineSize: '36rem' }}>
      <h2 style={{ marginBlock: '0.4rem' }}>{tr('op.stock.alertsTitle')}</h2>
      {rows.map((a) => {
        const ing = a.payload.ingredient_id ? nameOf.get(a.payload.ingredient_id) : null;
        return (
          <div
            key={a.id}
            style={{
              ...card,
              marginBlockEnd: '0.4rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              borderInlineStart: '4px solid var(--tp-danger)',
            }}
          >
            <div style={{ flex: 1, minInlineSize: 0 }}>
              <strong>{alertLabel[a.kind] ?? a.kind}</strong>
              {ing && <> — {pickName(locale, ing)}</>}
              {typeof a.payload.shortfall === 'number' && (
                <span style={{ color: 'var(--tp-muted-fg)' }}> ({a.payload.shortfall})</span>
              )}
              <div style={{ color: 'var(--tp-muted-fg)', fontSize: '0.8rem' }}>
                {formatTime(new Date(a.created_at), locale)}
              </div>
            </div>
            <Button onClick={() => acknowledge.mutate(a.id)}>{tr('op.stock.acknowledge')}</Button>
          </div>
        );
      })}
      {alertsQ.isSuccess && rows.length === 0 && <p style={card}>{tr('op.stock.noAlerts')}</p>}
    </div>
  );
}

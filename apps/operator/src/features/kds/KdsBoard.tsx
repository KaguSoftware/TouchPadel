/**
 * KDS container — live ticket queue. Initial fetch from tables; 'kds' private
 * broadcast (0022 + 0061 item_ready) invalidates. Item-level ready marks are
 * SERVER state since 0061 (app.set_order_item_ready) — they survive a reload
 * and a second prep station sees them. Ticket lifecycle goes through
 * app.set_ticket_status; both are optimistic here (transition-idempotent
 * server-side, rollback on refusal). Completed tickets drop off 2 min after.
 *
 * Presentation lives in KitchenDisplayScreen (06.20); this file owns the
 * queries, the mutations, the clock, the alarms and the LAN fallback.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { isElectron, mutate } from '../../lib/mutate';
import { touch } from '../../ipc/bridge';
import { useLocale } from '../../lib/i18n';
import { asyncStatus, type AsyncStatus } from '../../components/kit';
import { lanTicketViews, useLanTickets, useVariantNames } from './LanBoard';
import { useKdsAlarms } from './useKdsAlarms';
import { KitchenDisplayScreen } from './KitchenDisplayScreen';
import { TICKET_SELECT, ticketViews, type TicketAction, type TicketRow } from './ticketView';

const COMPLETED_LINGER_MS = 2 * 60 * 1000;

export function KdsBoard() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  // 5 s tick: formatAge shows m:ss, so the display steps in 5 s increments —
  // invisible on a wall screen, and the whole grid re-renders 12× a minute
  // instead of 60× (audit: the 1 s tick re-rendered every unmemoized card
  // forever on the lowest-spec machine in the building). useKdsAlarms keeps
  // its own internal reconcile for the stale thresholds.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const ticketsQ = useQuery({
    queryKey: ['tickets'],
    queryFn: async (): Promise<TicketRow[]> => {
      const since = new Date(Date.now() - COMPLETED_LINGER_MS).toISOString();
      const { data, error } = await supabase
        .from('tickets')
        .select(TICKET_SELECT)
        .or(`status.in.(queued,preparing,ready),and(status.eq.completed,completed_at.gte.${since})`)
        .order('created_at');
      if (error) throw error;
      return data as unknown as TicketRow[];
    },
    refetchInterval: 30_000, // safety net under the broadcast — no control in the UI
  });

  const setStatus = useMutation({
    // Single write path (lib/mutate.ts): queued durably in Electron, direct
    // RPC in browser mode. Transition-idempotent server-side either way.
    mutationFn: (vars: { ticketId: string; status: TicketAction }) =>
      mutate('ticket.status', { ticketId: vars.ticketId, status: vars.status }),
    // Optimistic: the card moves the moment the chef taps it — a prep station
    // must never wait on a round trip. A refusal (INVALID_TRANSITION from a
    // concurrent station) rolls back and the invalidation self-heals.
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['tickets'] });
      const prev = queryClient.getQueryData<TicketRow[]>(['tickets']);
      queryClient.setQueryData<TicketRow[]>(['tickets'], (rows) =>
        rows?.map((t) =>
          t.id === vars.ticketId
            ? {
                ...t,
                status: vars.status,
                completed_at:
                  vars.status === 'completed' ? new Date().toISOString() : t.completed_at,
              }
            : t,
        ),
      );
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['tickets'], ctx.prev);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['tickets'] }),
  });

  const itemReady = useMutation({
    // Item marks are not on the offline queue (the LAN board carries whole
    // tickets while degraded); a direct RPC keeps them instant online.
    mutationFn: (vars: { orderItemId: string; ready: boolean }) =>
      appRpc('set_order_item_ready', { p_order_item_id: vars.orderItemId, p_ready: vars.ready }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['tickets'] });
      const prev = queryClient.getQueryData<TicketRow[]>(['tickets']);
      queryClient.setQueryData<TicketRow[]>(['tickets'], (rows) =>
        rows?.map((t) =>
          // Rebuild ONLY the ticket that holds the item — unchanged rows keep
          // their reference.
          t.order && t.order.order_items.some((i) => i.id === vars.orderItemId)
            ? {
                ...t,
                order: {
                  ...t.order,
                  order_items: t.order.order_items.map((i) =>
                    i.id === vars.orderItemId
                      ? { ...i, ready_at: vars.ready ? new Date().toISOString() : null }
                      : i,
                  ),
                },
              }
            : t,
        ),
      );
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['tickets'], ctx.prev);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['tickets'] }),
  });

  const rows = useMemo(() => {
    const all = ticketsQ.data ?? [];
    return all.filter(
      (t) =>
        t.status !== 'voided' &&
        (t.status !== 'completed' ||
          (t.completed_at && now - new Date(t.completed_at).getTime() < COMPLETED_LINGER_MS)),
    );
  }, [ticketsQ.data, now]);

  // Owns the 'kds' subscription (invalidates ['tickets']), chimes, stale alarms, unseen title.
  const { stale, status: connection } = useKdsAlarms(rows, tr('kds.title'));

  // Degraded fallback (design-arch §2.4): when the cloud query cannot answer,
  // the board renders LAN frames from the till instead — food keeps reaching
  // the pass. Bumps travel back over the LAN into the till's queue.
  const lanTickets = useLanTickets();
  const variantNames = useVariantNames();
  const lanFallback = ticketsQ.isError && isElectron();

  const tickets = useMemo(
    () =>
      lanFallback
        ? lanTicketViews(lanTickets, variantNames, now, locale)
        : ticketViews(rows, now, stale, locale),
    [lanFallback, lanTickets, variantNames, rows, now, stale, locale],
  );

  const status: AsyncStatus = lanFallback
    ? tickets.length === 0
      ? 'empty'
      : 'ready'
    : asyncStatus(ticketsQ, () => rows.length === 0);

  const onStatus = useCallback(
    (ticketId: string, next: TicketAction) => {
      if (lanFallback) touch.sendLanStatus({ ref: ticketId, status: next });
      else setStatus.mutate({ ticketId, status: next });
    },
    [lanFallback, setStatus],
  );
  const onItemReady = useCallback(
    (_ticketId: string, itemId: string, ready: boolean) =>
      itemReady.mutate({ orderItemId: itemId, ready }),
    [itemReady],
  );
  const retry = useCallback(() => void ticketsQ.refetch(), [ticketsQ]);

  return (
    <KitchenDisplayScreen
      status={status}
      tickets={tickets}
      connection={connection}
      staleCount={stale.size}
      nowMs={now}
      degraded={lanFallback}
      error={ticketsQ.error}
      actionError={setStatus.error ?? itemReady.error}
      busyTicketId={setStatus.isPending ? setStatus.variables.ticketId : null}
      onRetry={retry}
      onStatus={onStatus}
      onItemReady={onItemReady}
    />
  );
}

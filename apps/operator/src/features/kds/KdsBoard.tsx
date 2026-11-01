/**
 * KDS container — live ticket queue. Initial fetch through app.kitchen_board
 * (money-free, build-contracts-2026-09-23 §2.23); 'kds' private broadcast
 * (0022 + 0061 item_ready) invalidates. Item-level ready marks are
 * SERVER state since 0061 (app.set_order_item_ready) — they survive a reload
 * and a second prep station sees them. Ticket lifecycle goes through
 * app.set_ticket_status; both are optimistic here (transition-idempotent
 * server-side, rollback on refusal). Completed tickets drop off 2 min after,
 * and stay under "Just completed" for ten minutes, where Bring back undoes
 * Complete (F-57, app.recall_ticket through the queue: it works offline).
 *
 * F-11: the board tells the till's side what it drew (useKdsAck: cloud
 * tickets → app.kds_ack_tickets, LAN tickets → the till), and while the TILL
 * has no internet but this board does, the till's orders that have not reached
 * the server yet are shown from the LAN beside the cloud ones.
 *
 * Presentation lives in KitchenDisplayScreen (06.20); this file owns the
 * queries, the mutations, the clock, the alarms and the LAN fallback.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MessageKey } from '@touch/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { appRpc } from '../../lib/appRpc';
import { isElectron, mutate } from '../../lib/mutate';
import { touch } from '../../ipc/bridge';
import { useLocale } from '../../lib/i18n';
import { can, canAccess, useAuth } from '../../lib/auth';
import { QK } from '../../lib/queryKeys';
import { useWorkspaceOrNull } from '../../routes/__root';
import { WORKSPACES, workspaceHome, type WorkspaceKey } from '../../lib/workspaces';
import { asyncStatus, type AsyncStatus } from '../../components/kit';
import { lanTicketViews, useLanState, useLanTickets, useVariantNames } from './LanBoard';
import { isLanRef, lanNotice, lanOnlyTickets, refusalMessageKey } from './lanState';
import { forgetRecalled, minutesSinceCompleted, recallCandidates, rememberCompleted } from './recall';
import { useKdsAck } from './useKdsAck';
import { tagLabel } from './TicketList';
import type { RecallItem } from './RecallStrip';
import { queueRpc } from '../../lib/queuedRpc';
import { deviceId } from '../../lib/idem';
import { useKdsAlarms } from './useKdsAlarms';
import { KitchenDisplayScreen } from './KitchenDisplayScreen';
import {
  BOARD_REFETCH_MS,
  COMPLETED_LINGER_MS,
  ticketViewFromRow,
  ticketViews,
  type TicketAction,
  type TicketRow,
} from './ticketView';
import { TK } from '../tasks/keys';
import { fetchMyWork } from '../tasks/api';
import { kitchenTaskCount } from '../tasks/tasksLogic';
import { fetchIdeasToReview } from '../roleExtras/api';
import { ideasWaiting } from '../roleExtras/roleExtrasLogic';
import { useGuideOrNull } from '../guide/GuideProvider';


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
      // The server fixes the completed window (the same two minutes as
      // COMPLETED_LINGER_MS) and takes no argument to widen it. p_venue_id null:
      // the operator holds no venue of its own, so the board shows every venue
      // the signed-in staff member works at, as the tickets select did.
      const { tickets } = await appRpc<{ tickets: TicketRow[] }>('kitchen_board', { p_venue_id: null });
      return tickets;
    },
    refetchInterval: BOARD_REFETCH_MS, // safety net under the broadcast — no control in the UI
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
      // Only THIS ticket is remembered and restored: putting back the whole
      // list undid any other bump made while this one was in flight.
      const prevTicket = queryClient.getQueryData<TicketRow[]>(['tickets'])?.find((t) => t.id === vars.ticketId);
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
      return { prevTicket };
    },
    onError: (_e, vars, ctx) => {
      const prevTicket = ctx?.prevTicket;
      if (prevTicket) {
        queryClient.setQueryData<TicketRow[]>(['tickets'], (rows) => rows?.map((t) => (t.id === vars.ticketId ? prevTicket : t)));
      }
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
      const prevReadyAt = queryClient
        .getQueryData<TicketRow[]>(['tickets'])
        ?.flatMap((t) => t.order?.order_items ?? [])
        .find((i) => i.id === vars.orderItemId)?.ready_at;
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
      return { prevReadyAt };
    },
    onError: (_e, vars, ctx) => {
      // Put back this one item's mark only, as the status bump does.
      if (!ctx || ctx.prevReadyAt === undefined) return;
      const readyAt = ctx.prevReadyAt;
      queryClient.setQueryData<TicketRow[]>(['tickets'], (rows) =>
        rows?.map((t) =>
          t.order && t.order.order_items.some((i) => i.id === vars.orderItemId)
            ? { ...t, order: { ...t.order, order_items: t.order.order_items.map((i) => (i.id === vars.orderItemId ? { ...i, ready_at: readyAt } : i)) } }
            : t,
        ),
      );
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
  const lan = useLanState();
  const lanTickets = useLanTickets(lan);
  const variantNames = useVariantNames();
  const lanFallback = ticketsQ.isError && isElectron();
  // F-11: on the cloud board, the till's orders still waiting in ITS queue.
  const lanOnly = useMemo(() => (isElectron() && !lanFallback ? lanOnlyTickets(lan) : []), [lan, lanFallback]);

  const tickets = useMemo(() => {
    if (lanFallback) return lanTicketViews(lanTickets, variantNames, now, locale);
    const cloud = ticketViews(rows, now, stale, locale);
    if (lanOnly.length === 0) return cloud;
    return [...cloud, ...lanTicketViews(lanOnly, variantNames, now, locale)].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }, [lanFallback, lanTickets, lanOnly, variantNames, rows, now, stale, locale]);

  const status: AsyncStatus = lanFallback
    ? tickets.length === 0
      ? 'empty'
      : 'ready'
    : asyncStatus(ticketsQ, () => rows.length === 0 && lanOnly.length === 0);

  // F-11: say what this board has drawn, once per ticket.
  const drawn = status === 'ready' ? tickets.map((t) => t.id) : [];
  useKdsAck(
    drawn.filter((id) => !isLanRef(id)),
    drawn.filter(isLanRef),
    lan.link,
  );

  const onStatus = useCallback(
    (ticketId: string, next: TicketAction) => {
      // A LAN ticket's bump goes to the till, which queues it (single writer).
      if (lanFallback || isLanRef(ticketId)) touch.sendLanStatus({ ref: ticketId, status: next });
      else setStatus.mutate({ ticketId, status: next });
    },
    [lanFallback, setStatus],
  );

  // ---- F-57: Bring back a ticket completed by mistake (ten minutes) ---------
  // Only on the cloud board. A LAN ticket cannot be recalled: the LAN carries
  // the till's order key, not the server's ticket id app.recall_ticket takes,
  // and the till's queue replays a LAN bump as set_ticket_status, whose
  // transition table has no way back from completed. So the strip is hidden
  // while the board works from the LAN, rather than offering a button that
  // would be refused later.
  const [recallMem, setRecallMem] = useState<ReadonlyMap<string, TicketRow>>(() => new Map());
  useEffect(() => {
    setRecallMem((m) => rememberCompleted(m, ticketsQ.data ?? [], now));
  }, [ticketsQ.data, now]);
  const [recallQueued, setRecallQueued] = useState(false);
  const recall = useMutation({
    mutationFn: (ticketId: string) => queueRpc('recall_ticket', { p_ticket_id: ticketId, p_device_id: deviceId() }),
    onMutate: (ticketId) => {
      const row = recallMem.get(ticketId);
      setRecallQueued(false);
      setRecallMem((m) => forgetRecalled(m, ticketId));
      // The card comes back at once when the board still holds it.
      queryClient.setQueryData<TicketRow[]>(['tickets'], (rs) =>
        rs?.map((t) => (t.id === ticketId ? { ...t, status: 'ready', completed_at: null } : t)),
      );
      return { row };
    },
    onSuccess: (out) => setRecallQueued(out.queued),
    onError: (_e, ticketId, ctx) => {
      const row = ctx?.row;
      if (row) setRecallMem((m) => new Map(m).set(ticketId, row));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['tickets'] }),
  });
  const recallItems = useMemo<RecallItem[]>(
    () =>
      recallCandidates(recallMem, now).map((row) => {
        const view = ticketViewFromRow(row, now, false, locale);
        return {
          id: row.id,
          label: tagLabel(view, tr),
          summary: view.items.map((i) => `${i.qty}× ${i.name}`).join(' · '),
          minutesAgo: minutesSinceCompleted(row, now),
        };
      }),
    [recallMem, now, locale, tr],
  );
  const lanRefusal: MessageKey | null = isElectron() ? refusalMessageKey(lan.refusal, now) : null;
  const onItemReady = useCallback(
    (_ticketId: string, itemId: string, ready: boolean) =>
      itemReady.mutate({ orderItemId: itemId, ready }),
    [itemReady],
  );
  const retry = useCallback(() => void ticketsQ.refetch(), [ticketsQ]);

  // The way off the board. The prep workspace renders no rail on purpose (a
  // wall screen has nothing to get lost in), so anyone who holds ANOTHER
  // workspace — a cashier covering the pass, a manager who followed a link —
  // had no route back at all. One header button, and only for them: a
  // prep-only account still sees a board with no navigation on it.
  const navigate = useNavigate();
  const workspace = useWorkspaceOrNull();
  const exitTo = useMemo(() => {
    // workspacesForRole lists the role's OWN workspace first, so dropping prep
    // leaves the place this account started in at the head of the list.
    const others: readonly WorkspaceKey[] = (workspace?.available ?? []).filter((key) => key !== 'prep');
    return others[0] ?? null;
  }, [workspace]);
  const several = (workspace?.available.length ?? 0) > 2;

  // "My tasks (N)" for the bar and kitchen roles (build-contracts-2026-09-23
  // §5.1, §5.4): the board is their only screen, and /tasks holds their
  // protocol steps and the read-only copy of their phone pages. N is what is
  // theirs to do, plus the ideas a head has to review. Prep, the manager and
  // the owner open no /tasks, so their board gets no button.
  const { staff } = useAuth();
  const hasTasks = canAccess(staff, '/tasks');
  const workQ = useQuery({ queryKey: TK.work, queryFn: fetchMyWork, enabled: hasTasks, refetchInterval: 60_000 });
  const ideasQ = useQuery({
    queryKey: QK.ideasToReview,
    queryFn: fetchIdeasToReview,
    enabled: hasTasks && can(staff, 'reviewIdeas'),
    refetchInterval: 60_000,
  });
  const taskCount = kitchenTaskCount(workQ.data, ideasWaiting(ideasQ.data));
  // /tasks keeps the navless workspace, and its header leads back here.
  const onTasks = useCallback(() => void navigate({ to: '/tasks', search: {} }), [navigate]);
  const onExit = useCallback(() => {
    if (!exitTo) return;
    // Leave the WORKSPACE, not just the route. The prep workspace carries the
    // dark board theme on [data-workspace='prep'], and /workspaces is a shared
    // route that workspaceForRoute maps to nothing — so navigating without
    // this left the light switcher tiles sitting on the black KDS background
    // with their titles inheriting --tp-kds-fg, i.e. invisible.
    workspace?.setActive(exitTo);
    // Several to choose from and nothing here knows which they want, so the
    // switcher asks. The active workspace is already theirs by then, so it
    // renders in the desk palette and "You are here" points at the right tile.
    void navigate({ to: several ? '/workspaces' : workspaceHome(WORKSPACES[exitTo], (p) => canAccess(staff, p)) });
  }, [exitTo, several, navigate, workspace, staff]);
  // The shell's workspace guide: the legend's pill and the `?` key.
  const guide = useGuideOrNull();

  return (
    <KitchenDisplayScreen
      status={status}
      tickets={tickets}
      connection={connection}
      staleCount={stale.size}
      nowMs={now}
      degraded={lanFallback}
      lanLinkDown={lanNotice(lanFallback, lan.link) === 'linkDown'}
      lanRefusal={lanRefusal}
      recall={
        lanFallback
          ? undefined
          : {
              items: recallItems,
              busyId: recall.isPending ? recall.variables : null,
              queued: recallQueued,
              onRecall: (id) => recall.mutate(id),
            }
      }
      error={ticketsQ.error}
      actionError={setStatus.error ?? itemReady.error ?? recall.error}
      busyTicketId={setStatus.isPending ? setStatus.variables.ticketId : null}
      onRetry={retry}
      onStatus={onStatus}
      onItemReady={onItemReady}
      onExit={exitTo ? onExit : undefined}
      tasks={hasTasks ? { count: taskCount, onOpen: onTasks } : undefined}
      onGuide={guide?.available ? guide.openGuide : undefined}
    />
  );
}


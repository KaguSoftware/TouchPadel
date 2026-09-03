/**
 * KDS — live ticket queue. Initial fetch from tables; 'kds' private broadcast
 * (0022 + 0061 item_ready) invalidates. Item-level ready marks are SERVER
 * state since 0061 (app.set_order_item_ready) — they survive a reload and a
 * second prep station sees them. Ticket lifecycle goes through
 * app.set_ticket_status; both are optimistic here (transition-idempotent
 * server-side, rollback on refusal). Completed tickets drop off 2 min after.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { isElectron, mutate } from '../../lib/mutate';
import { LanBoard, useLanTickets } from './LanBoard';
import { useLocale, pickName } from '../../lib/i18n';
import { StartShiftBanner } from '../../lib/audio';
import { Button, ErrorText, card } from '../../components/ui';
import { ConnectionPill } from '../../components/ConnectionPill';
import { ageColor, ageColorVar, formatAge } from './ageColor';
import { useKdsAlarms } from './useKdsAlarms';

const COMPLETED_LINGER_MS = 2 * 60 * 1000;

interface TicketRow {
  id: string;
  status: 'queued' | 'preparing' | 'ready' | 'completed' | 'voided';
  target_seconds: number;
  created_at: string;
  completed_at: string | null;
  /** 'Telegram: Ahmed' when a tap moved the ticket (0032). */
  last_actor_label: string | null;
  order: {
    id: string;
    source: 'guest_web' | 'till';
    status: string;
    tab: {
      id: string;
      label: string | null;
      table: { table_number: string } | null;
      reservation: { id: string; guest_name: string | null } | null;
    } | null;
    order_items: {
      id: string;
      qty: number;
      notes: string | null;
      voided: boolean;
      ready_at: string | null;
      menu_item: { name_en: string; name_ar: string } | null;
      variant: { name_en: string; name_ar: string } | null;
      order_item_modifiers: {
        qty: number;
        modifier: { name_en: string; name_ar: string } | null;
      }[];
    }[];
  } | null;
}

const TICKET_SELECT = `id, status, target_seconds, created_at, completed_at, last_actor_label,
  order:orders (
    id, source, status,
    tab:tabs ( id, label, table:cafe_tables ( table_number ),
               reservation:reservations ( id, guest_name ) ),
    order_items (
      id, qty, notes, voided, ready_at,
      menu_item:menu_items ( name_en, name_ar ),
      variant:menu_item_variants ( name_en, name_ar ),
      order_item_modifiers ( qty, modifier:modifiers ( name_en, name_ar ) )
    )
  )`;

export function KdsBoard() {
  const { tr } = useLocale();
  const queryClient = useQueryClient();
  // 5 s tick: formatAge shows m:ss, so the display steps in 5 s increments —
  // invisible on a wall screen, and the whole grid re-renders 12× a minute
  // instead of 60× (audit: the 1 s tick re-rendered every unmemoized card
  // forever on the lowest-spec machine in the building). useKdsAlarms keeps
  // its own internal 1 s reconcile for the stale thresholds.
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
    refetchInterval: 30_000, // safety net under the broadcast
  });

  const setStatus = useMutation({
    // Single write path (lib/mutate.ts): queued durably in Electron, direct
    // RPC in browser mode. Transition-idempotent server-side either way.
    mutationFn: (vars: { ticketId: string; status: 'preparing' | 'ready' | 'completed' }) =>
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
          // their reference, so the memoized cards skip re-rendering.
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

  const tickets = useMemo(() => {
    const rows = ticketsQ.data ?? [];
    return rows.filter(
      (t) =>
        t.status !== 'voided' &&
        (t.status !== 'completed' ||
          (t.completed_at && now - new Date(t.completed_at).getTime() < COMPLETED_LINGER_MS)),
    );
  }, [ticketsQ.data, now]);

  // Owns the 'kds' subscription (invalidates ['tickets']), chimes, stale alarms, unseen title.
  const { stale, status } = useKdsAlarms(tickets, tr('kds.title'));

  // Degraded fallback (design-arch §2.4): when the cloud query cannot answer,
  // the board renders LAN frames from the till instead — food keeps reaching
  // the pass. Bumps travel back over the LAN into the till's queue.
  const lanTickets = useLanTickets();
  const lanFallback = ticketsQ.isError && isElectron();

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.6rem',
          marginBlockEnd: '0.6rem',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '1.3rem' }}>{tr('kds.title')}</h1>
        <ConnectionPill status={status} />
      </div>
      <StartShiftBanner />
      {stale.size > 0 && (
        <div
          role="alert"
          data-testid="stale-banner"
          style={{
            ...card,
            marginBlockEnd: '0.6rem',
            borderInlineStart: '6px solid var(--tp-danger)',
            color: 'var(--tp-danger)',
            fontWeight: 700,
          }}
        >
          ⚠ {tr('op.kds.staleBanner', { count: stale.size })}
        </div>
      )}
      <ErrorText error={setStatus.error} />
      {lanFallback && <LanBoard tickets={lanTickets} />}
      {!lanFallback && tickets.length === 0 && <p style={card}>{tr('op.kds.empty')}</p>}
      <div
        style={{
          display: lanFallback ? 'none' : 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))',
          gap: '0.7rem',
        }}
      >
        {tickets.map((t) => (
          <TicketCard
            key={t.id}
            t={t}
            now={now}
            isStale={stale.has(t.id)}
            onStatus={setStatus.mutate}
            onItemReady={itemReady.mutate}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One ticket. memo'd so the board scales: between the 5 s ticks only the card
 * whose ticket object changed (an optimistic mark, a broadcast refresh of one
 * row) re-renders — the query patches keep unchanged rows referentially equal.
 */
const TicketCard = memo(function TicketCard({
  t,
  now,
  isStale,
  onStatus,
  onItemReady,
}: {
  t: TicketRow;
  now: number;
  isStale: boolean;
  onStatus: (vars: { ticketId: string; status: 'preparing' | 'ready' | 'completed' }) => void;
  onItemReady: (vars: { orderItemId: string; ready: boolean }) => void;
}) {
  const { tr, locale } = useLocale();
  const ageSec = (now - new Date(t.created_at).getTime()) / 1000;
  const color = ageColor(ageSec, t.target_seconds);
  const items = (t.order?.order_items ?? []).filter((i) => !i.voided);
  const isGuest = t.order?.source === 'guest_web';

  const tabInfo = t.order?.tab;
  const tag = tabInfo?.table
    ? tr('op.kds.table', { table: tabInfo.table.table_number })
    : tabInfo?.reservation
      ? `${tr('op.kds.court')} · ${tabInfo.reservation.guest_name ?? ''}`.trim()
      : (tabInfo?.label ?? '—');

  const statusLabel: Record<string, string> = {
    queued: tr('op.kds.statusQueued'),
    preparing: tr('op.kds.statusPreparing'),
    ready: tr('op.kds.statusReady'),
    completed: tr('op.kds.statusCompleted'),
  };

  return (
    <div
      data-stale={isStale || undefined}
      style={{
        ...card,
        borderBlockStart: `6px solid ${t.status === 'completed' ? 'var(--tp-muted)' : ageColorVar(color)}`,
        opacity: t.status === 'completed' ? 0.6 : 1,
        ...(isStale
          ? {
              border: '2px solid var(--tp-danger)',
              borderBlockStart: '6px solid var(--tp-danger)',
              animation: 'tpPulse 1.2s infinite',
            }
          : {}),
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>{tag}</strong>
        <span
          style={{
            fontVariantNumeric: 'tabular-nums',
            color: t.status === 'completed' ? 'var(--tp-muted-fg)' : ageColorVar(color),
            fontWeight: 700,
          }}
        >
          {formatAge(ageSec)}
        </span>
      </div>
      <div
        style={{
          fontSize: '0.78rem',
          color: 'var(--tp-muted-fg)',
          marginBlockEnd: '0.4rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '0.3rem',
        }}
      >
        <span
          style={{
            background: isGuest ? 'var(--tp-accent)' : 'var(--tp-muted)',
            color: isGuest ? 'var(--tp-accent-contrast)' : 'var(--tp-muted-fg)',
            borderRadius: '999px',
            paddingInline: '0.45rem',
            fontWeight: 700,
            fontSize: '0.72rem',
          }}
        >
          {isGuest ? tr('op.kds.sourceGuest') : tr('op.kds.sourceTill')}
        </span>
        {isStale && (
          <span style={{ color: 'var(--tp-danger)', fontWeight: 700 }}>{tr('op.kds.stale')}</span>
        )}
        {' · '}
        {statusLabel[t.status] ?? t.status}
        {t.last_actor_label && ` (${t.last_actor_label})`}
        {' · '}
        {tr('op.kds.ageTarget', { minutes: Math.round(t.target_seconds / 60) })}
        {' · '}
        {formatTime(new Date(t.created_at), locale)}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((i) => {
          const marked = i.ready_at !== null;
          return (
            <li key={i.id} style={{ marginBlockEnd: '0.3rem' }}>
              <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'baseline' }}>
                <input
                  type="checkbox"
                  checked={marked}
                  // Server state since 0061 — survives reloads, converges on
                  // every station; disabled once the ticket is history.
                  disabled={t.status === 'completed'}
                  onChange={() => onItemReady({ orderItemId: i.id, ready: !marked })}
                />
                <span style={{ textDecoration: marked ? 'line-through' : 'none' }}>
                  <strong>{i.qty}×</strong> {pickName(locale, i.menu_item)}
                  {i.variant && ` (${pickName(locale, i.variant)})`}
                  {i.order_item_modifiers.length > 0 && (
                    <span style={{ color: 'var(--tp-muted-fg)' }}>
                      {' — '}
                      {i.order_item_modifiers
                        .map((m) => `${m.qty > 1 ? `${m.qty}× ` : ''}${pickName(locale, m.modifier)}`)
                        .join(', ')}
                    </span>
                  )}
                  {i.notes && (
                    <em style={{ display: 'block', color: 'var(--tp-muted-fg)' }}>{i.notes}</em>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div style={{ display: 'flex', gap: '0.4rem', marginBlockStart: '0.5rem' }}>
        {t.status === 'queued' && (
          <Button kind="primary" onClick={() => onStatus({ ticketId: t.id, status: 'preparing' })}>
            {tr('op.kds.start')}
          </Button>
        )}
        {(t.status === 'queued' || t.status === 'preparing') && (
          <Button kind="primary" onClick={() => onStatus({ ticketId: t.id, status: 'ready' })}>
            {tr('op.kds.ready')}
          </Button>
        )}
        {t.status === 'ready' && (
          <Button onClick={() => onStatus({ ticketId: t.id, status: 'completed' })}>
            {tr('op.kds.complete')}
          </Button>
        )}
      </div>
    </div>
  );
});

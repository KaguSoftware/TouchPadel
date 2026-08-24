/**
 * KDS — live ticket queue. Initial fetch from tables; 'kds' private broadcast
 * (0022) invalidates. Item-level ready marks are LOCAL only; ticket lifecycle
 * goes through app.set_ticket_status (0015). Completed tickets drop off 2 min
 * after completion.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { deviceId } from '../../lib/idem';
import { useBroadcast } from '../../lib/realtime';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, ErrorText, card } from '../../components/ui';
import { ageColor, ageColorVar, formatAge } from './ageColor';

const COMPLETED_LINGER_MS = 2 * 60 * 1000;

interface TicketRow {
  id: string;
  status: 'queued' | 'preparing' | 'ready' | 'completed' | 'voided';
  target_seconds: number;
  created_at: string;
  completed_at: string | null;
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
      menu_item: { name_en: string; name_ar: string } | null;
      variant: { name_en: string; name_ar: string } | null;
      order_item_modifiers: {
        qty: number;
        modifier: { name_en: string; name_ar: string } | null;
      }[];
    }[];
  } | null;
}

const TICKET_SELECT = `id, status, target_seconds, created_at, completed_at,
  order:orders (
    id, source, status,
    tab:tabs ( id, label, table:cafe_tables ( table_number ),
               reservation:reservations ( id, guest_name ) ),
    order_items (
      id, qty, notes, voided,
      menu_item:menu_items ( name_en, name_ar ),
      variant:menu_item_variants ( name_en, name_ar ),
      order_item_modifiers ( qty, modifier:modifiers ( name_en, name_ar ) )
    )
  )`;

export function KdsBoard() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const [readyItems, setReadyItems] = useState<Set<string>>(new Set()); // local item-level marks

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
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

  useBroadcast({
    topic: 'kds',
    isPrivate: true,
    events: ['ticket_created', 'ticket_status'],
    invalidateKeys: [['tickets']],
  });

  const setStatus = useMutation({
    mutationFn: (vars: { ticketId: string; status: 'preparing' | 'ready' | 'completed' }) =>
      appRpc('set_ticket_status', {
        p_ticket_id: vars.ticketId,
        p_status: vars.status,
        p_device_id: deviceId(),
      }),
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

  function tag(t: TicketRow): string {
    const tab = t.order?.tab;
    if (tab?.table) return tr('op.kds.table', { table: tab.table.table_number });
    if (tab?.reservation)
      return `${tr('op.kds.court')} · ${tab.reservation.guest_name ?? ''}`.trim();
    return tab?.label ?? '—';
  }

  const statusLabel: Record<string, string> = {
    queued: tr('op.kds.statusQueued'),
    preparing: tr('op.kds.statusPreparing'),
    ready: tr('op.kds.statusReady'),
    completed: tr('op.kds.statusCompleted'),
  };

  return (
    <div>
      <h1 style={{ marginBlockStart: 0, fontSize: '1.3rem' }}>{tr('kds.title')}</h1>
      <ErrorText error={setStatus.error} />
      {tickets.length === 0 && <p style={card}>{tr('op.kds.empty')}</p>}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))',
          gap: '0.7rem',
        }}
      >
        {tickets.map((t) => {
          const ageSec = (now - new Date(t.created_at).getTime()) / 1000;
          const color = ageColor(ageSec, t.target_seconds);
          const items = (t.order?.order_items ?? []).filter((i) => !i.voided);
          return (
            <div
              key={t.id}
              style={{
                ...card,
                borderBlockStart: `6px solid ${t.status === 'completed' ? 'var(--tp-muted)' : ageColorVar(color)}`,
                opacity: t.status === 'completed' ? 0.6 : 1,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong>{tag(t)}</strong>
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
              <div style={{ fontSize: '0.78rem', color: 'var(--tp-muted-fg)', marginBlockEnd: '0.4rem' }}>
                {t.order?.source === 'guest_web' ? tr('op.kds.sourceGuest') : tr('op.kds.sourceTill')}
                {' · '}
                {statusLabel[t.status] ?? t.status}
                {' · '}
                {tr('op.kds.ageTarget', { minutes: Math.round(t.target_seconds / 60) })}
                {' · '}
                {formatTime(new Date(t.created_at), locale)}
              </div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {items.map((i) => {
                  const marked = readyItems.has(i.id);
                  return (
                    <li key={i.id} style={{ marginBlockEnd: '0.3rem' }}>
                      <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'baseline' }}>
                        <input
                          type="checkbox"
                          checked={marked}
                          onChange={() =>
                            setReadyItems((prev) => {
                              const next = new Set(prev);
                              if (next.has(i.id)) next.delete(i.id);
                              else next.add(i.id);
                              return next;
                            })
                          }
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
                  <Button
                    kind="primary"
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ ticketId: t.id, status: 'preparing' })}
                  >
                    {tr('op.kds.start')}
                  </Button>
                )}
                {(t.status === 'queued' || t.status === 'preparing') && (
                  <Button
                    kind="primary"
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ ticketId: t.id, status: 'ready' })}
                  >
                    {tr('op.kds.ready')}
                  </Button>
                )}
                {t.status === 'ready' && (
                  <Button
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ ticketId: t.id, status: 'completed' })}
                  >
                    {tr('op.kds.complete')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

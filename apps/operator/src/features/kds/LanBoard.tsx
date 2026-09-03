/**
 * LAN fallback board — what the kitchen sees when the cloud path is down
 * (design-arch §2.4, drill step "tickets reach the separate KDS machine over
 * the LAN socket"). Tickets arrive as frames from the till's LAN server;
 * identity is the order envelope's key. Item names resolve from the cached
 * menu — frames carry variant ids only.
 */
import { useEffect, useMemo, useState } from 'react';
import { formatTime } from '@touch/i18n';
import { touch, type KitchenTicket } from '../../ipc/bridge';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, card } from '../../components/ui';

interface VariantNameRow {
  id: string;
  name_en: string;
  name_ar: string;
}

/** variantId → bilingual name, from the shell's cached menu payload. */
function useVariantNames(): Map<string, VariantNameRow> {
  const [names, setNames] = useState<Map<string, VariantNameRow>>(new Map());
  useEffect(() => {
    let cancelled = false;
    touch
      .getCachedRef('menu')
      .then((hit) => {
        if (cancelled || !hit) return;
        const payload = hit.payload as {
          items?: { name_en: string; name_ar: string; menu_item_variants?: VariantNameRow[] }[];
        };
        const map = new Map<string, VariantNameRow>();
        for (const item of payload.items ?? []) {
          for (const v of item.menu_item_variants ?? []) {
            map.set(v.id, { id: v.id, name_en: item.name_en, name_ar: item.name_ar });
          }
        }
        setNames(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return names;
}

export function useLanTickets(): KitchenTicket[] {
  const [tickets, setTickets] = useState<Map<string, KitchenTicket>>(new Map());
  useEffect(
    () =>
      touch.onLanTicket((frame) => {
        setTickets((prev) => {
          const next = new Map(prev);
          if (frame.type === 'ticket.snapshot') {
            next.clear();
            for (const t of frame.data) next.set(t.ref, t);
          } else if (frame.type === 'ticket.new') {
            next.set(frame.data.ref, frame.data);
          } else if (frame.type === 'status.update') {
            const existing = next.get(frame.data.ref);
            if (existing) next.set(frame.data.ref, { ...existing, status: frame.data.status });
          }
          return next;
        });
      }),
    [],
  );
  return useMemo(
    () =>
      [...tickets.values()]
        .filter((t) => t.status !== 'completed')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [tickets],
  );
}

export function LanBoard({ tickets }: { tickets: KitchenTicket[] }) {
  const { tr, locale } = useLocale();
  const names = useVariantNames();

  if (tickets.length === 0) {
    return <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('op.kds.lanEmpty')}</p>;
  }

  return (
    <div>
      <p style={{ color: 'var(--tp-muted-fg)', fontSize: '0.85rem' }}>{tr('op.kds.lanMode')}</p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(14rem, 1fr))',
          gap: '0.6rem',
        }}
      >
        {tickets.map((t) => (
          <div key={t.ref} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
              <span>{t.tabLabel ?? `#${t.ref.slice(-6)}`}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatTime(new Date(t.createdAt), locale)}
              </span>
            </div>
            <ul style={{ marginBlock: '0.3rem', paddingInlineStart: '1.2rem' }}>
              {t.items.map((it, i) => {
                const name = names.get(it.variantId);
                return (
                  <li key={i} style={{ fontSize: '0.9rem' }}>
                    {it.qty}× {name ? pickName(locale, name) : it.variantId.slice(0, 8)}
                    {it.notes ? ` — ${it.notes}` : ''}
                  </li>
                );
              })}
            </ul>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {t.status === 'queued' && (
                <Button
                  kind="primary"
                  onClick={() => touch.sendLanStatus({ ref: t.ref, status: 'preparing' })}
                >
                  {tr('op.kds.start')}
                </Button>
              )}
              {t.status === 'preparing' && (
                <Button
                  kind="primary"
                  onClick={() => touch.sendLanStatus({ ref: t.ref, status: 'ready' })}
                >
                  {tr('op.kds.ready')}
                </Button>
              )}
              {t.status === 'ready' && (
                <Button onClick={() => touch.sendLanStatus({ ref: t.ref, status: 'completed' })}>
                  {tr('op.kds.complete')}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

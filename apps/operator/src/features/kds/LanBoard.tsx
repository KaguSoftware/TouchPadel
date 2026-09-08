/**
 * LAN fallback — what the kitchen sees when the cloud path is down
 * (design-arch §2.4, drill step "tickets reach the separate KDS machine over
 * the LAN socket"). Tickets arrive as frames from the till's LAN server;
 * identity is the order envelope's key. Item names resolve from the cached
 * menu — frames carry variant ids only.
 *
 * Rendering is the same TicketList as the cloud path: the frames are mapped
 * to TicketView here (`lanTicketViews`) and KdsBoard swaps the list while
 * degraded. Bumps travel back over the LAN through `touch.sendLanStatus`.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Locale } from '@touch/i18n';
import { touch, type KitchenTicket } from '../../ipc/bridge';
import { pickName } from '../../lib/i18n';
import { ageState } from './ageColor';
import { isStale } from './alarms';
import type { TicketView } from './ticketView';

interface VariantNameRow {
  id: string;
  name_en: string;
  name_ar: string;
}

/** variantId → bilingual name, from the shell's cached menu payload. */
export function useVariantNames(): Map<string, VariantNameRow> {
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

/**
 * LAN frames as board view models. No target travels over the LAN, so the age
 * state falls back to the generic 5/10-minute thresholds; item marks are
 * server state (0061) and stay off until the cloud is back.
 */
export function lanTicketViews(
  tickets: readonly KitchenTicket[],
  names: ReadonlyMap<string, VariantNameRow>,
  nowMs: number,
  locale: Locale,
): TicketView[] {
  return tickets.map((t) => {
    const createdMs = new Date(t.createdAt).getTime();
    const ageSeconds = (nowMs - createdMs) / 1000;
    return {
      id: t.ref,
      status: t.status,
      source: 'till',
      tag: { kind: 'label', label: t.tabLabel ?? `#${t.ref.slice(-6)}` },
      createdAt: t.createdAt,
      ageSeconds,
      targetSeconds: 0,
      ageState: ageState(ageSeconds, 0),
      stale: isStale({ id: t.ref, pending: t.status === 'queued', createdMs }, nowMs),
      actorLabel: null,
      items: t.items.map((it, i) => {
        const name = names.get(it.variantId);
        return {
          id: `${t.ref}:${i}`,
          qty: it.qty,
          name: name ? pickName(locale, name) : it.variantId.slice(0, 8),
          variant: null,
          modifiers: [],
          notes: it.notes ?? null,
          ready: false,
        };
      }),
      canMarkItems: false,
    };
  });
}

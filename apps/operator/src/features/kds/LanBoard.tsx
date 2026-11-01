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
import { EMPTY_LAN, lanOpenTickets, reduceLanFrame, type LanBoardState } from './lanState';
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

/**
 * The till's LAN frames as board state (lanState.ts): tickets, the link to
 * the till, and the last bump that did not land. The link's first value is
 * asked for (a `link` frame may have gone by before this mounted).
 */
export function useLanState(): LanBoardState {
  const [state, setState] = useState<LanBoardState>(EMPTY_LAN);
  useEffect(() => {
    const unsub = touch.onLanTicket((frame) => setState((prev) => reduceLanFrame(prev, frame, Date.now())));
    let cancelled = false;
    touch
      .getLanLink()
      .then((up) => {
        if (cancelled) return;
        // Only fill the gap: a frame that already arrived is newer.
        setState((prev) => (prev.link === undefined ? { ...prev, link: up } : prev));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);
  return state;
}

/** The open LAN tickets, oldest first (the board while it has no internet). */
export function useLanTickets(state: LanBoardState): KitchenTicket[] {
  return useMemo(() => lanOpenTickets(state), [state]);
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
      service: t.service ?? 'deliver',
      // The LAN carries no spot; the cloud board says it once it is back.
      noSpot: false,
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

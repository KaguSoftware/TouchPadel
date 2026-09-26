'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrowserSupabase } from '@/lib/supabase/client';
import {
  decorateFeatured,
  fetchCafeSettings,
  fetchMenu,
  itemsById as buildItemsById,
  categoryNameByItemId,
  type CafeSettings,
  type MenuCategory,
  type MenuItem,
} from '@/lib/menu';
import type { MenuStatus } from '@/lib/menu.server';

/**
 * The live menu read model. The SSR snapshot arrives as props and stays on
 * screen; this hook only ever REPLACES it with a fresher copy.
 *
 * Refetch triggers (web-slice §6.3):
 *  • broadcast `menu_changed` / `settings_changed` on the public `menu` topic,
 *    debounced 500 ms (one admin save fires many row triggers — 0033's own note);
 *  • the `online` event (we were offline and prices may have moved);
 *  • returning to a visible tab when the data is older than 60 s.
 *
 * The client refetch calls `fetchMenu` DIRECTLY: `router.refresh()` would just
 * hand back the same 60 s `unstable_cache` entry.
 *
 * PER BRANCH (multi-venue slice 4): every read is filtered to `venueId`, the
 * table's branch once the session is bound (or the branch the page rendered).
 * When it changes — a scanned guest whose table is at another branch than the
 * one the server guessed — the hook refetches for the new branch. The `menu`
 * topic stays one global topic; a `settings_changed` that names another branch
 * is ignored, anything else refetches this branch only.
 */
const DEBOUNCE_MS = 500;
const STALE_MS = 60_000;
/**
 * Extra random delay on a broadcast-driven refetch. `menu_changed` fans out to
 * EVERY connected guest at once, so a fixed debounce has the whole room hit the
 * menu queries on the same tick — one admin save turning into a synchronised
 * stampede. Spreading arrivals over a couple of seconds costs the guest nothing
 * perceptible and flattens the peak.
 */
const JITTER_MS = 2_000;

export interface UseMenu {
  menu: MenuCategory[];
  status: MenuStatus;
  settings: CafeSettings;
  itemsById: Map<string, MenuItem>;
  /** item id -> its category `name_en`, the key section art is looked up by */
  categoryNames: Map<string, string>;
  /** the settings' featured item, if it is still on the menu */
  featured: MenuItem | null;
  /** true while a refetch is in flight (drives the MenuUnavailable retry button) */
  refreshing: boolean;
  refresh(): Promise<void>;
}

export function useMenu(
  initial: { menu: MenuCategory[]; status: MenuStatus },
  initialSettings: CafeSettings,
  supabase: BrowserSupabase | null,
  venueId: string | null = null,
): UseMenu {
  const [settings, setSettings] = useState<CafeSettings>(initialSettings);
  const [menu, setMenu] = useState<MenuCategory[]>(() =>
    decorateFeatured(initial.menu, initialSettings),
  );
  const [status, setStatus] = useState<MenuStatus>(initial.status);
  const [refreshing, setRefreshing] = useState(false);
  const fetchedAt = useRef(Date.now());
  const inFlight = useRef<Promise<void> | null>(null);
  /** The branch the in-flight read is for: a branch switch must not reuse it. */
  const inFlightVenue = useRef<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!supabase) return;
    if (inFlight.current && inFlightVenue.current === venueId) return inFlight.current;
    inFlightVenue.current = venueId;
    const run = (async () => {
      setRefreshing(true);
      try {
        const [cats, nextSettings] = await Promise.all([
          fetchMenu(supabase, venueId),
          fetchCafeSettings(supabase, venueId),
        ]);
        // A newer read for another branch started meanwhile: it owns the screen.
        if (inFlightVenue.current !== venueId) return;
        setSettings(nextSettings);
        setMenu(decorateFeatured(cats, nextSettings));
        setStatus(cats.length > 0 ? 'ok' : 'empty');
        fetchedAt.current = Date.now();
      } catch {
        // Keep whatever is on screen; only an empty stage becomes an error.
        setStatus((s) => (s === 'ok' ? 'ok' : 'error'));
      } finally {
        if (inFlightVenue.current === venueId) {
          setRefreshing(false);
          inFlight.current = null;
        }
      }
    })();
    inFlight.current = run;
    return run;
  }, [supabase, venueId]);

  // ------------------------------------------ the branch changed under us
  // The first render's branch is the one the server rendered; only a later
  // change (the bound table's branch differs) needs a read.
  const renderedVenue = useRef(venueId);
  useEffect(() => {
    if (renderedVenue.current === venueId) return;
    renderedVenue.current = venueId;
    void refresh();
  }, [venueId, refresh]);

  // ------------------------------------------- broadcast: the `menu` topic
  useEffect(() => {
    if (!supabase) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = (message: { payload?: { venue_id?: unknown } }) => {
      // 0209: a settings change names its branch; another branch's is not ours.
      const changed = message.payload?.venue_id;
      if (venueId && typeof changed === 'string' && changed !== venueId) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), DEBOUNCE_MS + Math.random() * JITTER_MS);
    };
    void supabase.realtime.setAuth();
    const channel = supabase
      .channel('menu', { config: { private: true } })
      .on('broadcast', { event: 'menu_changed' }, bump)
      .on('broadcast', { event: 'settings_changed' }, bump)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [supabase, refresh, venueId]);

  // -------------------------------------------- reconnect / return-to-tab
  useEffect(() => {
    if (!supabase) return;
    const onOnline = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - fetchedAt.current > STALE_MS) void refresh();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [supabase, refresh]);

  const byId = useMemo(() => buildItemsById(menu), [menu]);
  const categoryNames = useMemo(() => categoryNameByItemId(menu), [menu]);
  const featured = useMemo(() => {
    if (settings.hero_mode !== 'featured' || !settings.featured_item_id) return null;
    return byId.get(settings.featured_item_id) ?? null;
  }, [settings, byId]);

  return { menu, status, settings, itemsById: byId, categoryNames, featured, refreshing, refresh };
}

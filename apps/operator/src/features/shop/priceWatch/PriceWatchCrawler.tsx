/**
 * The supplier price watch's crawler (0322, docs/design/shop/supplier-price-watch-2026-10-08.md).
 * It lives on the SHOP DESK PC: mounted in the signed-in shell (routes/__root.tsx),
 * it does anything only on a registered `shop` station, with someone signed in
 * who may open /shop (the same roles as the RPC's guard), on any page.
 * About 20 s after the shop desk opens, then every hour, it reads each due
 * supplier link through the shell (touch.fetchSupplierPage: main fetches, so
 * no CORS and only public https hosts), parses the price here and reports it
 * with app.record_shop_supplier_price. The server keeps the price and pushes
 * the owner and the shop staff on a change; nothing here decides that.
 *
 * The push never reaches the person signed in here (notify_staff skips the
 * caller), and the change shows only on Shop > Products, so a pass that left
 * a new price to apply says so in a toast on whatever page is open.
 *
 * Renders nothing of its own. Offline, the pass waits for the next hour.
 */
import { useEffect, useRef } from 'react';
import { formatNumber } from '@touch/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { touch } from '../../../ipc/bridge';
import { AppRpcError, appRpc, isRpcMissing } from '../../../lib/appRpc';
import { canAccess, useAuth } from '../../../lib/auth';
import { captureException } from '../../../lib/telemetry';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { runCrawlPass } from './crawlPass';
import { PRICE_WATCHES_KEY, fetchPriceWatches } from './priceWatchData';
import { FIRST_PASS_DELAY_MS, PASS_INTERVAL_MS, crawlerRuns, isNewPriceToApply } from './priceWatchLogic';

const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/**
 * record_shop_supplier_price's refusals about one watch: a value it will not
 * take, or a size of another branch. The pass reads the other links.
 */
const WATCH_REFUSALS = new Set(['INVALID_ARGUMENT', 'VENUE_MISMATCH']);
const isWatchRefusal = (e: unknown) => e instanceof AppRpcError && WATCH_REFUSALS.has(e.code);

/** PostgREST's "no such table" (PGRST205) or Postgres' own (42P01): 0322 not on this server yet. */
const isTableMissing = (e: unknown) => {
  const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
  return code === 'PGRST205' || code === '42P01';
};

export function PriceWatchCrawler() {
  const { staff } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { tr, locale } = useLocale();
  // Read through a ref, so a language switch does not restart the hourly timer.
  const sayToApply = useRef<(count: number) => void>(() => {});
  useEffect(() => {
    sayToApply.current = (count) =>
      toast.info(count === 1 ? tr('ws.shop.priceWatch.changedToastOne') : tr('ws.shop.priceWatch.changedToastMany', { count: formatNumber(count, locale) }));
  });
  // Only the shop's roles: anyone else would be refused every hour.
  const signedIn = staff !== null && canAccess(staff.role, '/shop');

  useEffect(() => {
    if (!crawlerRuns(touch.getStation(), signedIn)) return;
    let unmounted = false;
    const stopped = () => unmounted || !online();

    const pass = async () => {
      if (stopped()) return;
      let toApply = 0;
      try {
        await runCrawlPass({
          listWatches: fetchPriceWatches,
          fetchPage: (url) => touch.fetchSupplierPage(url),
          report: async (args) => {
            const result = await appRpc('record_shop_supplier_price', args);
            if (isNewPriceToApply(result)) toApply++;
            return result;
          },
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: () => new Date(),
          stopped,
          skipRefusal: isWatchRefusal,
        });
      } catch (e) {
        // The server not migrated yet is not worth a report every hour; the
        // rest is (a refusal here means the watch and this build disagree).
        if (!isRpcMissing(e) && !isTableMissing(e)) captureException(e, { label: 'priceWatch' });
      }
      // Whatever was read (a pass may end part-way), Products shows it.
      void queryClient.invalidateQueries({ queryKey: PRICE_WATCHES_KEY });
      if (toApply > 0 && !unmounted) sayToApply.current(toApply);
    };

    const first = setTimeout(() => void pass(), FIRST_PASS_DELAY_MS);
    const hourly = setInterval(() => void pass(), PASS_INTERVAL_MS);
    return () => {
      unmounted = true;
      clearTimeout(first);
      clearInterval(hourly);
    };
  }, [signedIn, queryClient]);

  return null;
}

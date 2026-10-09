/**
 * The supplier price watch (0322, docs/design/shop/supplier-price-watch-2026-10-08.md):
 * the pure rules, no React and no network, pinned by the node test beside
 * this file.
 *
 * Each shop size may carry a supplier product page link
 * (`shop_price_watches`). The shop desk PC reads every link about once an
 * hour (PriceWatchCrawler) and reports what it read; the server keeps the
 * supplier's latest price and pushes the owner and the shop staff when it
 * changes. Products then lists every size whose supplier price is not its
 * selling price, with "Apply new price" (supplier price == shop price, no
 * calculation: Majed's call).
 */
import type { SupplierFetchError, SupplierPageResult } from '../../../ipc/bridge';
import { parseSupplierPrice } from './parseSupplierPrice';

/** A row of `shop_price_watches` as the operator reads it. */
export interface PriceWatchRow {
  variant_id: string;
  url: string;
  supplier_price_iqd: number | null;
  previous_price_iqd: number | null;
  price_changed_at: string | null;
  checked_at: string | null;
  read_ok_at: string | null;
  last_error: ReadError | null;
}

/** The closed list of read errors: the 0322 CHECK, the shell and this file agree on it. */
export const READ_ERRORS = ['no_price', 'ambiguous', 'not_iqd', 'blocked_url', 'http_error', 'timeout', 'too_large', 'not_html', 'fetch_failed'] as const;
export type ReadError = (typeof READ_ERRORS)[number];

// ---------------------------------------------------------------------------
// The link
// ---------------------------------------------------------------------------

/** The same limits app.set_shop_price_watch and the table's CHECK hold a link to. */
export const SUPPLIER_URL_MIN = 12;
export const SUPPLIER_URL_MAX = 2000;

export type SupplierUrlProblem = 'https' | 'tooLong' | 'invalid' | 'privateHost';

export type SupplierUrlCheck = { ok: true; url: string | null } | { ok: false; error: SupplierUrlProblem };

const PRIVATE_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home.arpa'];

/**
 * A pasted link, checked the way the server will check it. `url: null` is a
 * blank field: the watch is removed. Only the scheme's case and the
 * surrounding spaces are tidied; the rest goes to the server as typed.
 */
export function checkSupplierUrl(raw: string): SupplierUrlCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, url: null };
  const url = /^https:\/\//i.test(trimmed) ? `https://${trimmed.slice('https://'.length)}` : trimmed;
  if (!url.startsWith('https://')) return { ok: false, error: 'https' };
  if (url.length > SUPPLIER_URL_MAX) return { ok: false, error: 'tooLong' };
  if (url.length < SUPPLIER_URL_MIN || /[\s\u0000-\u001f\u007f]/.test(url)) return { ok: false, error: 'invalid' };
  const authority = url.slice('https://'.length).split(/[/?#]/, 1)[0]!;
  // A "\" reads as "/" and "%xx" decodes in a browser's host: either can hide
  // an address behind a name that passes the rest (the server refuses both).
  if (authority.includes('@') || /[\\%]/.test(authority)) return { ok: false, error: 'invalid' };
  if (authority.startsWith('[')) return { ok: false, error: 'privateHost' }; // an IPv6 literal
  const host = authority.replace(/:\d*$/, '').toLowerCase();
  if (!host || /[[\]:]/.test(host)) return { ok: false, error: 'invalid' };
  // The server's own IP test, dotted, decimal or hex parts ("0x7f.1"), after
  // it drops a trailing dot.
  const bare = host.replace(/\.+$/, '');
  if (/^((0x[0-9a-f]*|[0-9]+)\.)*(0x[0-9a-f]*|[0-9]+)$/.test(bare)) return { ok: false, error: 'privateHost' };
  if (bare === 'localhost' || PRIVATE_SUFFIXES.some((s) => bare.endsWith(s))) return { ok: false, error: 'privateHost' };
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return { ok: false, error: 'invalid' };
  return { ok: true, url };
}

// ---------------------------------------------------------------------------
// The hourly pass
// ---------------------------------------------------------------------------

/** First pass this long after the shop desk opens: the till's own loading goes first. */
export const FIRST_PASS_DELAY_MS = 20_000;
/** Then once an hour. */
export const PASS_INTERVAL_MS = 60 * 60_000;
/** A pause between two pages, so a supplier never sees a burst from one PC. */
export const PAGE_GAP_MS = 3_000;
/**
 * A link read less than this long ago is skipped, so a quick restart does not
 * read everything again; the hourly timer sets the cadence, not this. Half the
 * hour, not just under it: `now` is this PC's clock at the START of a pass and
 * `checked_at` the server's at each report, so the margin has to absorb how
 * long a pass runs (a link late in a long pass was read well after the pass
 * began) and a PC clock running behind the server's. At 55 minutes, a pass
 * over ~5 minutes or a clock 5 minutes slow left links read every 2 hours.
 */
export const RECHECK_AFTER_MS = 30 * 60_000;

/** Never read, or read longer ago than RECHECK_AFTER_MS. */
export function isDue(watch: Pick<PriceWatchRow, 'checked_at'>, now: Date): boolean {
  if (!watch.checked_at) return true;
  const at = Date.parse(watch.checked_at);
  return !Number.isFinite(at) || now.getTime() - at >= RECHECK_AFTER_MS;
}

/** The due watches, never-read first, then the longest unread. */
export function crawlOrder<W extends Pick<PriceWatchRow, 'checked_at' | 'variant_id'>>(watches: readonly W[], now: Date): W[] {
  const age = (w: W) => (w.checked_at ? Date.parse(w.checked_at) || 0 : -Infinity);
  return watches
    .filter((w) => isDue(w, now))
    .sort((a, b) => age(a) - age(b) || a.variant_id.localeCompare(b.variant_id));
}

/** Only the shop desk PC watches prices: a registered `shop` station. */
export function crawlerRuns(station: { mode: string; configured: boolean }, signedIn: boolean): boolean {
  return station.mode === 'shop' && station.configured && signedIn;
}

export type PageOutcome =
  | { kind: 'stop' }
  | { kind: 'price'; priceIqd: number }
  | { kind: 'error'; error: ReadError };

const isReadError = (e: SupplierFetchError | string): e is ReadError => (READ_ERRORS as readonly string[]).includes(e);

/**
 * What one fetched page comes to: a price, a read error to report, or stop.
 * Stop is every fetch error that is not about the page: `not_shop_station`,
 * `unavailable`, or a refusal from main this build does not know. Nothing is
 * reported for those and the pass ends.
 */
export function pageOutcome(page: SupplierPageResult, watchedUrl?: string): PageOutcome {
  if (!page.ok) return isReadError(page.error) ? { kind: 'error', error: page.error } : { kind: 'stop' };
  // The watched link picks one variant's offer on a page that lists several
  // (Shopify's `?variant=`); the final URL when there is none.
  const read = parseSupplierPrice(page.html, watchedUrl ?? page.finalUrl);
  return read.ok ? { kind: 'price', priceIqd: read.priceIqd } : { kind: 'error', error: read.error };
}

/** The record_shop_supplier_price arguments for one page. */
export function reportArgs(watch: Pick<PriceWatchRow, 'variant_id' | 'url'>, outcome: Exclude<PageOutcome, { kind: 'stop' }>) {
  return {
    p_variant_id: watch.variant_id,
    p_url: watch.url,
    ...(outcome.kind === 'price' ? { p_price_iqd: outcome.priceIqd } : { p_error: outcome.error }),
  };
}

/**
 * A report that leaves a new price to apply: the supplier's price changed and
 * the shop does not already sell at it. The server pushes the owner and the
 * shop staff for exactly these, but never the person signed in at the shop
 * desk (notify_staff skips the caller), so the desk says it itself.
 */
export function isNewPriceToApply(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const r = result as { status?: unknown; supplier_price_iqd?: unknown; shop_price_iqd?: unknown };
  return r.status === 'changed' && r.supplier_price_iqd != null && Number(r.supplier_price_iqd) !== Number(r.shop_price_iqd);
}

// ---------------------------------------------------------------------------
// What Products shows
// ---------------------------------------------------------------------------

export interface PriceAlert<L> {
  line: L;
  watch: PriceWatchRow;
  supplierPriceIqd: number;
}

/**
 * Every size whose supplier price is not its selling price, the latest change
 * first (a first read that already differs has no change time: last).
 */
export function alertsFor<L extends { variant: { id: string; price_iqd: number } }>(
  lines: readonly L[],
  watches: readonly PriceWatchRow[],
): PriceAlert<L>[] {
  const byVariant = new Map(watches.map((w) => [w.variant_id, w]));
  const out: PriceAlert<L>[] = [];
  for (const line of lines) {
    const watch = byVariant.get(line.variant.id);
    if (!watch || watch.supplier_price_iqd === null) continue;
    const supplierPriceIqd = Number(watch.supplier_price_iqd);
    if (supplierPriceIqd === Number(line.variant.price_iqd)) continue;
    out.push({ line, watch, supplierPriceIqd });
  }
  const at = (a: PriceAlert<L>) => (a.watch.price_changed_at ? Date.parse(a.watch.price_changed_at) || 0 : -Infinity);
  return out.sort((a, b) => at(b) - at(a) || 0);
}

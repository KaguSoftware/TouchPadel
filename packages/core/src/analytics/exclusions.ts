/**
 * Owner-configured "ignore these items" rule for the analytics page.
 *
 * `cafe_settings.analytics_excluded_item_ids` holds item ids that dominate item-level views
 * without carrying signal (an upsell line, a service charge). The filter applies to
 * INSIGHT-level views only — conversion, best sellers, matrix, patterns, the AI inputs — and
 * deliberately never to money/amount aggregates (total sales, covers, funnel counts), which
 * stay complete. The SQL side applies the same list via `app.analytics_excluded()`.
 *
 * Everything is keyed by item id; there is no name matching anywhere.
 */

/** Parse whatever the settings row holds into a clean list of ids. Safe ([]) on any input. */
export function normalizeExcludedIds(raw: unknown): string[] {
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr) {
    if (typeof v !== 'string') continue;
    const id = v.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Predicate that keeps only item ids the owner has not excluded. */
export function makeKeepFilter(excludedIds: ReadonlySet<string>): (id: string) => boolean {
  if (excludedIds.size === 0) return () => true;
  return (id: string) => !excludedIds.has(id);
}

/** 32-bit FNV-1a — a short stable digest for cache keys, not a checksum. */
function digest(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Cache-key fragment identifying the active exclusions, so a change regenerates findings and
 * patterns instead of serving ones built under the old list. '' when nothing is excluded;
 * otherwise order-independent and stable across runs.
 */
export function exclusionSignature(excludedIds: Iterable<string>): string {
  const ids = [...new Set(excludedIds)].filter(Boolean).sort();
  if (ids.length === 0) return '';
  return `x:${ids.length}:${digest(ids.join(','))}`;
}

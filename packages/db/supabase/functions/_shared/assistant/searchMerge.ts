/**
 * searchMerge — one entry, one passage (search result compaction).
 *
 * The system map is indexed in overlapping windows (`ref`, `ref~2`, `ref~3`;
 * scripts/build-assistant-map.mjs windowChunks): each later window opens with
 * the entry's first line and repeats the last lines of the window before it.
 * A search can return several windows of one entry, and read back to back they
 * say the same lines twice. This module joins the windows of an entry that
 * ranked together into one hit, in reading order, without the repeated head
 * and overlap lines, and keeps at most MAX_WINDOWS_PER_ENTRY of them.
 *
 * Pure: no Deno, no npm. Rows without a `~n` ref (live free text, whole pages,
 * rules) pass through untouched.
 */

/** A search hit as app.assistant_search returns it (extra keys are carried along). */
export interface SearchRow {
  kind?: string;
  ref?: string;
  lang?: string;
  title?: string;
  snippet?: string;
  score?: number;
  [key: string]: unknown;
}

export const MAX_WINDOWS_PER_ENTRY = 3;

const PART = /~(\d+)$/;
const TITLE_PART = / \(part (\d+) of (\d+)\)$/;

const baseRef = (ref: string): string => ref.replace(PART, '');
const partOf = (ref: string): number => Number(PART.exec(ref)?.[1] ?? 1);

/** Lines of `next` that repeat the end of `prev` (the overlap), as a count of leading lines of `next`. */
function overlapLines(prev: string[], next: string[]): number {
  const max = Math.min(prev.length, next.length);
  for (let n = max; n > 0; n--) {
    let same = true;
    for (let i = 0; i < n; i++) {
      if (prev[prev.length - n + i] !== next[i]) {
        same = false;
        break;
      }
    }
    if (same) return n;
  }
  return 0;
}

/**
 * Merge the windows of each entry. `limit` caps the rows returned (best score
 * first, as the search ordered them). The merged row keeps the first window's
 * fields, the best score, and a title that says which parts it holds.
 */
export function mergeWindows(rows: readonly SearchRow[], limit = rows.length): SearchRow[] {
  const groups = new Map<string, SearchRow[]>();
  const order: string[] = [];
  rows.forEach((r, i) => {
    const key = r.ref && (PART.test(r.ref) || rows.some((o) => o !== r && o.ref && baseRef(o.ref) === r.ref && PART.test(o.ref)))
      ? `${r.kind}\u0000${r.lang}\u0000${baseRef(r.ref)}`
      : `row\u0000${i}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(r);
  });

  const out: SearchRow[] = [];
  for (const key of order) {
    const members = groups.get(key)!;
    if (members.length === 1) {
      out.push(members[0]!);
      continue;
    }
    // Keep the best-ranked windows, then read them in document order.
    const kept = [...members].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, MAX_WINDOWS_PER_ENTRY);
    kept.sort((a, b) => partOf(a.ref ?? '') - partOf(b.ref ?? ''));
    let lines: string[] = (kept[0]!.snippet ?? '').split('\n');
    for (let i = 1; i < kept.length; i++) {
      const next = (kept[i]!.snippet ?? '').split('\n');
      const head = lines[0];
      const body = next[0] === head ? next.slice(1) : next; // a later window opens with the entry's first line
      const adjacent = partOf(kept[i]!.ref ?? '') === partOf(kept[i - 1]!.ref ?? '') + 1;
      if (adjacent) lines = lines.concat(body.slice(overlapLines(lines, body)));
      else lines = lines.concat(['…'], body);
    }
    const first = kept[0]!;
    const total = TITLE_PART.exec(first.title ?? '')?.[2];
    const parts = kept.map((k) => partOf(k.ref ?? ''));
    const title = (first.title ?? '').replace(TITLE_PART, '') + (total ? ` (part${parts.length > 1 ? 's' : ''} ${parts.join(', ')} of ${total})` : '');
    out.push({ ...first, ref: baseRef(first.ref ?? ''), title, snippet: lines.join('\n'), score: Math.max(...kept.map((k) => k.score ?? 0)) });
  }
  // Merging can move a row up; keep the search's order of best score first.
  out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return out.slice(0, limit);
}

/**
 * The Customers screen's list (0144 `customer_directory`) — the pure half.
 *
 * The whole book arrives once and is kept in memory (see CUSTOMER_DIRECTORY_STALE_MS),
 * so typing filters it HERE instead of asking the server per keystroke. To
 * find the same people the server search would, the matching mirrors
 * `app.customer_search` (0077): the name key is `app.search_norm` (0065) with
 * the spaces removed, the phone key is `app.phone_digits`, and email matches
 * once the query holds an '@' or three characters. Ranking is the same too:
 * name prefix, then phone prefix, then the rest, each by name.
 */
import type { CustomerSearchRow } from '../deskTypes';

export interface CustomerDirectory {
  rows: CustomerSearchRow[];
  /** Every live customer, including any the cap left out. */
  total: number;
  /** The list stopped at the cap: filtering it could miss someone. */
  truncated: boolean;
}

/**
 * How long the list is trusted before opening the screen fetches it again.
 * Long on purpose (owner call, 2026-09-22: opening the page should not cost
 * the whole book every time); a customer created, edited or flagged from this
 * station invalidates it at once, and the screen offers a Refresh.
 */
export const CUSTOMER_DIRECTORY_STALE_MS = 15 * 60 * 1000;

/** Rows drawn per "Show more", so a book of thousands never lands in the DOM at once. */
export const CUSTOMER_PAGE = 50;

export const CUSTOMER_DIRECTORY_KEY = ['customerDirectory'] as const;

export type CustomerSort = 'name' | 'bookings';

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

function foldDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (ch) => {
    const a = ARABIC_INDIC.indexOf(ch);
    return String(a >= 0 ? a : PERSIAN.indexOf(ch));
  });
}

/** `app.search_norm` (0065), then every space removed, as the search compares it. */
export function nameKey(text: string | null | undefined): string {
  return foldDigits((text ?? '').toLowerCase())
    .replace(/[ـً-ْٰ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, '');
}

/** `app.phone_digits`: Arabic-Indic digits folded, every non-digit dropped. */
export function phoneKey(text: string | null | undefined): string {
  return foldDigits(text ?? '').replace(/\D/g, '');
}

/**
 * The customers matching `query`, best first. An empty query (or one shorter
 * than `min`) is no filter: the whole list, in the chosen sort.
 */
export function filterCustomers(rows: readonly CustomerSearchRow[], query: string, sort: CustomerSort, min = 2): CustomerSearchRow[] {
  const q = query.trim();
  // An account with no name (a guest who never gave one) goes to the foot:
  // a blank row at the top of the book reads as a broken list.
  const byName = (a: CustomerSearchRow, b: CustomerSearchRow) =>
    Number(!a.full_name.trim()) - Number(!b.full_name.trim()) || a.full_name.localeCompare(b.full_name);
  const bySort =
    sort === 'bookings'
      ? (a: CustomerSearchRow, b: CustomerSearchRow) => (b.counts?.bookings ?? 0) - (a.counts?.bookings ?? 0) || byName(a, b)
      : byName;
  if (q.length < min) return rows.slice().sort(bySort);

  const name = nameKey(q);
  const digits = phoneKey(q);
  const email = q.toLowerCase();
  const useDigits = digits.length >= 3;
  const useEmail = q.includes('@') || q.length >= 3;

  const hits: { row: CustomerSearchRow; rank: number }[] = [];
  for (const row of rows) {
    const n = nameKey(row.full_name);
    const p = phoneKey(row.phone);
    const nameHit = name !== '' && n.includes(name);
    const phoneHit = useDigits && p.includes(digits);
    const emailHit = useEmail && !!row.email && row.email.toLowerCase().includes(email);
    if (!nameHit && !phoneHit && !emailHit) continue;
    const rank = name !== '' && n.startsWith(name) ? 0 : useDigits && p.startsWith(digits) ? 1 : 2;
    hits.push({ row, rank });
  }
  // A search answers "who is this": relevance first, whatever the list sort.
  return hits.sort((a, b) => a.rank - b.rank || bySort(a.row, b.row)).map((h) => h.row);
}

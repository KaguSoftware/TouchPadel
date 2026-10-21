/**
 * The chat list's pure half (design L1, 2026-10-20): which day group a chat
 * falls in, the short time shown at its row's end, and the search filter. The
 * paid list (ConversationList) and the free one (FreeChatList) both use it.
 */

export type DayGroup = 'today' | 'yesterday' | 'week' | 'earlier';
export const DAY_GROUPS: readonly DayGroup[] = ['today', 'yesterday', 'week', 'earlier'];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Today, yesterday, the five days before that, or earlier — by the station's calendar. */
export function dayGroup(at: Date, now: Date): DayGroup {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'week';
  return 'earlier';
}

/** Items in their day groups, newest group first, each group keeping the given order; empty groups left out. */
export function groupByDay<T>(items: readonly T[], at: (item: T) => Date, now: Date): { group: DayGroup; items: T[] }[] {
  const by = new Map<DayGroup, T[]>();
  for (const it of items) {
    const g = dayGroup(at(it), now);
    by.set(g, [...(by.get(g) ?? []), it]);
  }
  return DAY_GROUPS.filter((g) => by.has(g)).map((g) => ({ group: g, items: by.get(g)! }));
}

/** 10:24 today and yesterday, the weekday within the week, a short date before that. */
export function rowTime(at: Date, now: Date, locale: 'en' | 'ar'): string {
  const tag = locale === 'ar' ? 'ar-IQ' : 'en-GB';
  const g = dayGroup(at, now);
  if (g === 'today' || g === 'yesterday') return at.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' });
  if (g === 'week') return at.toLocaleDateString(tag, { weekday: 'short' });
  return at.toLocaleDateString(tag, { day: 'numeric', month: 'short' });
}

/** Titles that contain every word typed, ignoring case. */
export function matchesQuery(title: string, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const t = title.toLowerCase();
  return words.every((w) => t.includes(w));
}

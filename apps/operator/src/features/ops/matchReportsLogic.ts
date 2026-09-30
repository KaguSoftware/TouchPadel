/**
 * The Ops "Player reports" queue, pure (docs/design/open-matches/operator.md
 * §5.17; app.match_reports_open, oldest first). Which order the rows come in,
 * which words a reason gets, when Ban is offered, and whether the panel shows
 * at all. The decisions themselves are app.resolve_match_report's.
 */
import type { MessageKey } from '@touch/i18n';
import type { MatchReport } from '../matches/matchPayloads';

/** match_reports.reason (§1.3), each worded in ws.matches.ops.reason. */
export const REPORT_REASONS = ['offensive_name', 'abusive_behaviour', 'harassment', 'unsafe_play', 'no_show', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** A reason in words; one this build does not know reads as "Other", never the raw code. */
export function reportReasonKey(reason: string | null | undefined): `ws.matches.ops.reason.${ReportReason}` {
  const known = (REPORT_REASONS as readonly string[]).includes(reason ?? '') ? (reason as ReportReason) : 'other';
  return `ws.matches.ops.reason.${known}`;
}

/**
 * Oldest first, as the server sends them (the longest wait is the likeliest
 * complaint), kept stable here so a refetch never reshuffles the list under a
 * manager's pointer. A report with no time sorts last.
 */
export function sortReports<T extends Pick<MatchReport, 'report_id' | 'created_at'>>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.created_at !== b.created_at) {
      if (!a.created_at) return 1;
      if (!b.created_at) return -1;
      return a.created_at.localeCompare(b.created_at);
    }
    return a.report_id.localeCompare(b.report_id);
  });
}

/**
 * Ban is offered while the reported player is known and not banned already;
 * Close report always is. A player banned since the report came in is closed,
 * not banned twice.
 */
export function reportActions(r: Pick<MatchReport, 'reported'>): { close: boolean; ban: boolean } {
  return { close: true, ban: Boolean(r.reported?.customer_id) && r.reported?.banned !== true };
}

/**
 * Whether the panel is worth drawing. On Today it is a to-do list: nothing
 * while it loads, nothing when no report waits, and nothing on a server
 * without open matches (null). Elsewhere it shows its empty state.
 */
export function showReportsPanel(input: { rows: number | null | undefined; hideWhenEmpty: boolean }): boolean {
  if (input.rows == null) return false;
  return input.rows > 0 || !input.hideWhenEmpty;
}

/** The refusals after which the list is out of date: someone else dealt with the report. */
export function reportRefusalRefetches(code: string | null | undefined): boolean {
  return code === 'REPORT_CLOSED' || code === 'REPORT_NOT_FOUND';
}

/** The match line's category words, or null for a category this build does not know. */
export function reportCategoryKey(category: string | null | undefined): MessageKey | null {
  return category === 'open' || category === 'women' || category === 'men' ? `ws.matches.common.category.${category}` : null;
}

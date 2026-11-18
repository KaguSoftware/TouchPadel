/**
 * Reporting a name on the Ranks board (App Review Guideline 1.2, Play's UGC policy): a long
 * press on another player's row asks first, then opens the guest's email app addressed to the
 * venue with the name filled in. Open matches have the in-app report and block
 * (app/(matches)/match-report.tsx); the board has no match to hang a report on, so it goes by
 * email until a server-side report exists. Pure: the screen opens the link.
 */
export function rankReportMailto(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** A row can be reported when it is someone else's and carries a name. */
export function canReportRow(row: { mine: boolean; name: string | null }): boolean {
  return !row.mine && !!row.name && row.name.trim().length > 0;
}

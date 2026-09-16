/**
 * Shapes returned by app.marketing_overview (migration 0073) and the pure
 * helpers the panel and its tests share.
 */
export const MARKETING_QUERY_KEY = ['marketing', 'overview'] as const;

export type CampaignStatus = 'draft' | 'scheduled' | 'live' | 'ended' | 'cancelled';
export type MarketingChannel = 'telegram' | 'guest_site' | 'in_venue';

export interface CampaignPerformance {
  sends: number;
  delivered: number;
  failed: number;
  lastSentAt: string | null;
  /**
   * False when the campaign hands out no promotion. The money fields are then
   * null — NOT zero. "We cannot attribute this" and "this earned nothing" are
   * different claims and the panel must not collapse them.
   */
  attributable: boolean;
  redemptions: number | null;
  discountIqd: number | null;
  revenueIqd: number | null;
}

export interface CampaignRow {
  id: string;
  name_en: string;
  name_ar: string;
  channel: MarketingChannel;
  status: CampaignStatus;
  starts_at: string | null;
  ends_at: string | null;
  promotion_id: string | null;
  audience_id: string | null;
  audience_en: string | null;
  audience_ar: string | null;
  promotion_en: string | null;
  promotion_ar: string | null;
  reach: number | null;
  performance: CampaignPerformance;
}

export interface AudienceRow {
  id: string;
  nameEn: string;
  nameAr: string;
  rule: Record<string, unknown>;
  reach: number;
}

export interface MarketingOverview {
  campaigns: CampaignRow[];
  audiences: AudienceRow[];
  counts: { live: number; scheduled: number; draft: number };
}

/** Tone for the status pill. */
export function campaignTone(status: CampaignStatus): 'success' | 'info' | 'neutral' | 'warn' {
  switch (status) {
    case 'live':
      return 'success';
    case 'scheduled':
      return 'info';
    case 'draft':
      return 'warn';
    default:
      return 'neutral';
  }
}

/**
 * The status moves this campaign may make, mirroring app.set_campaign_status.
 * Kept as data so the panel offers exactly the transitions the server accepts
 * — an offered button that raises BAD_TRANSITION is a lie the UI told.
 */
export function nextStatuses(status: CampaignStatus): readonly CampaignStatus[] {
  switch (status) {
    case 'draft':
      return ['scheduled', 'cancelled'];
    case 'scheduled':
      return ['live', 'draft', 'cancelled'];
    case 'live':
      return ['ended', 'cancelled'];
    default:
      return [];
  }
}

/** Only a campaign that has not gone out may be edited (CAMPAIGN_LOCKED). */
export function isEditable(status: CampaignStatus): boolean {
  return status === 'draft' || status === 'scheduled';
}

// ---------------------------------------------------------------------------
// Lifecycle chores
// ---------------------------------------------------------------------------

/**
 * Campaigns whose dates have moved past their status. Nothing moves a
 * campaign on by itself — app.set_campaign_status is the only writer — so a
 * campaign "scheduled" for last week stays scheduled until the owner acts.
 * These are the rows the Observe home lists as waiting, and the rows the
 * marketing table flags.
 */
export function overdueCampaigns(
  campaigns: readonly Pick<CampaignRow, 'id' | 'status' | 'starts_at' | 'ends_at'>[],
  nowMs: number,
): { toStart: string[]; toEnd: string[] } {
  const toStart: string[] = [];
  const toEnd: string[] = [];
  for (const c of campaigns) {
    if (c.status === 'scheduled' && c.starts_at && Date.parse(c.starts_at) <= nowMs) toStart.push(c.id);
    if (c.status === 'live' && c.ends_at && Date.parse(c.ends_at) <= nowMs) toEnd.push(c.id);
  }
  return { toStart, toEnd };
}

export type CampaignFilter = 'all' | 'live' | 'scheduled' | 'draft' | 'finished';

export function matchesFilter(status: CampaignStatus, filter: CampaignFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'finished') return status === 'ended' || status === 'cancelled';
  return status === filter;
}

// ---------------------------------------------------------------------------
// Dates — venue days, not UTC days
// ---------------------------------------------------------------------------


/** The venue-local calendar date ('YYYY-MM-DD') an instant falls on. */
export function venueDateOf(iso: string, tz: string): string {
  // en-CA is the one common locale whose short date IS YYYY-MM-DD.
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
}

/**
 * The editor asks for a start day and a LAST day; the server stores a window
 * [starts_at, ends_at). The form used to send `new Date('2026-09-20')`, which
 * is UTC midnight — 03:00 in Baghdad — and used the end date itself as the
 * exclusive end, so redemptions on the chosen last day were never counted.
 *
 * Now the start is the venue's midnight on that day and the end is the venue's
 * midnight AFTER the last day. Reading back steps one millisecond before the
 * end, which also shows campaigns saved the old way on the day they were
 * picked (UTC midnight of D is still D in Baghdad).
 */
export function windowToServer(
  startDate: string,
  lastDate: string,
  tz: string,
  toUtc: (date: string, minutesOfDay: number, tz: string) => Date,
): { startsAt: string | null; endsAt: string | null } {
  return {
    startsAt: startDate ? toUtc(startDate, 0, tz).toISOString() : null,
    endsAt: lastDate ? toUtc(lastDate, 24 * 60, tz).toISOString() : null,
  };
}

export function windowFromServer(
  startsAt: string | null,
  endsAt: string | null,
  tz: string,
): { startDate: string; lastDate: string } {
  return {
    startDate: startsAt ? venueDateOf(startsAt, tz) : '',
    lastDate: endsAt ? venueDateOf(new Date(Date.parse(endsAt) - 1).toISOString(), tz) : '',
  };
}

/** A last day before the start day. Empty either side is not an error. */
export function windowIsBackwards(startDate: string, lastDate: string): boolean {
  return Boolean(startDate && lastDate && lastDate < startDate);
}


// ---------------------------------------------------------------------------
// Audience rules
// ---------------------------------------------------------------------------

/** The rule shape app.marketing_audience_reach reads. Absent key = no constraint. */
export interface AudienceRule {
  minBookings?: number;
  lastSeenDays?: number;
  lang?: 'en' | 'ar';
  hasPhone?: boolean;
  hasPush?: boolean;
}

/** Only the keys the server understands, with the types it casts them to. */
export function readRule(raw: Record<string, unknown> | null | undefined): AudienceRule {
  const r = raw ?? {};
  const out: AudienceRule = {};
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : typeof v === 'string' && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : undefined);
  const minBookings = int(r.minBookings);
  if (minBookings !== undefined) out.minBookings = minBookings;
  const lastSeenDays = int(r.lastSeenDays);
  if (lastSeenDays !== undefined) out.lastSeenDays = lastSeenDays;
  if (r.lang === 'en' || r.lang === 'ar') out.lang = r.lang;
  if (r.hasPhone === true) out.hasPhone = true;
  if (r.hasPush === true) out.hasPush = true;
  return out;
}

/** The rule as plain parts, in a fixed order, for "Bookings: at least 3 · Uses Arabic". */
export type RulePart =
  | { key: 'minBookings'; count: number }
  | { key: 'lastSeenDays'; count: number }
  | { key: 'langEn' | 'langAr' | 'hasPhone' | 'hasPush' };

export function ruleParts(rule: AudienceRule): RulePart[] {
  const parts: RulePart[] = [];
  if (rule.minBookings) parts.push({ key: 'minBookings', count: rule.minBookings });
  if (rule.lastSeenDays) parts.push({ key: 'lastSeenDays', count: rule.lastSeenDays });
  if (rule.lang === 'en') parts.push({ key: 'langEn' });
  if (rule.lang === 'ar') parts.push({ key: 'langAr' });
  if (rule.hasPhone) parts.push({ key: 'hasPhone' });
  if (rule.hasPush) parts.push({ key: 'hasPush' });
  return parts;
}

/** A form's whole-number text: '' is "no limit", anything else must be an integer ≥ 1. */
export function parseLimit(text: string): { ok: true; value: number | undefined } | { ok: false } {
  const t = text.trim();
  if (t === '') return { ok: true, value: undefined };
  if (!/^\d+$/.test(t) || Number(t) < 1) return { ok: false };
  return { ok: true, value: Number(t) };
}

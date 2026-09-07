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

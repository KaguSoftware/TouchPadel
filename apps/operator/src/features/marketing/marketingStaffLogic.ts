/**
 * The pure half of /marketing's two staff-facing lists (MarketingPanel.tsx;
 * build-contracts-2026-09-23 §2.17, §2.24.11, §5.5). Both come from the staff
 * side of marketing (C's marketing_staff and J's marketing_requests):
 *
 *  - "From marketing": app.marketing_suggestions, the drafts the marketing role
 *    suggested from the phone, by campaign id.
 *  - "Requests to marketing": app.marketing_requests_page, what staff asked
 *    marketing for and what marketing answered.
 *
 * Each payload is read defensively: anything that is not the RPC's shape reads
 * as nothing, and an unknown status or role never reaches the screen as a
 * catalog key. No React here, so the node tests beside it cover every branch.
 */
import { isStaffRole, type StaffRole } from '@touch/core/staff/roles';

/** One row of app.marketing_suggestions: a campaign marketing suggested. */
export interface MarketingSuggestion {
  campaign_id: string;
  suggested_by_name: string | null;
  suggestion_note: string | null;
  images: string[];
}

/** The RPC's drafts by campaign id; anything that is not its shape reads as none. */
export function readSuggestions(payload: unknown): Map<string, MarketingSuggestion> {
  const drafts = (payload as { drafts?: unknown } | null)?.drafts;
  const out = new Map<string, MarketingSuggestion>();
  if (!Array.isArray(drafts)) return out;
  for (const d of drafts) {
    if (d == null || typeof d !== 'object' || typeof (d as { campaign_id?: unknown }).campaign_id !== 'string') continue;
    const r = d as Record<string, unknown>;
    out.set(r.campaign_id as string, {
      campaign_id: r.campaign_id as string,
      suggested_by_name: typeof r.suggested_by_name === 'string' ? r.suggested_by_name : null,
      suggestion_note: typeof r.suggestion_note === 'string' && r.suggestion_note.trim() !== '' ? r.suggestion_note : null,
      images: Array.isArray(r.images) ? r.images.filter((i): i is string => typeof i === 'string') : [],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Requests to marketing (app.marketing_requests_page)
// ---------------------------------------------------------------------------

export type RequestFilter = 'open' | 'answered' | 'all';
export type RequestStatus = 'open' | 'done' | 'declined' | 'withdrawn';
const REQUEST_STATUSES: readonly RequestStatus[] = ['open', 'done', 'declined', 'withdrawn'];

export interface MarketingRequestRow {
  id: string;
  title: string;
  body: string;
  /** 'YYYY-MM-DD', the day the asker wants it by. */
  want_by: string | null;
  item_name_en: string | null;
  item_name_ar: string | null;
  photos: string[];
  status: RequestStatus;
  answer: string | null;
  answered_by_name: string | null;
  answered_at: string | null;
  created_at: string;
  requested_by_name: string | null;
  requested_by_role: StaffRole | null;
}

export interface MarketingRequests {
  requests: MarketingRequestRow[];
  open_count: number;
  total: number;
}

const strOr = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** The RPC's page; anything that is not its shape reads as an empty one. */
export function readRequests(payload: unknown): MarketingRequests {
  const p = payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const rows = Array.isArray(p.requests) ? p.requests : [];
  const requests = rows
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string')
    .map((r) => ({
      id: r.id as string,
      title: typeof r.title === 'string' ? r.title : '',
      body: typeof r.body === 'string' ? r.body : '',
      want_by: typeof r.want_by === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.want_by) ? r.want_by : null,
      item_name_en: strOr(r.item_name_en),
      item_name_ar: strOr(r.item_name_ar),
      photos: Array.isArray(r.photos) ? r.photos.filter((x): x is string => typeof x === 'string' && x !== '') : [],
      status: (REQUEST_STATUSES as readonly unknown[]).includes(r.status) ? (r.status as RequestStatus) : 'open',
      answer: strOr(r.answer),
      answered_by_name: strOr(r.answered_by_name),
      answered_at: strOr(r.answered_at),
      created_at: typeof r.created_at === 'string' ? r.created_at : '',
      requested_by_name: strOr(r.requested_by_name),
      requested_by_role: isStaffRole(r.requested_by_role) ? r.requested_by_role : null,
    }));
  const count = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return { requests, open_count: count(p.open_count, 0), total: count(p.total, requests.length) };
}

/** Still waiting for marketing after the day it was wanted by. */
export const isPastWanted = (r: Pick<MarketingRequestRow, 'status' | 'want_by'>, today: string): boolean =>
  r.status === 'open' && r.want_by !== null && r.want_by < today;

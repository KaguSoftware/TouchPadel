/**
 * Marketing on the staff phone (build-contracts-2026-09-23 §2.17, §2.24.11;
 * migrations 0168, 0187): marketing's own take on items, runs and campaigns,
 * its campaign drafts, what its campaigns reached (counts only), and the
 * requests every other role sends it.
 *
 * Each query stores the RPC's result as it comes, as supplies/api.ts does.
 */
import { supabase } from '../../../lib/supabase';
import { staffRpc, type StaffRpcName } from '../api';
import type { MarketingChannel, CampaignStatus } from './logic';

/**
 * Role-spec RPCs (lane J, 0187) that STAFF_RPCS in ../api.ts, lane B's list of
 * everything the phone may call, does not name yet. Integration appends them
 * there; until then this is the one place the list is widened.
 */
type RoleSpecRpc =
  | 'add_marketing_request'
  | 'withdraw_marketing_request'
  | 'answer_marketing_request'
  | 'my_marketing_requests'
  | 'marketing_requests_page'
  | 'marketing_campaign_results';

function call<T>(fn: StaffRpcName | RoleSpecRpc, args: Record<string, unknown>): Promise<T> {
  return staffRpc<T>(fn as StaffRpcName, args);
}

// ── My take (marketing_notes) ──────────────────────────────────────────────

export type NoteSubjectKind = 'item' | 'run' | 'campaign';

export interface MarketingNote {
  id: string;
  subject_kind: NoteSubjectKind;
  subject_id: string;
  subject_name_en: string | null;
  subject_name_ar: string | null;
  body: string;
  photos: string[];
  created_at: string;
}

export interface MyMarketingNotes {
  notes: MarketingNote[];
}

export function fetchMyMarketingNotes(venueId: string): Promise<MyMarketingNotes> {
  return call<MyMarketingNotes>('my_marketing_notes', { p_venue_id: venueId, p_limit: 50 });
}

export interface AddNoteArgs {
  p_venue_id: string;
  p_subject_kind: NoteSubjectKind;
  p_subject_id: string;
  p_body: string;
  p_photos: string[];
}

export function addMarketingNote(args: AddNoteArgs, key: string): Promise<{ id: string }> {
  return call<{ id: string }>('add_marketing_note', { ...args, p_idempotency_key: key });
}

// ── Campaign drafts ────────────────────────────────────────────────────────

export interface CampaignDraftRow {
  id: string;
  name_en: string;
  name_ar: string;
  channel: MarketingChannel;
  status: CampaignStatus;
  starts_at: string | null;
  ends_at: string | null;
  body_en: string;
  body_ar: string;
  note: string | null;
  images: string[];
  run_id: string | null;
  menu_item_id: string | null;
  suggested_at: string;
  /** Still a draft nobody else has saved: the suggester may change it. */
  editable: boolean;
}

export interface MyCampaignDrafts {
  drafts: CampaignDraftRow[];
}

export function fetchMyCampaignDrafts(venueId: string): Promise<MyCampaignDrafts> {
  return call<MyCampaignDrafts>('my_campaign_drafts', { p_venue_id: venueId });
}

export interface SuggestCampaignArgs {
  p_id: string | null;
  p_venue_id: string;
  p_name_en: string | null;
  p_name_ar: string | null;
  p_channel: MarketingChannel;
  p_starts_at: string | null;
  p_ends_at: string | null;
  p_body_en: string;
  p_body_ar: string;
  p_images: string[];
  p_run_id: string | null;
  p_menu_item_id: string | null;
  p_note: string | null;
}

/** A new draft carries a key; a change to one's own draft (p_id set) is a plain update and takes none. */
export function suggestCampaign(args: SuggestCampaignArgs, key: string | null): Promise<{ id: string }> {
  return call<{ id: string }>('suggest_campaign', { ...args, p_idempotency_key: key });
}

// ── Results (counts only, #73) ─────────────────────────────────────────────

export interface CampaignResult {
  campaign_id: string;
  name_en: string;
  name_ar: string;
  channel: MarketingChannel;
  status: CampaignStatus;
  starts_at: string | null;
  ends_at: string | null;
  sends: number;
  delivered: number;
  failed: number;
  last_sent_at: string | null;
  /** The campaign has a promotion, so its redemptions can be counted. */
  attributable: boolean;
  /** Null without a promotion: nothing to count, which is not the same as none. */
  redemptions: number | null;
  suggested_by_me: boolean;
}

export interface CampaignResults {
  campaigns: CampaignResult[];
}

export function fetchCampaignResults(venueId: string): Promise<CampaignResults> {
  return call<CampaignResults>('marketing_campaign_results', { p_venue_id: venueId, p_limit: 30 });
}

// ── Requests to marketing ──────────────────────────────────────────────────

export type MarketingRequestStatus = 'open' | 'done' | 'declined' | 'withdrawn';

export interface MarketingRequest {
  id: string;
  title: string;
  body: string;
  want_by: string | null;
  menu_item_id: string | null;
  item_name_en: string | null;
  item_name_ar: string | null;
  photos: string[];
  status: MarketingRequestStatus;
  answer: string | null;
  answered_by_name: string | null;
  answered_at: string | null;
  created_at: string;
  /** marketing_requests_page only. */
  requested_by_name?: string | null;
  requested_by_role?: string | null;
}

export interface MyMarketingRequests {
  requests: MarketingRequest[];
}

export function fetchMyMarketingRequests(venueId: string): Promise<MyMarketingRequests> {
  return call<MyMarketingRequests>('my_marketing_requests', { p_venue_id: venueId, p_limit: 30 });
}

export type RequestsFilter = 'open' | 'answered' | 'all';

export interface MarketingRequestsPage {
  requests: MarketingRequest[];
  open_count: number;
  total: number;
}

export function fetchMarketingRequestsPage(
  venueId: string,
  filter: RequestsFilter,
): Promise<MarketingRequestsPage> {
  return call<MarketingRequestsPage>('marketing_requests_page', {
    p_venue_id: venueId,
    p_filter: filter,
    p_limit: 50,
  });
}

export interface AddRequestArgs {
  p_title: string;
  p_body: string;
  p_want_by: string | null;
  p_menu_item_id: string | null;
  p_photos: string[];
  p_venue_id: string;
}

export function addMarketingRequest(args: AddRequestArgs, key: string): Promise<{ id: string }> {
  return call<{ id: string }>('add_marketing_request', { ...args, p_idempotency_key: key });
}

/** The asker takes back an open request. State-idempotent: no key. */
export function withdrawMarketingRequest(id: string): Promise<{ status: MarketingRequestStatus }> {
  return call('withdraw_marketing_request', { p_id: id });
}

/** Marketing answers an open request, done or declined. State-idempotent: no key. */
export function answerMarketingRequest(
  id: string,
  outcome: 'done' | 'declined',
  answer: string,
): Promise<{ status: MarketingRequestStatus; answered_at: string }> {
  return call('answer_marketing_request', { p_id: id, p_outcome: outcome, p_answer: answer });
}

// ── What a take, a draft or a request can name ─────────────────────────────

export interface MenuItemOption {
  id: string;
  name_en: string;
  name_ar: string;
}

/**
 * The venue's menu items, for the pickers: every item on sale or ever
 * launched, never a new-item draft (0172: a draft is switched off and never
 * launched). Read through the `menu_items_read` policy (0156: a staff member
 * reads their venues' items), which carries no price: prices live on the
 * variants.
 */
export async function fetchMenuItemOptions(venueId: string): Promise<MenuItemOption[]> {
  const { data, error } = await supabase
    .from('menu_items')
    .select('id, name_en, name_ar')
    .eq('venue_id', venueId)
    .or('is_active.eq.true,launched_at.not.is.null')
    .order('name_en')
    .limit(300);
  if (error) throw error;
  return (data ?? []) as MenuItemOption[];
}

/** One run of `app.protocol_runs_page` (0164 RunRow), the fields a picker shows. */
export interface RunOption {
  id: string;
  kind: 'product_release' | 'tournament' | 'hiring' | 'price_promo';
  title_en: string | null;
  title_ar: string | null;
  status: string;
}

export interface RunsPage {
  runs: RunOption[];
  total: number;
}

/** The runs in progress the caller is involved in (every run for MGMT), `protocol_runs_page` as it comes. */
export function fetchActiveRuns(venueId: string): Promise<RunsPage> {
  return call<RunsPage>('protocol_runs_page', { p_venue_id: venueId, p_filter: 'active' });
}

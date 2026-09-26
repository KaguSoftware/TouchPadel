/**
 * Marketing content for the owners' approval on the staff phone
 * (wave5-addendum-2026-09-25 §2.7, §5.3; migration 0199): marketing sends a
 * post (a caption, images, an optional link) and revises it round by round;
 * the owner approves, asks for changes or declines. Only marketing and the
 * owners read it (§8 Q14): never a manager.
 *
 * Each query stores the RPC's result as it comes, as supplies/api.ts does.
 */
import { staffRpc, type StaffRpcName } from '../api';

/** Wave-5 RPCs that STAFF_RPCS in ../api.ts (lane B's list) does not name. */
type ContentRpc =
  | 'submit_content'
  | 'revise_content'
  | 'withdraw_content'
  | 'decide_content'
  | 'content_page'
  | 'content_detail';

function call<T>(fn: ContentRpc, args: Record<string, unknown>): Promise<T> {
  return staffRpc<T>(fn as unknown as StaffRpcName, args);
}

/** marketing_content.channel (0199). */
export type ContentChannel =
  | 'instagram'
  | 'tiktok'
  | 'facebook'
  | 'snapchat'
  | 'whatsapp'
  | 'telegram'
  | 'guest_site'
  | 'in_venue'
  | 'print'
  | 'other';
export type ContentStatus = 'waiting' | 'changes' | 'approved' | 'declined' | 'withdrawn';
export type ContentDecision = 'approve' | 'changes' | 'decline';
export type ContentFilter = 'waiting' | 'changes' | 'approved' | 'closed' | 'all';

// ── The queue ───────────────────────────────────────────────────────────────

export interface ContentRow {
  id: string;
  title: string;
  channel: ContentChannel;
  planned_for: string;
  status: ContentStatus;
  current_version: number;
  author_name: string | null;
  submitted_at: string | null;
  /** The current version's first image, a staff-media path. */
  cover_image: string | null;
  menu_item_id: string | null;
  item_name_en: string | null;
  item_name_ar: string | null;
  campaign_id: string | null;
  campaign_name_en: string | null;
  campaign_name_ar: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  updated_at: string;
}

export interface ContentPage {
  content: ContentRow[];
  waiting_count: number;
  total: number;
}

export function fetchContentPage(venueId: string, filter: ContentFilter): Promise<ContentPage> {
  return call<ContentPage>('content_page', { p_venue_id: venueId, p_filter: filter, p_limit: 50 });
}

// ── One item, every round ───────────────────────────────────────────────────

export interface ContentVersion {
  version: number;
  body: string;
  images: string[];
  media_link: string | null;
  note: string | null;
  submitted_by_name: string | null;
  submitted_at: string;
  superseded_at: string | null;
  decision: ContentDecision | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

export interface ContentItem {
  id: string;
  title: string;
  channel: ContentChannel;
  planned_for: string;
  status: ContentStatus;
  current_version: number;
  author_name: string | null;
  menu_item_id: string | null;
  item_name_en: string | null;
  item_name_ar: string | null;
  campaign_id: string | null;
  campaign_name_en: string | null;
  campaign_name_ar: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContentDetail {
  content: ContentItem;
  /** Newest first. */
  versions: ContentVersion[];
  can_decide: boolean;
  can_revise: boolean;
  can_withdraw: boolean;
}

export function fetchContentDetail(id: string): Promise<ContentDetail> {
  return call<ContentDetail>('content_detail', { p_id: id });
}

// ── Marketing's writes ──────────────────────────────────────────────────────

export interface SubmitContentArgs {
  p_title: string;
  p_channel: ContentChannel;
  p_planned_for: string;
  p_body: string;
  p_images: string[];
  p_media_link: string | null;
  p_note: string | null;
  p_menu_item_id: string | null;
  p_campaign_id: string | null;
  p_venue_id: string;
}

export function submitContent(
  args: SubmitContentArgs,
  key: string,
): Promise<{ id: string; version: number; status: ContentStatus }> {
  return call('submit_content', { ...args, p_idempotency_key: key });
}

/** A header field left null keeps its value (0199). */
export interface ReviseContentArgs {
  p_id: string;
  p_body: string;
  p_images: string[];
  p_media_link: string | null;
  p_note: string | null;
  p_title: string | null;
  p_channel: ContentChannel | null;
  p_planned_for: string | null;
}

export function reviseContent(
  args: ReviseContentArgs,
  key: string,
): Promise<{ id: string; version: number; status: ContentStatus }> {
  return call('revise_content', { ...args, p_idempotency_key: key });
}

/** Marketing takes an item back while it waits or changes were asked. State-idempotent: no key. */
export function withdrawContent(id: string): Promise<{ status: ContentStatus }> {
  return call('withdraw_content', { p_id: id });
}

// ── The owner's decision ────────────────────────────────────────────────────

/** The owner decides the current open version. State-idempotent: no key. */
export function decideContent(
  id: string,
  version: number,
  decision: ContentDecision,
  note: string | null,
): Promise<{ status: ContentStatus; version: number; decided_at: string }> {
  return call('decide_content', {
    p_id: id,
    p_version: version,
    p_decision: decision,
    p_note: note,
  });
}

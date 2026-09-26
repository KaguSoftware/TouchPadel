/**
 * Pure helpers for marketing content approval (wave5-addendum-2026-09-25
 * §2.7, §5.2; Majed's answer #7: "they send stuff like content for the
 * owners' approval"): the readers of app.content_page and
 * app.content_detail, the send form's rules, and what the owner may decide.
 *
 * Marketing sends a post (a title, a channel, the day it is planned for, a
 * caption, images, an optional link and a note); the owner approves it, asks
 * for changes or declines it, the last two with a reason. Every round is an
 * immutable version, so the owner always decides exactly the version they
 * read. The owner never edits the text: only marketing sends a new version.
 */
import type { Tone } from '../../components/kit';
import { isObject, list, num, str } from '../roleExtras/roleExtrasLogic';

export const CONTENT_STATUSES = ['waiting', 'changes', 'approved', 'declined', 'withdrawn'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];
export const CONTENT_CHANNELS = ['instagram', 'tiktok', 'facebook', 'snapchat', 'whatsapp', 'telegram', 'guest_site', 'in_venue', 'print', 'other'] as const;
export type ContentChannel = (typeof CONTENT_CHANNELS)[number];
export const CONTENT_DECISIONS = ['approve', 'changes', 'decline'] as const;
export type ContentDecision = (typeof CONTENT_DECISIONS)[number];

/** The list's filters (§5.2): Waiting (oldest first), Changes asked, Approved, Closed (declined or withdrawn) and All. */
export const CONTENT_FILTERS = ['waiting', 'changes', 'approved', 'closed', 'all'] as const;
export type ContentFilter = (typeof CONTENT_FILTERS)[number];

export const CONTENT_PAGE_SIZE = 50;

/** What else a post may point at (§2.7: "a content item may point at a campaign or a menu item"), as the phone offers it. */
export const CONTENT_ABOUTS = ['none', 'item', 'campaign'] as const;
export type ContentAbout = (typeof CONTENT_ABOUTS)[number];

/** The server's limits (0199). */
export const TITLE_MAX = 120;
export const BODY_MAX = 4000;
export const NOTE_MAX = 1000;
export const LINK_MAX = 500;
export const IMAGES_MAX = 10;
const LINK_RE = /^https:\/\/\S+$/;

const statusOf = (v: unknown): ContentStatus => ((CONTENT_STATUSES as readonly unknown[]).includes(v) ? (v as ContentStatus) : 'waiting');
const channelOf = (v: unknown): ContentChannel => ((CONTENT_CHANNELS as readonly unknown[]).includes(v) ? (v as ContentChannel) : 'other');
const decisionOf = (v: unknown): ContentDecision | null => ((CONTENT_DECISIONS as readonly unknown[]).includes(v) ? (v as ContentDecision) : null);
const count = (v: unknown): number => Math.max(0, Math.floor(num(v) ?? 0));
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

// ---------------------------------------------------------------------------
// app.content_page
// ---------------------------------------------------------------------------

export interface ContentRow {
  id: string;
  title: string;
  channel: ContentChannel;
  plannedFor: string | null;
  status: ContentStatus;
  currentVersion: number;
  authorName: string | null;
  submittedAt: string | null;
  coverImage: string | null;
  menuItemId: string | null;
  campaignId: string | null;
  itemNameEn: string | null;
  itemNameAr: string | null;
  campaignNameEn: string | null;
  campaignNameAr: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  updatedAt: string | null;
}

export interface ContentPage {
  rows: ContentRow[];
  waitingCount: number;
  total: number;
}

function readHeader(r: Record<string, unknown>): ContentRow {
  return {
    id: str(r.id) ?? '',
    title: str(r.title) ?? '',
    channel: channelOf(r.channel),
    plannedFor: str(r.planned_for),
    status: statusOf(r.status),
    currentVersion: Math.max(1, count(r.current_version)),
    authorName: str(r.author_name),
    submittedAt: str(r.submitted_at),
    coverImage: str(r.cover_image),
    menuItemId: str(r.menu_item_id),
    campaignId: str(r.campaign_id),
    itemNameEn: str(r.item_name_en),
    itemNameAr: str(r.item_name_ar),
    campaignNameEn: str(r.campaign_name_en),
    campaignNameAr: str(r.campaign_name_ar),
    decidedByName: str(r.decided_by_name),
    decidedAt: str(r.decided_at),
    updatedAt: str(r.updated_at),
  };
}

export function readContentPage(payload: unknown): ContentPage {
  const p = isObject(payload) ? payload : {};
  return {
    rows: list(p.content)
      .filter((r) => typeof r.id === 'string')
      .map(readHeader),
    waitingCount: count(p.waiting_count),
    total: count(p.total),
  };
}

/** The owner's rail badge and the Waiting filter: posts waiting on a decision. */
export function contentWaitingCount(payload: unknown): number {
  return readContentPage(payload).waitingCount;
}

// ---------------------------------------------------------------------------
// app.content_detail
// ---------------------------------------------------------------------------

export interface ContentVersion {
  version: number;
  body: string;
  images: string[];
  mediaLink: string | null;
  note: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  /** A newer version was sent before this one was decided. */
  supersededAt: string | null;
  decision: ContentDecision | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface ContentDetail {
  content: ContentRow | null;
  /** Newest first. */
  versions: ContentVersion[];
  canDecide: boolean;
  canRevise: boolean;
  canWithdraw: boolean;
}

export function readContentDetail(payload: unknown): ContentDetail {
  const p = isObject(payload) ? payload : {};
  const content = isObject(p.content) && typeof p.content.id === 'string' ? readHeader(p.content) : null;
  const versions = list(p.versions)
    .map(
      (v): ContentVersion => ({
        version: Math.max(1, count(v.version)),
        body: str(v.body) ?? '',
        images: strings(v.images),
        mediaLink: str(v.media_link),
        note: str(v.note),
        submittedByName: str(v.submitted_by_name),
        submittedAt: str(v.submitted_at),
        supersededAt: str(v.superseded_at),
        decision: decisionOf(v.decision),
        decidedByName: str(v.decided_by_name),
        decidedAt: str(v.decided_at),
        decisionNote: str(v.decision_note),
      }),
    )
    .sort((a, b) => b.version - a.version);
  return { content, versions, canDecide: p.can_decide === true, canRevise: p.can_revise === true, canWithdraw: p.can_withdraw === true };
}

/** Amber while someone must act (the owner, or marketing after "changes"), green approved, red declined. */
export function contentTone(status: ContentStatus): Tone {
  switch (status) {
    case 'waiting':
    case 'changes':
      return 'warn';
    case 'approved':
      return 'success';
    case 'declined':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function decisionTone(decision: ContentDecision): Tone {
  return decision === 'approve' ? 'success' : decision === 'changes' ? 'warn' : 'danger';
}

/** A closed item (approved, declined, withdrawn) cannot change: marketing sends it again as a new one (§8 Q16). */
export function canSendAgain(status: ContentStatus): boolean {
  return status === 'approved' || status === 'declined' || status === 'withdrawn';
}

/** The owner's decision needs a reason for changes and decline (REASON_REQUIRED), at most 1000. */
export function decisionIssue(decision: ContentDecision, note: string): 'required' | 'tooLong' | null {
  const n = note.trim();
  if (decision !== 'approve' && n === '') return 'required';
  if ([...n].length > NOTE_MAX) return 'tooLong';
  return null;
}

// ---------------------------------------------------------------------------
// The send form (submit a new item, revise it, or send a closed one again)
// ---------------------------------------------------------------------------

export interface ContentDraft {
  title: string;
  channel: ContentChannel | '';
  /** 'YYYY-MM-DD'. */
  plannedFor: string;
  body: string;
  images: string[];
  link: string;
  note: string;
  /** A new post only: the menu item or campaign it is also about (revise_content keeps the item's own). */
  about: ContentAbout;
  aboutId: string;
}

export type ContentField = 'title' | 'channel' | 'plannedFor' | 'body' | 'images' | 'link' | 'note' | 'about';
export type ContentIssueCode = 'required' | 'tooLong' | 'past' | 'link' | 'tooMany';
export interface ContentIssue {
  field: ContentField;
  code: ContentIssueCode;
}

export const EMPTY_DRAFT: ContentDraft = { title: '', channel: '', plannedFor: '', body: '', images: [], link: '', note: '', about: 'none', aboutId: '' };

const chars = (s: string) => [...s.trim()].length;

/**
 * The rules of app.submit_content and app.revise_content. On a revision the
 * planned day is only checked when it changed: the server keeps the stored one
 * when none is sent, even if that day has passed.
 */
export function validateContent(d: ContentDraft, today: string, keptPlannedFor: string | null = null): ContentIssue[] {
  const issues: ContentIssue[] = [];
  if (d.title.trim() === '') issues.push({ field: 'title', code: 'required' });
  else if (chars(d.title) > TITLE_MAX) issues.push({ field: 'title', code: 'tooLong' });
  if (d.channel === '') issues.push({ field: 'channel', code: 'required' });
  if (d.plannedFor === '') issues.push({ field: 'plannedFor', code: 'required' });
  else if (d.plannedFor < today && d.plannedFor !== keptPlannedFor) issues.push({ field: 'plannedFor', code: 'past' });
  if (d.body.trim() === '') issues.push({ field: 'body', code: 'required' });
  else if (chars(d.body) > BODY_MAX) issues.push({ field: 'body', code: 'tooLong' });
  if (d.images.length > IMAGES_MAX) issues.push({ field: 'images', code: 'tooMany' });
  const link = d.link.trim();
  if (link !== '' && (link.length > LINK_MAX || !LINK_RE.test(link))) issues.push({ field: 'link', code: 'link' });
  if (chars(d.note) > NOTE_MAX) issues.push({ field: 'note', code: 'tooLong' });
  if (d.about !== 'none' && d.aboutId === '') issues.push({ field: 'about', code: 'required' });
  return issues;
}

const blank = (s: string) => (s.trim() === '' ? null : s.trim());

/** app.submit_content's arguments. */
export function submitArgs(d: ContentDraft, key: string): Record<string, unknown> {
  return {
    p_title: d.title.trim(),
    p_channel: d.channel,
    p_planned_for: d.plannedFor,
    p_body: d.body.trim(),
    p_images: d.images,
    p_media_link: blank(d.link),
    p_note: blank(d.note),
    p_menu_item_id: d.about === 'item' && d.aboutId !== '' ? d.aboutId : null,
    p_campaign_id: d.about === 'campaign' && d.aboutId !== '' ? d.aboutId : null,
    p_idempotency_key: key,
  };
}

/**
 * app.revise_content's arguments. A header field goes only when it changed:
 * NULL keeps the stored value, which also keeps a planned day that has since
 * passed from being refused.
 */
export function reviseArgs(id: string, d: ContentDraft, before: Pick<ContentRow, 'title' | 'channel' | 'plannedFor'>, key: string): Record<string, unknown> {
  return {
    p_id: id,
    p_body: d.body.trim(),
    p_images: d.images,
    p_media_link: blank(d.link),
    p_note: blank(d.note),
    p_title: d.title.trim() !== before.title ? d.title.trim() : null,
    p_channel: d.channel !== before.channel ? d.channel : null,
    p_planned_for: d.plannedFor !== before.plannedFor ? d.plannedFor : null,
    p_idempotency_key: key,
  };
}

/**
 * The form a revision or "send again" opens with: the item's header and its
 * newest version, so marketing edits what the owner saw. A new version's note
 * starts empty (it is about this round). "Send again" starts with no images
 * and no planned day: each item claims its own photos (a path another item
 * holds is PHOTO_PATH_INVALID, 0199), and the old day has usually passed.
 */
export function draftFrom(detail: ContentDetail, mode: 'revise' | 'again'): ContentDraft {
  const c = detail.content;
  const v = detail.versions[0];
  return {
    title: c?.title ?? '',
    channel: c?.channel ?? '',
    plannedFor: mode === 'revise' ? (c?.plannedFor ?? '') : '',
    body: v?.body ?? '',
    // A new item cannot claim another item's photos (PHOTO_PATH_INVALID): send again starts without them.
    images: mode === 'revise' ? (v?.images ?? []) : [],
    link: v?.mediaLink ?? '',
    note: '',
    // Sent again as new, it stays about what the item was about; a revision keeps the item's own.
    about: mode === 'again' && c?.menuItemId ? 'item' : mode === 'again' && c?.campaignId ? 'campaign' : 'none',
    aboutId: mode === 'again' ? (c?.menuItemId ?? c?.campaignId ?? '') : '',
  };
}

/** One choice in the "Also about" picker. */
export interface AboutOption {
  id: string;
  nameEn: string;
  nameAr: string;
}

/** app.marketing_campaign_results' campaigns (0187), as picker choices. */
export function readCampaignOptions(payload: unknown): AboutOption[] {
  const p = isObject(payload) ? payload : {};
  return list(p.campaigns)
    .filter((c) => typeof c.campaign_id === 'string')
    .map((c) => ({ id: c.campaign_id as string, nameEn: str(c.name_en) ?? '', nameAr: str(c.name_ar) ?? '' }));
}

/** The field a server refusal names (the hints of submit_content / revise_content). */
export function contentRefusalField(code: string | null, hint: string | null): ContentField | null {
  if (code === 'TEXT_REQUIRED' || code === 'TEXT_TOO_LONG') {
    if (hint === 'title') return 'title';
    if (hint === 'body') return 'body';
    if (hint === 'note') return 'note';
  }
  if (code === 'INVALID_ARGUMENT') {
    if (hint === 'channel') return 'channel';
    if (hint === 'planned_for') return 'plannedFor';
    if (hint === 'media_link') return 'link';
    if (hint === 'images') return 'images';
  }
  if (code === 'PHOTO_PATH_INVALID') return 'images';
  // The item or campaign it points at is gone (0199 submit_content).
  if (code === 'ITEM_NOT_FOUND' || code === 'CAMPAIGN_NOT_FOUND') return 'about';
  return null;
}

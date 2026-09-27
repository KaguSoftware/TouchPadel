/**
 * Marketing content as rules (wave5-addendum-2026-09-25 §2.7, §5.3): who
 * sends and who decides, the post as a draft with its checks and RPC
 * arguments (a new item, the next version of one, or "Send again" from a
 * closed one), and the owner's decision. The server keeps the caps and the
 * state machine (0199); these catch a bad field before the round trip.
 *
 * PURE (vitest): no react-native, no client.
 */
import { parseTypedDate, type StaffRole } from '@touch/core';
import type {
  ContentChannel,
  ContentDecision,
  ContentDetail,
  ContentFilter,
  ContentItem,
  ContentStatus,
  ContentVersion,
  ReviseContentArgs,
  SubmitContentArgs,
} from './api';

/** Marketing sends, the owners decide (§2.7.1); a manager reads nothing (§8 Q14). */
export const CONTENT_ROLES: readonly StaffRole[] = ['marketing', 'owner'];

export interface ContentAccess {
  /** submit_content, revise_content, withdraw_content: marketing only. */
  sends: boolean;
  /** decide_content: the owner only. */
  decides: boolean;
}

export function contentAccess(role: StaffRole): ContentAccess {
  return { sends: role === 'marketing', decides: role === 'owner' };
}

export const CONTENT_CHANNELS: readonly ContentChannel[] = [
  'instagram',
  'tiktok',
  'facebook',
  'snapchat',
  'whatsapp',
  'telegram',
  'guest_site',
  'in_venue',
  'print',
  'other',
];

export const CONTENT_FILTERS: readonly ContentFilter[] = [
  'waiting',
  'changes',
  'approved',
  'closed',
  'all',
];

/** The owner opens on what waits for them; marketing on its whole queue, newest first. */
export function initialFilter(access: ContentAccess): ContentFilter {
  return access.decides ? 'waiting' : 'all';
}

/** Server caps (0199). */
export const CONTENT_CAPS = {
  title: 120,
  body: 4000,
  images: 10,
  link: 500,
  note: 1000,
  decisionNote: 1000,
} as const;

/** `media_link`'s CHECK (0199): an https:// link with no spaces. */
const LINK = /^https:\/\/\S+$/;

/** What else a post is about, beside its caption: nothing, a menu item or a campaign. */
export type ContentLinkKind = 'none' | 'item' | 'campaign';
export const CONTENT_LINK_KINDS: readonly ContentLinkKind[] = ['none', 'item', 'campaign'];

export interface ContentDraft {
  title: string;
  channel: ContentChannel | null;
  plannedFor: string;
  body: string;
  link: string;
  note: string;
  images: string[];
  linkKind: ContentLinkKind;
  linkId: string | null;
}

export type ContentField =
  'title' | 'channel' | 'plannedFor' | 'body' | 'link' | 'note' | 'images' | 'linkId';
export type ContentIssueCode = 'required' | 'invalid' | 'tooLong' | 'past';

export interface ContentIssue {
  field: ContentField;
  code: ContentIssueCode;
}

export function emptyContentDraft(): ContentDraft {
  return {
    title: '',
    channel: null,
    plannedFor: '',
    body: '',
    link: '',
    note: '',
    images: [],
    linkKind: 'none',
    linkId: null,
  };
}

/** The version an item is on: the one its `current_version` names, else the newest. */
export function currentVersion(detail: ContentDetail): ContentVersion | null {
  return (
    detail.versions.find((v) => v.version === detail.content.current_version) ??
    detail.versions[0] ??
    null
  );
}

function linkOf(item: ContentItem): Pick<ContentDraft, 'linkKind' | 'linkId'> {
  if (item.menu_item_id) return { linkKind: 'item', linkId: item.menu_item_id };
  if (item.campaign_id) return { linkKind: 'campaign', linkId: item.campaign_id };
  return { linkKind: 'none', linkId: null };
}

/** The next version of an item, prefilled from the one it is on, its images kept. */
export function draftFromDetail(detail: ContentDetail): ContentDraft {
  const v = currentVersion(detail);
  return {
    title: detail.content.title,
    channel: detail.content.channel,
    plannedFor: detail.content.planned_for,
    body: v?.body ?? '',
    link: v?.media_link ?? '',
    note: '',
    images: v ? [...v.images] : [],
    ...linkOf(detail.content),
  };
}

/**
 * "Send again": a new item from a closed one (approved is final, §8 Q16). The
 * text and links carry over; the images do not, because each is claimed by
 * the item it was sent with (PHOTO_PATH_INVALID on another), and a planned
 * day already past is left for the person to choose again.
 */
export function sendAgainDraft(detail: ContentDetail, today: string): ContentDraft {
  const next = draftFromDetail(detail);
  return { ...next, images: [], plannedFor: next.plannedFor >= today ? next.plannedFor : '' };
}

/**
 * Check a post; an empty list means it can be sent. `today` is the phone's
 * own day; the server checks the venue's. With `base` (a revision), a planned
 * day left as it was is not checked again: the server keeps it unchanged.
 */
export function validateContent(
  draft: ContentDraft,
  today: string,
  base?: ContentItem,
): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const title = draft.title.trim();
  if (!title) issues.push({ field: 'title', code: 'required' });
  else if (title.length > CONTENT_CAPS.title) issues.push({ field: 'title', code: 'tooLong' });
  if (!draft.channel) issues.push({ field: 'channel', code: 'required' });

  if (!draft.plannedFor.trim()) issues.push({ field: 'plannedFor', code: 'required' });
  else {
    const day = parseTypedDate(draft.plannedFor);
    if (!day) issues.push({ field: 'plannedFor', code: 'invalid' });
    else if (day < today && day !== base?.planned_for)
      issues.push({ field: 'plannedFor', code: 'past' });
  }

  const body = draft.body.trim();
  if (!body) issues.push({ field: 'body', code: 'required' });
  else if (body.length > CONTENT_CAPS.body) issues.push({ field: 'body', code: 'tooLong' });

  const link = draft.link.trim();
  if (link && (link.length > CONTENT_CAPS.link || !LINK.test(link)))
    issues.push({ field: 'link', code: 'invalid' });
  if (draft.note.trim().length > CONTENT_CAPS.note) issues.push({ field: 'note', code: 'tooLong' });
  if (draft.images.length > CONTENT_CAPS.images) issues.push({ field: 'images', code: 'tooLong' });
  if (!base && draft.linkKind !== 'none' && !draft.linkId)
    issues.push({ field: 'linkId', code: 'required' });
  return issues;
}

/** submit_content's arguments from a draft that passed `validateContent`. */
export function contentArgs(draft: ContentDraft, venueId: string): SubmitContentArgs {
  return {
    p_title: draft.title.trim(),
    p_channel: draft.channel ?? 'other',
    p_planned_for: parseTypedDate(draft.plannedFor) ?? draft.plannedFor,
    p_body: draft.body.trim(),
    p_images: draft.images,
    p_media_link: draft.link.trim() || null,
    p_note: draft.note.trim() || null,
    p_menu_item_id: draft.linkKind === 'item' ? draft.linkId : null,
    p_campaign_id: draft.linkKind === 'campaign' ? draft.linkId : null,
    p_venue_id: venueId,
  };
}

/**
 * revise_content's arguments. A title, channel or planned day the person left
 * as it was goes as null, so the server keeps it: a planned day now in the
 * past would otherwise be refused on a revision that never touched it.
 */
export function reviseArgs(draft: ContentDraft, base: ContentItem): ReviseContentArgs {
  const title = draft.title.trim();
  const planned = parseTypedDate(draft.plannedFor) ?? draft.plannedFor;
  return {
    p_id: base.id,
    p_body: draft.body.trim(),
    p_images: draft.images,
    p_media_link: draft.link.trim() || null,
    p_note: draft.note.trim() || null,
    p_title: title === base.title ? null : title,
    p_channel: draft.channel === base.channel ? null : draft.channel,
    p_planned_for: planned === base.planned_for ? null : planned,
  };
}

// ── The owner's decision ────────────────────────────────────────────────────

/** Ask for changes and Decline need a reason; an approval's note is optional. */
export function validateDecision(
  decision: ContentDecision,
  note: string,
): 'required' | 'tooLong' | null {
  const text = note.trim();
  if (text.length > CONTENT_CAPS.decisionNote) return 'tooLong';
  if (!text && decision !== 'approve') return 'required';
  return null;
}

// ── Lists ───────────────────────────────────────────────────────────────────

export type ContentTone = 'good' | 'warn' | 'bad' | 'info' | 'plain';

/** Waiting is on the owner, changes asked is on marketing, approved is done, the rest closed. */
export const CONTENT_TONE: Record<ContentStatus, ContentTone> = {
  waiting: 'warn',
  changes: 'info',
  approved: 'good',
  declined: 'bad',
  withdrawn: 'plain',
};

/** A closed item can be sent again as a new one (§8 Q16: approved is final). */
export function canSendAgain(status: ContentStatus): boolean {
  return status === 'approved' || status === 'declined' || status === 'withdrawn';
}

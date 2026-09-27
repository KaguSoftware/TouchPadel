/**
 * Marketing's pages as rules (build-contracts-2026-09-23 §2.17, §2.24.11,
 * §6.1; plan #14, #73): the take, the campaign draft and the request to
 * marketing as drafts with their checks and RPC arguments, who asks and who
 * answers, and the results as counts. The server keeps the caps and the
 * guards; these catch a bad field before the round trip.
 *
 * PURE (vitest): no react-native, no client.
 */
import { localParts, parseTypedDate, wallTimeToUtc, type StaffRole } from '@touch/core';
import { VENUE_TZ } from '@touch/i18n';
import type {
  AddNoteArgs,
  AddRequestArgs,
  CampaignDraftRow,
  MarketingRequest,
  NoteSubjectKind,
  SuggestCampaignArgs,
} from './api';

/** marketing_channel (0073). */
export type MarketingChannel = 'telegram' | 'guest_site' | 'in_venue';
export const MARKETING_CHANNELS: readonly MarketingChannel[] = ['telegram', 'guest_site', 'in_venue'];

/** campaign_status (0073). */
export type CampaignStatus = 'draft' | 'scheduled' | 'live' | 'ended' | 'cancelled';

export const MARKETING_TABS = ['take', 'drafts', 'results'] as const;
export type MarketingTab = (typeof MARKETING_TABS)[number];

export const NOTE_SUBJECT_KINDS: readonly NoteSubjectKind[] = ['item', 'run', 'campaign'];

/** Server caps (0168, 0187, §2.1). */
export const CAPS = {
  noteBody: 2000,
  notePhotos: 6,
  campaignName: 120,
  campaignBody: 2000,
  campaignNote: 2000,
  campaignImages: 6,
  requestTitle: 120,
  requestBody: 2000,
  requestPhotos: 4,
  answer: 2000,
} as const;

export type IssueCode = 'required' | 'invalid' | 'tooLong' | 'order' | 'past';
export interface Issue<F extends string> {
  field: F;
  code: IssueCode;
}

const MGMT: readonly StaffRole[] = ['manager', 'owner'];

// ── Who does what with requests to marketing (#73) ─────────────────────────

export interface RequestsView {
  /** Asks and follows their own: every role but marketing (PROPOSAL, §2.24.11). */
  asks: boolean;
  /** Answers: marketing only. */
  answers: boolean;
  /** Reads every request at the venue: marketing (its inbox) and MGMT (read only). */
  readsAll: boolean;
}

export function requestsView(role: StaffRole): RequestsView {
  const marketing = role === 'marketing';
  return { asks: !marketing, answers: marketing, readsAll: marketing || MGMT.includes(role) };
}

/** The inbox filters of `marketing_requests_page`. */
export const REQUEST_FILTERS = ['open', 'answered', 'all'] as const;

/** A request a push or a link named goes first; the rest keep the server's order. */
export function namedFirst<T extends { id: string }>(rows: readonly T[], id: string | undefined): T[] {
  if (!id) return [...rows];
  return [...rows.filter((r) => r.id === id), ...rows.filter((r) => r.id !== id)];
}

export function canWithdraw(request: MarketingRequest): boolean {
  return request.status === 'open';
}

export function canAnswer(view: RequestsView, request: MarketingRequest): boolean {
  return view.answers && request.status === 'open';
}

// ── Days as typed ──────────────────────────────────────────────────────────

/** A day typed into an optional date field: '' is no day, a bad one is invalid. */
function typedDay(text: string): { day: string | null; ok: boolean } {
  if (!text.trim()) return { day: null, ok: true };
  const day = parseTypedDate(text);
  return { day, ok: day !== null };
}

/** The venue's calendar day of an instant, `YYYY-MM-DD`. */
export function venueDay(iso: string): string {
  return localParts(new Date(iso), VENUE_TZ).date;
}

/** A campaign day's first minute, as the instant `starts_at` stores. */
export function dayStartIso(day: string): string {
  return wallTimeToUtc(day, 0, VENUE_TZ).toISOString();
}

/** A campaign day's last minute, as the instant `ends_at` stores (the window's end is after its start). */
export function dayEndIso(day: string): string {
  return wallTimeToUtc(day, 23 * 60 + 59, VENUE_TZ).toISOString();
}

// ── My take ────────────────────────────────────────────────────────────────

export interface NoteDraft {
  subjectKind: NoteSubjectKind;
  subjectId: string | null;
  body: string;
  photos: string[];
}

export type NoteField = 'subject' | 'body' | 'photos';

export function emptyNoteDraft(): NoteDraft {
  return { subjectKind: 'item', subjectId: null, body: '', photos: [] };
}

export function validateNote(draft: NoteDraft): Issue<NoteField>[] {
  const issues: Issue<NoteField>[] = [];
  if (!draft.subjectId) issues.push({ field: 'subject', code: 'required' });
  const body = draft.body.trim();
  if (!body) issues.push({ field: 'body', code: 'required' });
  else if (body.length > CAPS.noteBody) issues.push({ field: 'body', code: 'tooLong' });
  if (draft.photos.length > CAPS.notePhotos) issues.push({ field: 'photos', code: 'tooLong' });
  return issues;
}

export function noteArgs(draft: NoteDraft, venueId: string): AddNoteArgs {
  return {
    p_venue_id: venueId,
    p_subject_kind: draft.subjectKind,
    p_subject_id: draft.subjectId ?? '',
    p_body: draft.body.trim(),
    p_photos: draft.photos,
  };
}

// ── Campaign drafts ────────────────────────────────────────────────────────

/** What a draft is about, beside its message: nothing, a menu item or a run. */
export type DraftLinkKind = 'none' | 'item' | 'run';

export interface CampaignDraft {
  /** The draft being changed, or null for a new one. */
  id: string | null;
  /** One name, in whichever language it was typed (the server fills the other, 0168). */
  name: string;
  channel: MarketingChannel | null;
  starts: string;
  ends: string;
  bodyEn: string;
  bodyAr: string;
  note: string;
  images: string[];
  linkKind: DraftLinkKind;
  linkId: string | null;
}

export type CampaignField = 'name' | 'channel' | 'starts' | 'ends' | 'bodyEn' | 'bodyAr' | 'note' | 'images' | 'link';

/** A new draft starts on the first channel, which the channel control shows chosen. */
export function emptyCampaignDraft(): CampaignDraft {
  return {
    id: null,
    name: '',
    channel: MARKETING_CHANNELS[0] ?? null,
    starts: '',
    ends: '',
    bodyEn: '',
    bodyAr: '',
    note: '',
    images: [],
    linkKind: 'none',
    linkId: null,
  };
}

/** One's own saved draft, back in the form to change it. The name shows in the reader's language. */
export function draftFromRow(row: CampaignDraftRow, locale: 'en' | 'ar'): CampaignDraft {
  const link: Pick<CampaignDraft, 'linkKind' | 'linkId'> = row.menu_item_id
    ? { linkKind: 'item', linkId: row.menu_item_id }
    : row.run_id
      ? { linkKind: 'run', linkId: row.run_id }
      : { linkKind: 'none', linkId: null };
  return {
    id: row.id,
    name: locale === 'ar' ? row.name_ar : row.name_en,
    channel: row.channel,
    starts: row.starts_at ? venueDay(row.starts_at) : '',
    ends: row.ends_at ? venueDay(row.ends_at) : '',
    bodyEn: row.body_en,
    bodyAr: row.body_ar,
    note: row.note ?? '',
    images: [...row.images],
    ...link,
  };
}

export function validateCampaign(draft: CampaignDraft): Issue<CampaignField>[] {
  const issues: Issue<CampaignField>[] = [];
  const name = draft.name.trim();
  if (!name) issues.push({ field: 'name', code: 'required' });
  else if (name.length > CAPS.campaignName) issues.push({ field: 'name', code: 'tooLong' });
  if (!draft.channel) issues.push({ field: 'channel', code: 'required' });
  const starts = typedDay(draft.starts);
  const ends = typedDay(draft.ends);
  if (!starts.ok) issues.push({ field: 'starts', code: 'invalid' });
  if (!ends.ok) issues.push({ field: 'ends', code: 'invalid' });
  if (starts.day && ends.day && ends.day < starts.day) issues.push({ field: 'ends', code: 'order' });
  if (draft.bodyEn.trim().length > CAPS.campaignBody) issues.push({ field: 'bodyEn', code: 'tooLong' });
  if (draft.bodyAr.trim().length > CAPS.campaignBody) issues.push({ field: 'bodyAr', code: 'tooLong' });
  if (draft.note.trim().length > CAPS.campaignNote) issues.push({ field: 'note', code: 'tooLong' });
  if (draft.images.length > CAPS.campaignImages) issues.push({ field: 'images', code: 'tooLong' });
  if (draft.linkKind !== 'none' && !draft.linkId) issues.push({ field: 'link', code: 'required' });
  return issues;
}

/** Arabic script anywhere in the text: the name was typed in Arabic. */
export function typedInArabic(text: string): boolean {
  return /[؀-ۿ]/.test(text);
}

export function campaignArgs(draft: CampaignDraft, venueId: string): SuggestCampaignArgs {
  const name = draft.name.trim();
  const arabic = typedInArabic(name);
  const starts = typedDay(draft.starts).day;
  const ends = typedDay(draft.ends).day;
  return {
    p_id: draft.id,
    p_venue_id: venueId,
    p_name_en: arabic ? null : name,
    p_name_ar: arabic ? name : null,
    p_channel: draft.channel ?? 'telegram',
    p_starts_at: starts ? dayStartIso(starts) : null,
    p_ends_at: ends ? dayEndIso(ends) : null,
    p_body_en: draft.bodyEn.trim(),
    p_body_ar: draft.bodyAr.trim(),
    p_images: draft.images,
    p_run_id: draft.linkKind === 'run' ? draft.linkId : null,
    p_menu_item_id: draft.linkKind === 'item' ? draft.linkId : null,
    p_note: draft.note.trim() || null,
  };
}

// ── Requests to marketing ──────────────────────────────────────────────────

export interface RequestDraft {
  title: string;
  body: string;
  wantBy: string;
  menuItemId: string | null;
  photos: string[];
}

export type RequestField = 'title' | 'body' | 'wantBy' | 'photos';

export function emptyRequestDraft(): RequestDraft {
  return { title: '', body: '', wantBy: '', menuItemId: null, photos: [] };
}

/** `today` is the phone's own day (localIsoDate); the server checks the venue's. */
export function validateRequest(draft: RequestDraft, today: string): Issue<RequestField>[] {
  const issues: Issue<RequestField>[] = [];
  const title = draft.title.trim();
  if (!title) issues.push({ field: 'title', code: 'required' });
  else if (title.length > CAPS.requestTitle) issues.push({ field: 'title', code: 'tooLong' });
  const body = draft.body.trim();
  if (!body) issues.push({ field: 'body', code: 'required' });
  else if (body.length > CAPS.requestBody) issues.push({ field: 'body', code: 'tooLong' });
  const want = typedDay(draft.wantBy);
  if (!want.ok) issues.push({ field: 'wantBy', code: 'invalid' });
  else if (want.day && want.day < today) issues.push({ field: 'wantBy', code: 'past' });
  if (draft.photos.length > CAPS.requestPhotos) issues.push({ field: 'photos', code: 'tooLong' });
  return issues;
}

export function requestArgs(draft: RequestDraft, venueId: string): AddRequestArgs {
  return {
    p_title: draft.title.trim(),
    p_body: draft.body.trim(),
    p_want_by: typedDay(draft.wantBy).day,
    p_menu_item_id: draft.menuItemId,
    p_photos: draft.photos,
    p_venue_id: venueId,
  };
}

export function validateAnswer(answer: string): IssueCode | null {
  const text = answer.trim();
  if (!text) return 'required';
  return text.length > CAPS.answer ? 'tooLong' : null;
}

// ── Names ──────────────────────────────────────────────────────────────────

/** A bilingual name in the reader's language, falling back to the other (a run title may carry one). */
export function localName(
  en: string | null | undefined,
  ar: string | null | undefined,
  locale: 'en' | 'ar',
): string {
  const mine = locale === 'ar' ? ar : en;
  const other = locale === 'ar' ? en : ar;
  return (mine && mine.trim()) || (other && other.trim()) || '';
}

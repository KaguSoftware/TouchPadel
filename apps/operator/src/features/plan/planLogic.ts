/**
 * Marketing's month content plan (0362), pure: the reader of
 * app.marketing_plan, where each idea stands, the idea form's rules, the
 * weekly repeat, and the Google Drive check on a result's link.
 *
 * The month: marketing writes ideas on days (draft), sends the plan to the
 * owner (waiting), the owner approves it, leaving out any ideas they do not
 * want, or asks for changes. Each approved idea is then made and its result
 * sent as a content item (0199), which the owner approves, asks to change or
 * declines. An idea's stage folds both: what the owner said about the idea,
 * then what became of its result.
 */
import type { Tone } from '../../components/kit';
import { isObject, list, num, str } from '../roleExtras/roleExtrasLogic';
import { CONTENT_CHANNELS, CONTENT_STATUSES, type ContentChannel, type ContentStatus } from '../content/contentLogic';
import { daysInMonth, monthStart } from '../desk/calendar/monthLogic';
import { shiftIsoDate } from '../desk/weekLogic';

export const IDEA_KINDS = ['post', 'reel', 'story', 'poster', 'design', 'offer', 'event', 'other'] as const;
export type IdeaKind = (typeof IDEA_KINDS)[number];
export const PLAN_STATUSES = ['draft', 'waiting', 'changes', 'approved'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const IDEA_STATUSES = ['proposed', 'approved', 'dropped', 'cancelled'] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

/** The server's limits (0362). */
export const IDEA_TITLE_MAX = 120;
export const IDEA_DETAILS_MAX = 2000;
export const PLAN_NOTE_MAX = 1000;

const oneOf = <T extends string>(all: readonly T[], v: unknown, fallback: T): T => ((all as readonly unknown[]).includes(v) ? (v as T) : fallback);

// ---------------------------------------------------------------------------
// app.marketing_plan
// ---------------------------------------------------------------------------

export interface IdeaResult {
  id: string;
  status: ContentStatus;
  version: number;
}

export interface PlanIdea {
  id: string;
  day: string;
  title: string;
  kind: IdeaKind;
  channel: ContentChannel;
  details: string | null;
  status: IdeaStatus;
  dropNote: string | null;
  createdByName: string | null;
  /** Its live content item, else the newest; null before any was sent. */
  result: IdeaResult | null;
}

export interface PlanHeader {
  id: string;
  status: PlanStatus;
  sentByName: string | null;
  sentAt: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface MonthPlan {
  /** 'YYYY-MM-01'. */
  month: string;
  /** The branch's business date. */
  today: string;
  plan: PlanHeader | null;
  /** By day, then as added. */
  ideas: PlanIdea[];
  /** Months ('YYYY-MM-01') with a plan waiting on the owner, oldest first. */
  waitingMonths: string[];
  canEdit: boolean;
  canSend: boolean;
  canTakeBack: boolean;
  canDecide: boolean;
}

function readIdea(r: Record<string, unknown>): PlanIdea {
  const res = isObject(r.result) ? r.result : null;
  return {
    id: str(r.id) ?? '',
    day: str(r.day) ?? '',
    title: str(r.title) ?? '',
    kind: oneOf(IDEA_KINDS, r.kind, 'other'),
    channel: oneOf(CONTENT_CHANNELS, r.channel, 'other'),
    details: str(r.details),
    status: oneOf(IDEA_STATUSES, r.status, 'proposed'),
    dropNote: str(r.drop_note),
    createdByName: str(r.created_by_name),
    result:
      res && typeof res.id === 'string'
        ? { id: res.id, status: oneOf(CONTENT_STATUSES, res.status, 'waiting'), version: Math.max(1, Math.floor(num(res.version) ?? 1)) }
        : null,
  };
}

export function readPlan(payload: unknown): MonthPlan {
  const p = isObject(payload) ? payload : {};
  const h = isObject(p.plan) ? p.plan : null;
  const bool = (v: unknown) => v === true;
  return {
    month: str(p.month) ?? '',
    today: str(p.today) ?? '',
    plan:
      h && typeof h.id === 'string'
        ? {
            id: h.id,
            status: oneOf(PLAN_STATUSES, h.status, 'draft'),
            sentByName: str(h.sent_by_name),
            sentAt: str(h.sent_at),
            decidedByName: str(h.decided_by_name),
            decidedAt: str(h.decided_at),
            decisionNote: str(h.decision_note),
          }
        : null,
    ideas: list(p.ideas)
      .filter((r) => typeof r.id === 'string' && typeof r.day === 'string')
      .map(readIdea),
    waitingMonths: Array.isArray(p.waiting_months) ? p.waiting_months.filter((m): m is string => typeof m === 'string') : [],
    canEdit: bool(p.can_edit),
    canSend: bool(p.can_send),
    canTakeBack: bool(p.can_take_back),
    canDecide: bool(p.can_decide),
  };
}

// ---------------------------------------------------------------------------
// Where an idea stands
// ---------------------------------------------------------------------------

/**
 * One word per idea for both sides:
 *   proposed  not decided by the owner yet;
 *   dropped   the owner left it out; cancelled: marketing took it off;
 *   toMake    approved, nothing sent yet; late: the same, past its day;
 *   sent      its result waits on the owner; changes: the owner asked for
 *             changes on it; done: the result was approved;
 *   declined  the result was declined: make it again and send it again.
 */
export type IdeaStage = 'proposed' | 'dropped' | 'cancelled' | 'toMake' | 'late' | 'sent' | 'changes' | 'done' | 'declined';

export function ideaStage(idea: Pick<PlanIdea, 'status' | 'day' | 'result'>, today: string): IdeaStage {
  if (idea.status !== 'approved') return idea.status;
  switch (idea.result?.status) {
    case 'waiting':
      return 'sent';
    case 'changes':
      return 'changes';
    case 'approved':
      return 'done';
    case 'declined':
      return 'declined';
    default:
      // No result, or one marketing withdrew.
      return idea.day < today ? 'late' : 'toMake';
  }
}

/** Colour follows what the stage asks for: amber waits on marketing, red was refused, the soft green is finished. */
export const STAGE_TONE: Readonly<Record<IdeaStage, Tone>> = {
  proposed: 'info',
  dropped: 'neutral',
  cancelled: 'neutral',
  toMake: 'accent',
  late: 'warn',
  sent: 'neutral',
  changes: 'warn',
  done: 'success',
  declined: 'danger',
};

/** Marketing may send a (new) result for the idea now. */
export function canSendResult(stage: IdeaStage): boolean {
  return stage === 'toMake' || stage === 'late' || stage === 'declined';
}

/** Marketing may take an approved idea off the plan: nothing live was sent for it. */
export function canCancelIdea(idea: Pick<PlanIdea, 'status' | 'result'>): boolean {
  if (idea.status !== 'approved') return false;
  const s = idea.result?.status;
  return s !== 'waiting' && s !== 'changes' && s !== 'approved';
}

/** The ideas of each day, in the plan's order. */
export function ideasByDay(ideas: readonly PlanIdea[]): Map<string, PlanIdea[]> {
  const out = new Map<string, PlanIdea[]>();
  for (const i of ideas) {
    const day = out.get(i.day);
    if (day) day.push(i);
    else out.set(i.day, [i]);
  }
  return out;
}

/** The ideas the owner has not decided yet: what "Send" sends and "Approve" approves. */
export function proposedIdeas(plan: MonthPlan): PlanIdea[] {
  return plan.ideas.filter((i) => i.status === 'proposed');
}

/** Days ahead that count as "coming up" for the to-do badge. */
export const DUE_SOON_DAYS = 2;

/**
 * What waits on marketing in this month: the plan sent back with changes, and
 * every approved idea that needs a result now (late, sent back or declined,
 * or due within DUE_SOON_DAYS). The marketing rail's badge.
 */
export function planToDoCount(plan: MonthPlan): number {
  const soon = plan.today ? shiftIsoDate(plan.today, DUE_SOON_DAYS) : '';
  let n = plan.plan?.status === 'changes' ? 1 : 0;
  for (const i of plan.ideas) {
    const stage = ideaStage(i, plan.today);
    if (stage === 'late' || stage === 'changes' || stage === 'declined' || (stage === 'toMake' && i.day <= soon)) n += 1;
  }
  return n;
}

/** The owner's rail badge and Needs-you row: months waiting on them. */
export function plansWaitingCount(plan: MonthPlan): number {
  return plan.waitingMonths.length;
}

/** Progress of an approved month: approved ideas whose result was approved, of all approved ideas. */
export function madeCount(plan: MonthPlan): { made: number; of: number } {
  const approved = plan.ideas.filter((i) => i.status === 'approved');
  return { made: approved.filter((i) => i.result?.status === 'approved').length, of: approved.length };
}

// ---------------------------------------------------------------------------
// Months and days
// ---------------------------------------------------------------------------

/** 'YYYY-MM' of a date or month, for the page's search. */
export const monthKey = (iso: string): string => iso.slice(0, 7);

/** The month's first day, from 'YYYY-MM' or any 'YYYY-MM-DD' in it. */
export function monthFirst(monthOrDay: string): string {
  return monthStart(monthOrDay.length === 7 ? `${monthOrDay}-01` : monthOrDay);
}

/** The month's last day. */
export function monthLast(monthOrDay: string): string {
  const first = monthFirst(monthOrDay);
  return shiftIsoDate(first, daysInMonth(first) - 1);
}

/** The day and the same weekday every week after it, to the month's end: a weekly idea in one go. */
export function weeklyDays(day: string): string[] {
  const last = monthLast(day);
  const out: string[] = [];
  for (let d = day; d <= last; d = shiftIsoDate(d, 7)) out.push(d);
  return out;
}

/** The day a result is planned for: the idea's own day, or today once that has passed (the server refuses a past day). */
export function resultDay(ideaDay: string, today: string): string {
  return ideaDay >= today ? ideaDay : today;
}

// ---------------------------------------------------------------------------
// The idea form
// ---------------------------------------------------------------------------

export interface IdeaDraft {
  title: string;
  kind: IdeaKind;
  channel: ContentChannel;
  details: string;
  /** Add it on this weekday every week to the month's end (new ideas only). */
  weekly: boolean;
}

export const EMPTY_IDEA: IdeaDraft = { title: '', kind: 'post', channel: 'instagram', details: '', weekly: false };

export function draftFromIdea(i: PlanIdea): IdeaDraft {
  return { title: i.title, kind: i.kind, channel: i.channel, details: i.details ?? '', weekly: false };
}

export type IdeaField = 'title' | 'details';
export interface IdeaIssue {
  field: IdeaField;
  code: 'required' | 'tooLong';
}

export function validateIdea(d: IdeaDraft): IdeaIssue[] {
  const out: IdeaIssue[] = [];
  const title = d.title.trim();
  if (!title) out.push({ field: 'title', code: 'required' });
  else if (title.length > IDEA_TITLE_MAX) out.push({ field: 'title', code: 'tooLong' });
  if (d.details.trim().length > IDEA_DETAILS_MAX) out.push({ field: 'details', code: 'tooLong' });
  return out;
}

/** app.save_plan_idea's arguments: a new idea on `day` (and every week after it when weekly), or an edit of `id`. */
export function saveIdeaArgs(d: IdeaDraft, day: string, id: string | null, key: string | null) {
  return {
    p_id: id,
    p_days: id === null && d.weekly ? weeklyDays(day) : [day],
    p_title: d.title.trim(),
    p_kind: d.kind,
    p_channel: d.channel,
    p_details: d.details.trim() || null,
    p_idempotency_key: key,
  };
}

// ---------------------------------------------------------------------------
// A result's link: Google Drive only
// ---------------------------------------------------------------------------

/**
 * Videos and design files travel as a Google Drive link, never as an upload
 * (Majed, 2026-10-22: "make it that it just takes Google Drive links"): Drive
 * holds the full-size file, and the owner opens it there. docs.google.com
 * covers a Drive file shared as a Doc, Sheet or Slides.
 */
export const DRIVE_HOSTS = ['drive.google.com', 'docs.google.com'] as const;

export function isDriveLink(raw: string): boolean {
  const v = raw.trim();
  if (!/^https:\/\/\S+$/i.test(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password && (DRIVE_HOSTS as readonly string[]).includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

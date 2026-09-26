/**
 * Pure helpers for /incidents (wave5-addendum-2026-09-25 §2.6, §5.2; Majed's
 * answer #6: "report incidents that happen there, accidents, fights, someone
 * hurt"): the readers of app.my_incidents and app.incidents_page, the report
 * form's rules, and how a row reads.
 *
 * Every rule here is the server's (0198, app.submit_incident), stated before
 * it would refuse. A redacted report's text is the server's marker, which the
 * page never prints: `redacted` says what happened in the reader's language.
 */
import type { StaffRole } from '../../lib/auth';
import type { Tone } from '../../components/kit';
import { isolate } from '@touch/i18n';
import { bilingual, isObject, list, num, role, str } from '../roleExtras/roleExtrasLogic';

export const INCIDENT_KINDS = ['accident', 'injury', 'fight', 'damage', 'other'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];
export const INCIDENT_PLACES = ['court', 'cafe', 'shop', 'outside', 'other'] as const;
export type IncidentPlace = (typeof INCIDENT_PLACES)[number];
export type IncidentStatus = 'open' | 'reviewed';

/** MGMT's list (§5.2): Open (oldest first), Reviewed and All (newest first). */
export const INCIDENT_FILTERS = ['open', 'reviewed', 'all'] as const;
export type IncidentFilter = (typeof INCIDENT_FILTERS)[number];

export const INCIDENTS_PAGE_SIZE = 50;
export const MY_INCIDENTS_LIMIT = 30;

/** The server's limits (0198). */
export const DESCRIPTION_MAX = 2000;
export const PEOPLE_MAX = 1000;
export const DETAIL_MAX = 120;
export const NOTE_MAX = 1000;
export const PHOTOS_MAX = 6;
/** When an incident may have happened: 7 days back to 10 minutes ahead of now. */
export const BACK_MS = 7 * 24 * 60 * 60 * 1000;
export const AHEAD_MS = 10 * 60 * 1000;

const kindOf = (v: unknown): IncidentKind => ((INCIDENT_KINDS as readonly unknown[]).includes(v) ? (v as IncidentKind) : 'other');
const placeOf = (v: unknown): IncidentPlace => ((INCIDENT_PLACES as readonly unknown[]).includes(v) ? (v as IncidentPlace) : 'other');
const count = (v: unknown): number => Math.max(0, Math.floor(num(v) ?? 0));
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export interface IncidentRow {
  id: string;
  kind: IncidentKind;
  occurredAt: string | null;
  place: IncidentPlace;
  courtId: string | null;
  courtNameEn: string | null;
  courtNameAr: string | null;
  placeDetail: string | null;
  description: string;
  peopleInvolved: string | null;
  photos: string[];
  status: IncidentStatus;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  /** The owner redacted it, or the 365-day purge replaced its text. */
  redacted: boolean;
  // incidents_page only (MGMT).
  reportedByName: string | null;
  reportedByRole: StaffRole | null;
  reportedAt: string | null;
  canReview: boolean;
  canRedact: boolean;
}

function readRow(r: Record<string, unknown>): IncidentRow {
  return {
    id: str(r.id) ?? '',
    kind: kindOf(r.kind),
    occurredAt: str(r.occurred_at),
    place: placeOf(r.place),
    courtId: str(r.court_id),
    courtNameEn: str(r.court_name_en),
    courtNameAr: str(r.court_name_ar),
    placeDetail: str(r.place_detail),
    description: str(r.description) ?? '',
    peopleInvolved: str(r.people_involved),
    photos: strings(r.photos),
    status: r.status === 'reviewed' ? 'reviewed' : 'open',
    reviewedByName: str(r.reviewed_by_name),
    reviewedAt: str(r.reviewed_at),
    reviewNote: str(r.review_note),
    redacted: r.redacted === true,
    reportedByName: str(r.reported_by_name),
    reportedByRole: role(r.reported_by_role),
    reportedAt: str(r.reported_at),
    canReview: r.can_review === true,
    canRedact: r.can_redact === true,
  };
}

export function readMyIncidents(payload: unknown): IncidentRow[] {
  const p = isObject(payload) ? payload : {};
  return list(p.incidents)
    .filter((r) => typeof r.id === 'string')
    .map(readRow);
}

export interface IncidentsPage {
  rows: IncidentRow[];
  openCount: number;
  total: number;
}

export function readIncidentsPage(payload: unknown): IncidentsPage {
  const p = isObject(payload) ? payload : {};
  return {
    rows: list(p.incidents)
      .filter((r) => typeof r.id === 'string')
      .map(readRow),
    openCount: count(p.open_count),
    total: count(p.total),
  };
}

/**
 * The rail badge (MGMT only), the Open tab, /ops and Observe: open reports the
 * viewer can review. `open_count` counts the viewer's own reports too, which
 * another manager or the owner reviews, so the open rows the page marks
 * `can_review: false` come off it. Read from the Open page (50 rows); an own
 * report past it is still counted, which only overstates.
 */
export function incidentsOpenCount(payload: unknown): number {
  const page = readIncidentsPage(payload);
  const own = page.rows.filter((r) => r.status === 'open' && !r.canReview).length;
  return Math.max(0, page.openCount - own);
}

/**
 * Who reviews a report its filer reads back: never its reporter
 * (CANNOT_DECIDE_OWN, 0198), so the owner's goes to a manager.
 */
export function onlyManagerReviews(reporterRole: StaffRole | null | undefined): boolean {
  return reporterRole === 'owner';
}

/** Open waits on a manager (amber); reviewed is done (green). */
export function incidentTone(status: IncidentStatus): Tone {
  return status === 'open' ? 'warn' : 'success';
}

/**
 * Where it happened, as one phrase: the court's name for a court, else the
 * place's word; "where exactly" follows when there is one.
 */
export function placeText(row: Pick<IncidentRow, 'place' | 'courtNameEn' | 'courtNameAr' | 'placeDetail'>, locale: 'en' | 'ar', placeWord: (p: IncidentPlace) => string): string {
  const court = row.place === 'court' ? bilingual(locale, row.courtNameEn, row.courtNameAr) : '';
  // A court's name and the reporter's words are isolated, so a Latin name
  // beside Latin words never runs together inside an Arabic line.
  const where = court ? isolate(court) : placeWord(row.place);
  return row.placeDetail ? `${where} · ${isolate(row.placeDetail)}` : where;
}

// ---------------------------------------------------------------------------
// The report form
// ---------------------------------------------------------------------------

export interface ReportDraft {
  kind: IncidentKind | '';
  /** The venue wall clock, as a datetime-local value: 'YYYY-MM-DDTHH:mm'. */
  when: string;
  place: IncidentPlace | '';
  courtId: string;
  placeDetail: string;
  description: string;
  people: string;
  photos: string[];
}

export type ReportField = 'kind' | 'when' | 'place' | 'courtId' | 'placeDetail' | 'description' | 'people' | 'photos';
export type ReportIssueCode = 'required' | 'whenRange' | 'tooLong' | 'tooMany';
export interface ReportIssue {
  field: ReportField;
  code: ReportIssueCode;
}

const chars = (s: string) => [...s.trim()].length;

/**
 * Every rule of app.submit_incident. `occurredAt` is the draft's time already
 * read on the venue's clock (null when it is not a time); `now` is injected so
 * the window is testable.
 */
export function validateReport(d: ReportDraft, occurredAt: Date | null, now: Date): ReportIssue[] {
  const issues: ReportIssue[] = [];
  if (d.kind === '') issues.push({ field: 'kind', code: 'required' });
  if (occurredAt === null) issues.push({ field: 'when', code: 'required' });
  else if (occurredAt.getTime() < now.getTime() - BACK_MS || occurredAt.getTime() > now.getTime() + AHEAD_MS) issues.push({ field: 'when', code: 'whenRange' });
  if (d.place === '') issues.push({ field: 'place', code: 'required' });
  if (d.place === 'court' && d.courtId === '') issues.push({ field: 'courtId', code: 'required' });
  if (chars(d.placeDetail) > DETAIL_MAX) issues.push({ field: 'placeDetail', code: 'tooLong' });
  if (d.description.trim() === '') issues.push({ field: 'description', code: 'required' });
  else if (chars(d.description) > DESCRIPTION_MAX) issues.push({ field: 'description', code: 'tooLong' });
  if (chars(d.people) > PEOPLE_MAX) issues.push({ field: 'people', code: 'tooLong' });
  if (d.photos.length > PHOTOS_MAX) issues.push({ field: 'photos', code: 'tooMany' });
  return issues;
}

/** app.submit_incident's arguments, trimmed; a court only for a court, blanks as NULL. */
export function reportArgs(d: ReportDraft, occurredAt: Date, key: string): Record<string, unknown> {
  const blank = (s: string) => (s.trim() === '' ? null : s.trim());
  return {
    p_kind: d.kind,
    p_occurred_at: occurredAt.toISOString(),
    p_place: d.place,
    p_description: d.description.trim(),
    p_court_id: d.place === 'court' ? d.courtId : null,
    p_place_detail: blank(d.placeDetail),
    p_people_involved: blank(d.people),
    p_photos: d.photos,
    p_idempotency_key: key,
  };
}

/** The field a server refusal names (the hints of app.submit_incident), so the form marks it. */
export function reportRefusalField(code: string | null, hint: string | null): ReportField | null {
  if (code === 'INVALID_ARGUMENT') {
    if (hint === 'kind') return 'kind';
    if (hint === 'place') return 'place';
    if (hint === 'occurred_at') return 'when';
    if (hint === 'court_id') return 'courtId';
    if (hint === 'photos') return 'photos';
  }
  if (code === 'REF_NOT_FOUND' && hint === 'court_id') return 'courtId';
  if (code === 'TEXT_REQUIRED' || code === 'TEXT_TOO_LONG') {
    if (hint === 'description') return 'description';
    if (hint === 'people_involved') return 'people';
    if (hint === 'place_detail') return 'placeDetail';
  }
  if (code === 'PHOTO_PATH_INVALID') return 'photos';
  return null;
}

/** The review note: required (1 to 1000), and the reporter reads it. */
export function reviewIssue(note: string): 'required' | 'tooLong' | null {
  if (note.trim() === '') return 'required';
  if (chars(note) > NOTE_MAX) return 'tooLong';
  return null;
}

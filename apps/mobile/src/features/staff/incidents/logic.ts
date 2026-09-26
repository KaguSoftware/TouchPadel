/**
 * Incident reports as rules (wave5-addendum-2026-09-25 §2.6, §5.3): the
 * report as a draft with its checks and RPC arguments, the review note, and
 * who reviews. The server keeps the caps and the guards (0198); these catch
 * a bad field before the round trip.
 *
 * PURE (vitest): no react-native, no client.
 */
import type { StaffRole } from '@touch/core';
import { parseVenueDateTime, venueDateTimeText } from '../protocols/assemble';
import type {
  IncidentKind,
  IncidentPlace,
  IncidentRow,
  IncidentStatus,
  IncidentsFilter,
  SubmitIncidentArgs,
} from './api';

/** The kinds and places of 0198, in the order the form offers them (§8 Q13). */
export const INCIDENT_KINDS: readonly IncidentKind[] = [
  'accident',
  'injury',
  'fight',
  'damage',
  'other',
];
export const INCIDENT_PLACES: readonly IncidentPlace[] = [
  'court',
  'cafe',
  'shop',
  'outside',
  'other',
];
export const INCIDENT_FILTERS: readonly IncidentsFilter[] = ['open', 'reviewed', 'all'];

/** Management reviews (review_incident, incidents_page); every role reports. */
export const REVIEW_ROLES: readonly StaffRole[] = ['manager', 'owner'];

export function reviewsIncidents(role: StaffRole): boolean {
  return REVIEW_ROLES.includes(role);
}

/**
 * How many open reports the viewer can review. `incidents_page.open_count`
 * counts every open report, the viewer's own among them, and nobody reviews
 * their own (0198), so the open rows the page marks `can_review: false` come
 * off. Read from the Open page (50 rows); an own report past that page is
 * still counted, which only ever overstates.
 */
export function toReviewCount(
  page:
    | { open_count?: number; incidents?: readonly Pick<IncidentRow, 'status' | 'can_review'>[] }
    | undefined,
): number {
  if (!page) return 0;
  const own = (page.incidents ?? []).filter(
    (r) => r.status === 'open' && r.can_review === false,
  ).length;
  return Math.max(0, (page.open_count ?? 0) - own);
}

/**
 * Who is left to review a report the viewer filed: another manager or the
 * owner, or only a manager when the owner filed it.
 */
export function ownReportLine(reporterRole: string | null | undefined): 'own' | 'ownOwner' {
  return reporterRole === 'owner' ? 'ownOwner' : 'own';
}

/** Server caps (0198). */
export const INCIDENT_CAPS = {
  description: 2000,
  people: 1000,
  placeDetail: 120,
  photos: 6,
  note: 1000,
  /** How far back a report may be dated, and how far ahead a phone clock may run. */
  backMs: 7 * 24 * 3600_000,
  aheadMs: 10 * 60_000,
} as const;

export interface IncidentDraft {
  kind: IncidentKind | null;
  /** The venue's `YYYY-MM-DD HH:MM`, as typed. */
  when: string;
  place: IncidentPlace | null;
  courtId: string | null;
  placeDetail: string;
  description: string;
  people: string;
  photos: string[];
}

export type IncidentField =
  'kind' | 'when' | 'place' | 'courtId' | 'placeDetail' | 'description' | 'people' | 'photos';
export type IncidentIssueCode = 'required' | 'invalid' | 'tooLong' | 'future' | 'tooOld';

export interface IncidentIssue {
  field: IncidentField;
  code: IncidentIssueCode;
}

/** A new report: nothing chosen, "when" set to now at the venue, which is most reports. */
export function emptyIncidentDraft(nowMs: number): IncidentDraft {
  return {
    kind: null,
    when: venueDateTimeText(new Date(nowMs).toISOString()),
    place: null,
    courtId: null,
    placeDetail: '',
    description: '',
    people: '',
    photos: [],
  };
}

/** Choosing a place other than a court drops the court, as the server requires (court_id only for a court). */
export function withPlace(draft: IncidentDraft, place: IncidentPlace): IncidentDraft {
  return { ...draft, place, courtId: place === 'court' ? draft.courtId : null };
}

/** Check a report; an empty list means it can be sent. */
export function validateIncident(draft: IncidentDraft, nowMs: number): IncidentIssue[] {
  const issues: IncidentIssue[] = [];
  if (!draft.kind) issues.push({ field: 'kind', code: 'required' });

  if (!draft.when.trim()) issues.push({ field: 'when', code: 'required' });
  else {
    const at = parseVenueDateTime(draft.when);
    if (!at) issues.push({ field: 'when', code: 'invalid' });
    else {
      const ms = Date.parse(at);
      if (ms > nowMs + INCIDENT_CAPS.aheadMs) issues.push({ field: 'when', code: 'future' });
      else if (ms < nowMs - INCIDENT_CAPS.backMs) issues.push({ field: 'when', code: 'tooOld' });
    }
  }

  if (!draft.place) issues.push({ field: 'place', code: 'required' });
  else if (draft.place === 'court' && !draft.courtId)
    issues.push({ field: 'courtId', code: 'required' });
  if (draft.placeDetail.trim().length > INCIDENT_CAPS.placeDetail) {
    issues.push({ field: 'placeDetail', code: 'tooLong' });
  }

  const description = draft.description.trim();
  if (!description) issues.push({ field: 'description', code: 'required' });
  else if (description.length > INCIDENT_CAPS.description)
    issues.push({ field: 'description', code: 'tooLong' });
  if (draft.people.trim().length > INCIDENT_CAPS.people)
    issues.push({ field: 'people', code: 'tooLong' });
  if (draft.photos.length > INCIDENT_CAPS.photos) issues.push({ field: 'photos', code: 'tooLong' });
  return issues;
}

/** The RPC's arguments from a draft that passed `validateIncident`. Empty optional text is sent as null. */
export function incidentArgs(draft: IncidentDraft, venueId: string): SubmitIncidentArgs {
  const place = draft.place ?? 'other';
  return {
    p_kind: draft.kind ?? 'other',
    p_occurred_at: parseVenueDateTime(draft.when) ?? draft.when,
    p_place: place,
    p_description: draft.description.trim(),
    p_court_id: place === 'court' ? draft.courtId : null,
    p_place_detail: draft.placeDetail.trim() || null,
    p_people_involved: draft.people.trim() || null,
    p_photos: draft.photos,
    p_venue_id: venueId,
  };
}

/** The review note: required, 1,000 characters at most. */
export function validateReviewNote(note: string): 'required' | 'tooLong' | null {
  const text = note.trim();
  if (!text) return 'required';
  return text.length > INCIDENT_CAPS.note ? 'tooLong' : null;
}

export type IncidentTone = 'warn' | 'good';

/** An open report waits on management; a reviewed one is done. */
export const INCIDENT_TONE: Record<IncidentStatus, IncidentTone> = {
  open: 'warn',
  reviewed: 'good',
};

/**
 * Incident reports on the staff phone (wave5-addendum-2026-09-25 §2.6, §5.3;
 * migration 0198): every role reports what happened at the venue, with
 * photos in the `incidents` folder, and follows its own reports; management
 * reviews the venue's with a note the reporter reads. Redacting stays on the
 * operator (§5.1), so the phone never calls redact_incident.
 *
 * Each query stores the RPC's result as it comes, as supplies/api.ts does.
 */
import { staffRpc, type StaffRpcName } from '../api';

/** Wave-5 RPCs that STAFF_RPCS in ../api.ts (lane B's list) does not name. */
type IncidentRpc = 'submit_incident' | 'review_incident' | 'my_incidents' | 'incidents_page';

function call<T>(fn: IncidentRpc, args: Record<string, unknown>): Promise<T> {
  return staffRpc<T>(fn as unknown as StaffRpcName, args);
}

/** incident_reports.kind (0198). */
export type IncidentKind = 'accident' | 'injury' | 'fight' | 'damage' | 'other';
/** incident_reports.place (0198). */
export type IncidentPlace = 'court' | 'cafe' | 'shop' | 'outside' | 'other';
export type IncidentStatus = 'open' | 'reviewed';

/** One report as `my_incidents` returns it; `incidents_page` adds who reported it. */
export interface IncidentRow {
  id: string;
  kind: IncidentKind;
  occurred_at: string;
  place: IncidentPlace;
  court_id: string | null;
  court_name_en: string | null;
  court_name_ar: string | null;
  place_detail: string | null;
  description: string;
  people_involved: string | null;
  photos: string[];
  status: IncidentStatus;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  /** Its text was replaced: by the owner, or after 365 days. */
  redacted: boolean;
  /** incidents_page only. */
  reported_by_name?: string | null;
  reported_by_role?: string | null;
  reported_at?: string;
  can_review?: boolean;
}

export interface MyIncidents {
  incidents: IncidentRow[];
}

export function fetchMyIncidents(venueId: string): Promise<MyIncidents> {
  return call<MyIncidents>('my_incidents', { p_venue_id: venueId, p_limit: 30 });
}

export type IncidentsFilter = 'open' | 'reviewed' | 'all';

export interface IncidentsPage {
  incidents: IncidentRow[];
  open_count: number;
  total: number;
}

/** Management's read of the venue's reports. */
export function fetchIncidentsPage(
  venueId: string,
  filter: IncidentsFilter,
): Promise<IncidentsPage> {
  return call<IncidentsPage>('incidents_page', {
    p_venue_id: venueId,
    p_filter: filter,
    p_limit: 50,
  });
}

export interface SubmitIncidentArgs {
  p_kind: IncidentKind;
  p_occurred_at: string;
  p_place: IncidentPlace;
  p_description: string;
  p_court_id: string | null;
  p_place_detail: string | null;
  p_people_involved: string | null;
  p_photos: string[];
  p_venue_id: string;
}

export function submitIncident(args: SubmitIncidentArgs, key: string): Promise<{ id: string }> {
  return call<{ id: string }>('submit_incident', { ...args, p_idempotency_key: key });
}

/** Management reviews an open report, never their own. State-idempotent: no key. */
export function reviewIncident(
  id: string,
  note: string,
): Promise<{ status: IncidentStatus; reviewed_at: string }> {
  return call('review_incident', { p_id: id, p_note: note });
}

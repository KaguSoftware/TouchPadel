/**
 * Which branch a guest books at (multi-venue slice 4, plan MV1–MV8).
 *
 * `venue_settings_public` returns one row per OPEN branch (0208, 0225), each
 * carrying its own id, names, address, phone and timezone. Those rows are the
 * branch list: the Book tab shows a picker only when there is more than one,
 * and a single open branch is used silently, so a one-branch install looks
 * exactly as it did before branches existed.
 *
 * The choice is remembered on the device under `tp.venue` (read before the
 * first frame with the other boot keys, src/lib/bootPrefs.ts; the store is
 * guestVenue.ts). A remembered branch that is no longer open falls back to the
 * default one. The rule is the staff phone's (staff/venue.ts `pickVenueId`).
 *
 * PURE (vitest).
 */
import type { Locale } from '@touch/i18n';
import { pickVenueId, showsVenuePicker } from '../staff/venue';

/** AsyncStorage key of the guest's chosen branch. One per device, not per account: a guest may be signed out. */
export const GUEST_VENUE_KEY = 'tp.venue';

/** The original branch's fixed id (0122): the default, listed first. */
export const DEFAULT_VENUE_ID = 'c0000000-0000-4000-8000-000000000001';

/** One open branch, as `venue_settings_public` names it. */
export interface Branch {
  venue_id: string;
  venue_slug: string | null;
  venue_name: string | null;
  venue_name_en: string | null;
  venue_name_ar: string | null;
  address_en: string | null;
  address_ar: string | null;
  map_url: string | null;
  phone: string | null;
  timezone: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A stored value that could be a venue id, or null (garbage, empty, an old format). */
export function parseStoredVenue(raw: string | null | undefined): string | null {
  return typeof raw === 'string' && UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * The branch list from the view's rows: rows without an id are dropped, the
 * default branch leads and the rest follow by slug, so "the first" is stable
 * whatever order the server returns them in.
 */
export function toBranches(rows: readonly Record<string, unknown>[] | null | undefined): Branch[] {
  const out: Branch[] = [];
  const seen = new Set<string>();
  for (const r of rows ?? []) {
    const id = str(r.venue_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      venue_id: id,
      venue_slug: str(r.venue_slug),
      venue_name: str(r.venue_name),
      venue_name_en: str(r.venue_name_en),
      venue_name_ar: str(r.venue_name_ar),
      address_en: str(r.address_en),
      address_ar: str(r.address_ar),
      map_url: str(r.map_url),
      phone: str(r.phone),
      timezone: str(r.timezone),
    });
  }
  return out.sort((a, b) => {
    if (a.venue_id === DEFAULT_VENUE_ID) return -1;
    if (b.venue_id === DEFAULT_VENUE_ID) return 1;
    return (a.venue_slug ?? a.venue_id).localeCompare(b.venue_slug ?? b.venue_id);
  });
}

/**
 * The branch to book at: the remembered one while it is still open, otherwise
 * the first (the default). Null only while no branch is open or known.
 */
export function pickGuestVenueId(
  branches: readonly Branch[],
  stored: string | null | undefined,
): string | null {
  return pickVenueId(
    branches.map((b) => b.venue_id),
    stored,
  );
}

/** Whether the Book tab shows the picker: only with more than one open branch. */
export function showsBranchPicker(branches: readonly Branch[]): boolean {
  return showsVenuePicker(branches.map((b) => b.venue_id));
}

/** The branch's name in the guest's language, falling back to the other one and then to the settings name. */
export function branchName(branch: Branch, locale: Locale): string {
  const first = locale === 'ar' ? branch.venue_name_ar : branch.venue_name_en;
  const second = locale === 'ar' ? branch.venue_name_en : branch.venue_name_ar;
  return first ?? second ?? branch.venue_name ?? branch.venue_slug ?? '';
}

/** The realtime topic a branch's slot changes are broadcast on (0224). */
export function courtsTopic(venueId: string): string {
  return `courts:${venueId}`;
}

/**
 * Which venue the staff phone works at (build-contracts-2026-09-23 §6.5).
 *
 * A phone has no station, so nothing on the server can resolve "the venue"
 * for it (`app.current_venue()` refuses a caller with two memberships and no
 * station, 0125): every staff call passes `p_venue_id` explicitly. The list is
 * `app.staff_venue_ids()` (the owner gets every active venue); the choice is
 * remembered per account under `tp.staff-venue:<uid>`, and the picker shows
 * only when there is more than one.
 *
 * PURE (vitest). StaffStatusProvider does the storage.
 */

/** AsyncStorage key of an account's chosen venue. Per uid: two accounts on one phone never share it. */
export function staffVenueKey(uid: string): string {
  return `tp.staff-venue:${uid}`;
}

/**
 * The venue to work at: the remembered one while it is still in the list,
 * otherwise the first. Null only when the account has no venue at all.
 */
export function pickVenueId(
  venueIds: readonly string[],
  stored: string | null | undefined,
): string | null {
  if (stored && venueIds.includes(stored)) return stored;
  return venueIds[0] ?? null;
}

/** Whether Today shows the picker. */
export function showsVenuePicker(venueIds: readonly string[]): boolean {
  return venueIds.length > 1;
}

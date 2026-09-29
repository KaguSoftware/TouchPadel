/**
 * The guest's name in two parts on the phone (0256; docs/design/open-matches/
 * guest.md §4.9). PURE.
 *
 * The server owns the rule: `profiles.given_name` and `family_name` are the
 * source, and a trigger rebuilds `full_name` from them (or splits a
 * `full_name` an older build wrote). The phone only reads the parts, falls
 * back to `full_name` for a row cached before them, and sends the parts back.
 */
import { prefillDisplayName } from '../auth/social';

/** The CHECK on each part (`profiles_given_name_len`, `profiles_family_name_len`). */
export const NAME_PART_MAX = 39;

export interface NameSource {
  full_name?: string | null;
  given_name?: string | null;
  family_name?: string | null;
}

/**
 * What the two name fields start with. The stored parts when there are any;
 * otherwise `full_name`'s first word and the rest (a row an older build
 * cached). The trigger's email-local-part fallback is hidden, as on
 * complete-profile (`prefillDisplayName`), so the field shows its placeholder
 * instead of 'k3x9q2'.
 */
export function nameFieldsOf(
  profile: NameSource | null | undefined,
  email: string | null = null,
): { first: string; last: string } {
  if (!profile) return { first: '', last: '' };
  const given = (profile.given_name ?? '').trim();
  if (given) {
    const first = prefillDisplayName(given, email);
    return { first, last: first ? (profile.family_name ?? '').trim() : '' };
  }
  const full = prefillDisplayName(profile.full_name, email);
  const [head = '', ...rest] = full.split(/\s+/).filter(Boolean);
  return { first: head, last: rest.join(' ') };
}

/** The first name a greeting uses: `given_name`, else `full_name`'s first word. */
export function greetingNameOf(profile: NameSource | null | undefined): string {
  const given = (profile?.given_name ?? '').trim();
  if (given) return given;
  return (profile?.full_name ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * The update a save sends: both parts, trimmed; an empty surname is NULL (a
 * single-name guest; `profiles_name_parts` allows it once there is a first
 * name). The server rebuilds `full_name`.
 */
export function namePatch(first: string, last: string): { given_name: string; family_name: string | null } {
  const family = last.trim();
  return { given_name: first.trim(), family_name: family || null };
}

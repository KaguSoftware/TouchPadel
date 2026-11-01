/**
 * Whether the Play tab is in the bar: the BRANCH settings decide, not the build (Majed,
 * 2026-11-01, F-71). `EXPO_PUBLIC_TOURNAMENTS` is gone from eas.json and nothing reads it.
 *
 * The Play tab holds two things: tournaments (`tournaments_enabled`) and open matches
 * (`matches_enabled`, which no longer ride on the payments flag either). It is in the bar while
 * some open branch has either switched on, and leaves it (iOS `hidden`, Android `href: null`)
 * once the branch list says none does. While the list is still loading, or could not be read,
 * the tab stays, so a slow read never makes it blink out and back. Inside the tab, the guest's
 * own branch decides what shows (play.tsx), and a tournament push opens its tournament.
 *
 * Ranks never swapped with the tab: it is the middle segment of Club (features/ranks).
 *
 * Pure module (no RN / expo imports) so node tests can use it.
 */

/** The two switches the Play tab reads from a branch row (venue_settings_public). */
export interface PlayBranchSwitches {
  tournaments_enabled?: boolean | null;
  matches_enabled?: boolean | null;
}

/** Play is in the bar unless the branch list is known and no branch has tournaments or matches on. */
export function playTabShown(branches: readonly PlayBranchSwitches[] | null | undefined): boolean {
  if (!branches) return true;
  return branches.some((b) => b.tournaments_enabled === true || b.matches_enabled === true);
}

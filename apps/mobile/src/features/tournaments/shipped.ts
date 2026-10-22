/**
 * The build switch for tournaments on the phone (Majed, 2026-10-22: "a temporary remove, keep
 * everything active, just not on production for now").
 *
 * Why a BUILD-TIME flag, like `EXPO_PUBLIC_ONLINE_PAYMENTS` (features/deposit/enabled.ts): with open
 * matches already left out of the store build, the Join tab was the tournaments page and nothing
 * else, and Apple 2.3.1 and Google Play's transparency policy forbid a hidden feature the server can
 * switch on. So a branch's `tournaments_enabled` cannot bring them back in a build that ships with
 * this "off". Everything stays: the screens, the routes, the database and the desk's tournaments.
 *
 * Off, the Join tab leaves the bar and the leaderboard takes its place (navigation/TabsLayout.*);
 * My reservations and Profile drop the guest's entries, the suggestions drop the two formats and a
 * tournament push opens My reservations. "on" in an eas.json profile, or in apps/mobile/.env for
 * Metro, puts all of it back as it was.
 *
 * Pure module (no RN / expo imports) so node tests can use it.
 */

/** Only the literal "on" enables, as for the payments flag. */
export function parseTournamentsFlag(value: string | undefined | null): boolean {
  return (value ?? '').trim().toLowerCase() === 'on';
}

/**
 * Read at call time, not module scope, so a test can never freeze it. The env access stays a
 * STATIC `process.env.EXPO_PUBLIC_…` member expression, the only shape Expo inlines.
 */
export function tournamentsShipped(): boolean {
  return parseTournamentsFlag(process.env.EXPO_PUBLIC_TOURNAMENTS);
}

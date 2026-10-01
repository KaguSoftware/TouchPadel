import { normaliseIncomingPath } from '../src/features/matches/links';
import { normaliseCoachLink } from '../src/features/coaching/links';

/**
 * expo-router's hook for every incoming link, before it is routed
 * (docs/design/open-matches/guest.md §4.18).
 *
 * An open-match invite arrives as `/m/<token>`, `/en/m/<token>`,
 * `/ar/m/<token>` (universal links, with or without the https origin) or
 * `touchpadel://m/<token>`; the router has no locale segment, so every
 * spelling is folded onto `app/m/[token].tsx`, which validates the token
 * itself. A coach's page arrives the same ways as `/c/<coachId>` (coaching
 * guest.md §4.12) and is folded first onto `app/coach/[id].tsx`, which
 * validates the id. Everything else passes through untouched: the payment return link,
 * the auth code links (features/auth/deepLink.ts), `/auth/*`.
 *
 * It never throws: a link it cannot read is handed on as it came. A `.ts`
 * file, so the smoke walk (which lists `.tsx` routes) leaves it out.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return normaliseCoachLink(path) ?? normaliseIncomingPath(path);
  } catch {
    return path;
  }
}

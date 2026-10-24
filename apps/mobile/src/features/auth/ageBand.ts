/**
 * The age band the sign-up form asked for (migration 0368, Majed 2026-10-24:
 * the customer is asked their gender, their age and their level at sign up).
 * PURE, apart from the one in-memory "recorded this session" set below, so
 * vitest runs it in node.
 *
 * Four places make sure a band exists, and NONE of them is a wall:
 *   1. Sign up asks it with the rest of the form; the answer rides in the
 *      sign-up metadata (there is no session yet) and is recorded here once
 *      one lands, exactly as the gender and the Terms switch are.
 *   2. Complete profile asks it, so a social sign-in that never saw the form
 *      answers it there.
 *   3. The play survey asks it while the profile has none, which covers every
 *      account made before 0368.
 *   4. Edit profile shows it, changeable: a band is outgrown, and the guest
 *      owns their own.
 *
 * Why no gate of its own: nothing in the club depends on an age band the way a
 * court hour depends on a gender (0353). It is worth asking, never worth
 * blocking a booking for, so a missing band costs the next calm ask, not a
 * refusal.
 *
 * Staff are never asked: a staff account owes no guest profile.
 */
import { parseAgeBand, type AgeBand } from '../playProfile/logic';

/** `user_metadata.age_band` as the sign-up form wrote it; anything else is none. */
export function signupAgeBandOf(metadata: unknown): AgeBand | null {
  if (!metadata || typeof metadata !== 'object') return null;
  return parseAgeBand((metadata as { age_band?: unknown }).age_band);
}

export interface AgeBandRecordInput {
  hasSession: boolean;
  isAnonymous: boolean;
  /** The staff row has been read for this session (an unread staff account looks like a guest). */
  staffAnswered: boolean;
  /** A staff session (any role, or the guest preview of one). */
  staff: boolean;
  /**
   * The profile's band: `undefined` while not known (loading, failed, no row,
   * or a server without 0368), `null` when known and never answered.
   */
  band: AgeBand | null | undefined;
  /** The band the sign-up form sent in the account's metadata, if any. */
  signupBand: AgeBand | null;
  /** Recording was tried this session and failed. */
  recordFailed: boolean;
  recordedThisSession: boolean;
}

/** Should the sign-up form's answer be written now? */
export function shouldRecordAgeBand(i: AgeBandRecordInput): boolean {
  if (!i.hasSession || i.isAnonymous) return false;
  if (!i.staffAnswered || i.staff) return false;
  if (i.band !== null) return false;
  if (i.recordFailed || i.recordedThisSession) return false;
  return i.signupBand !== null;
}

// ── Recorded this session ───────────────────────────────────────────────────
// Per account, in memory: one write a launch, whatever the profile read does
// next.

const recorded = new Set<string>();

export function markAgeBandRecorded(uid: string): void {
  recorded.add(uid);
}

export function ageBandRecordedThisSession(uid: string): boolean {
  return recorded.has(uid);
}

/** Tests only. */
export function __resetAgeBandRecorded(): void {
  recorded.clear();
}

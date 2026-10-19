/**
 * The gender every account must have (migration 0353, Majed 2026-10-19: some
 * courts and hours are kept for women or for men). PURE, apart from the one
 * in-memory "asked this session" set below, so vitest runs it in node.
 *
 * Three places make sure of it:
 *   1. Sign up asks it with the rest of the form; the answer rides in the
 *      sign-up metadata (no session yet) and is recorded here once one lands,
 *      as useTermsGate records the Terms switch.
 *   2. The completion gate (`needsProfileCompletion`, social.ts) counts a
 *      missing gender as an incomplete profile, so every booking, open-match
 *      start or join and lesson meets /complete-profile before it goes on.
 *   3. On app open (and right after a sign-in that skipped the form) a guest
 *      without one is sent to /complete-profile in BACK mode, once per account
 *      per launch, from a calm landing on a tab.
 *
 * Why back mode and once per launch, not a wall: complete-profile in continue
 * mode turns every way out into a trip to the tabs, and a gate that pushed it
 * again from there would be a loop with no exit, which a guest with no signal
 * could never leave. Back mode lets them go back and browse; (2) still stops
 * anything that books, the server refuses a kept slot without a gender
 * (GENDER_REQUIRED), and the next launch asks again.
 *
 * Staff are never asked here: a staff account has no phone and owes no guest
 * profile (complete-profile would make them type one), it books nothing from
 * the phone, and the desk can set a staff member's gender in the operator.
 */
import type { Gender } from '@touch/core';
import { isTabPath } from '../playProfile/prompt';

export type GenderGateStep = 'none' | 'record' | 'ask';

export interface GenderGateInput {
  hasSession: boolean;
  isAnonymous: boolean;
  /** The staff row has been read for this session (an unread staff account looks like a guest). */
  staffAnswered: boolean;
  /** A staff session (any role, or the guest preview of one). */
  staff: boolean;
  /**
   * The profile's gender: `undefined` while not known (loading, failed, no
   * row), `null` when known and never answered.
   */
  gender: Gender | null | undefined;
  /** The gender the sign-up form sent in the account's metadata, if any. */
  signupGender: Gender | null;
  /** Recording the sign-up answer was tried this session and failed. */
  recordFailed: boolean;
  pendingIntent: boolean;
  pathname: string | null | undefined;
  askedThisSession: boolean;
}

export function genderGateStep(i: GenderGateInput): GenderGateStep {
  if (!i.hasSession || i.isAnonymous) return 'none';
  if (!i.staffAnswered || i.staff) return 'none';
  if (i.gender !== null) return 'none';
  if (i.signupGender && !i.recordFailed) return 'record';
  if (i.askedThisSession || i.pendingIntent) return 'none';
  return isTabPath(i.pathname) ? 'ask' : 'none';
}

/** `user_metadata.gender` as the sign-up form wrote it; anything else is none. */
export function signupGenderOf(metadata: unknown): Gender | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as { gender?: unknown }).gender;
  return value === 'female' || value === 'male' ? value : null;
}

// ── Asked this session ──────────────────────────────────────────────────────
// Per account, in memory: complete-profile marks it as it opens (whoever sent
// the guest there), so the app-open ask never stacks a second one on top.

const asked = new Set<string>();

export function markGenderAsked(uid: string): void {
  asked.add(uid);
}

export function genderAskedThisSession(uid: string): boolean {
  return asked.has(uid);
}

/** Tests only. */
export function __resetGenderAsked(): void {
  asked.clear();
}

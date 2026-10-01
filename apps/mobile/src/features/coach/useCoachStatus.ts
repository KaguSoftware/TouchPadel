/**
 * STUB — the guest lane's placeholder for coach mode's hook. REPLACED AT
 * INTEGRATION by the coach-mode lane's real `useCoachStatus({read})`
 * (`features/coach/CoachStatusProvider.tsx`, docs/design/coaching/guest.md
 * §4.13.1), which reads `coach_me` under `coachKeys.me(uid)`.
 *
 * The guest screens read only `.coach`: null for anyone who is not a coach,
 * else the coach's id and status (`active`, `paused`, `retired`). Profile's
 * "Coach mode" row (§4.8.1) and the coach screen's "This is your coach
 * profile" (R56) are the two readers; both render as for a guest while this
 * stub answers `{coach: null}`.
 */

export interface CoachStatusStub {
  coach: { id: string; status: 'active' | 'paused' | 'retired' } | null;
}

/** STUB: always `{coach: null}` until the coach-mode lane's provider lands. */
export function useCoachStatus(_opts: { read?: boolean } = {}): CoachStatusStub {
  return { coach: null };
}

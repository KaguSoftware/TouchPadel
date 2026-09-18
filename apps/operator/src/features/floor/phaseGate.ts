/**
 * PHASE 2 GATE — the Live floor plan (LiveFloor.tsx) is held off.
 *
 * Owner call, 2026-09-18: the three-dimensional plan is not part of what ships
 * now. It is not deleted and it is not half-wired — it is SWITCHED OFF at one
 * place, and this is that place.
 *
 * WHAT "OFF" MEANS HERE, precisely:
 *  1. NO SOCKET. The two private realtime subscriptions the plan lives on
 *     ('floor' and 'courts', see floorData.ts) are never opened — not opened
 *     and torn down, never opened. `useBroadcast({ enabled: false })` returns
 *     before `supabase.channel(...)` is reached, so there is no WebSocket
 *     frame, no `realtime.setAuth`, and no 4–7 s reconnect timer running
 *     behind a screen nobody can read.
 *  2. NO READS. The eight-table poll is disabled too (`useQuery({ enabled:
 *     false })`), so the gate costs the venue nothing every 30 s.
 *  3. A STILL PICTURE, NOT A DEAD ONE. The plan itself IS drawn (owner,
 *     2026-09-18: "less blur, I want the 3D model to show a bit") — but only
 *     its architecture. `apply()` builds the venue once and paints the LIVE
 *     layer on top of it, so handed EMPTY_SNAPSHOT it draws the building, the
 *     courts and the cage and paints nothing: no court in play, no rally, no
 *     open tab, no staff pin. The rally loop is gated on a court the server
 *     calls in play, and the server is not being asked, so the scene is
 *     motionless by construction rather than by a pause flag.
 *  4. NOTHING TO PRESS. Zoom, full screen and the "drag to look around" hint
 *     are not rendered: a plan with no feed has no state to explore, and a
 *     control behind a blur is a control that looks broken.
 *  5. STATIC OFF STATE. Everything downstream still RUNS — the panel mounts,
 *     the counts render, the layout is the real layout — it is simply fed
 *     EMPTY_SNAPSHOT and a 'disconnected' pill, which is the honest picture of
 *     a plan with no feed. Nothing throws, nothing is null-guarded away, and
 *     no caller of `useLiveFloor` needs to know the gate exists.
 *
 * TO RECONNECT: flip the constant below to `false`. That is the whole revert —
 * see `docs/PHASE-2-RECONNECT.md`.
 *
 * Typed `boolean` on purpose, NOT left to infer the literal `true`: with a
 * literal type TypeScript narrows `!HELD_FOR_PHASE_2` to `false` and reports
 * the live branches as dead code, so flipping the flag would be a compile
 * error rather than a one-character change.
 */
export const HELD_FOR_PHASE_2: boolean = true;

/**
 * The words over the plan, in both languages.
 *
 * WHY THIS WORDING. Not "restricted" — that reads as a door someone locked,
 * and invites the question of who is allowed through it. This is a roadmap
 * note: the plan is part of a later phase, and that is the whole story anyone
 * outside the build needs (owner, 2026-09-18).
 *
 * BILINGUAL, because the venue reads Arabic and this is shown to them, not
 * only to us. Held HERE rather than in the i18n catalogues on purpose: it is a
 * temporary notice that should leave with the flag, and a key in the
 * catalogues would outlive it — a string still being translated long after the
 * thing it labelled came back on.
 */
export const PHASE_2_LABEL: Record<'en' | 'ar', string> = {
  en: 'COMING IN PHASE 2',
  ar: 'قريباً في المرحلة الثانية',
};

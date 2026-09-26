/**
 * WHICH THEME SWITCH IS THE LIVE ONE.
 *
 * The theme crossfade is a sequence of awaits — fade the cover up, commit the
 * palette, fade it away — and every one of those awaits RESOLVES COME WHAT MAY
 * (that is settleAnimation's guarantee, and the reason the theme can never hang
 * mid-switch). The flip side is that a switch cannot be cancelled: once its
 * async body is running, the rest of it will run, and each phase ends by
 * writing shared state — `inFlight`, `switching`, the cover's opacity.
 *
 * That is the Control Center glitch. Changing the system appearance means
 * leaving the app, so the flip arrives while AppState is 'inactive' or
 * 'background'; the provider correctly commits outright instead of crossfading
 * (see appearanceEvents.ts), tearing down whatever switch was in flight. But
 * the torn-down switch's remaining awaits still land afterwards, and its tail
 * clears `inFlight` and `switching` unconditionally. If a newer switch has
 * begun by then, it loses its own re-entrancy guard mid-fade and a third switch
 * can start on top of it — which is what leaves the cover stranded over the old
 * palette, or cut away before the new one is committed.
 *
 * So each switch takes a TICKET, and anything that supersedes a switch burns
 * it. A tail holding a stale ticket does nothing at all. The rule is small
 * enough to state in one line and is the whole correctness argument for the
 * transition, so it lives here as a pure function rather than as a bare `!==`
 * buried in three places in the provider — which is exactly how it is tested
 * (switchGeneration.test.ts) without needing a renderer.
 */

/** A monotonic ticket counter. One per provider instance. */
export interface SwitchGeneration {
  current: number;
}

/**
 * Claim the next ticket, making every switch already in flight stale.
 * Called when a new crossfade begins, and by the outright-commit path
 * (`applyNow`) which has no crossfade of its own but must still abandon one.
 */
export function claimSwitch(generation: SwitchGeneration): number {
  generation.current += 1;
  return generation.current;
}

/**
 * May a phase holding `ticket` still write shared state?
 *
 * False once anything has superseded it — in which case the caller must return
 * WITHOUT touching the cover or the guards: the state it would be writing now
 * belongs to a newer switch, or to a commit that has already finished.
 */
export function isLiveSwitch(generation: SwitchGeneration, ticket: number): boolean {
  return generation.current === ticket;
}

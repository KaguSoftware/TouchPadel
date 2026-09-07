/**
 * The boot loading screen shows ONCE per JS launch.
 *
 * A module-level latch and not React state, because the thing being remembered
 * outlives every component: Fast Refresh remounts the tree without restarting
 * the VM, and a boot animation replaying every time a file is saved is the
 * fastest way to make a developer hate it. A full bundle reload — the `r` key,
 * an update applied — DOES restart the VM, which is a launch and correctly
 * replays. A warm start (backgrounded, foregrounded) keeps the VM and replays
 * nothing, matching the native splash, which does not show then either.
 *
 * Its own module with no imports so nothing else can carry it into a reload.
 */
let claimed = false;

/** True exactly once per launch: the caller that gets `true` owns the screen. */
export function claimBootOverlay(): boolean {
  if (claimed) return false;
  claimed = true;
  return true;
}

/** Tests only — the latch is deliberately not resettable at runtime. */
export function __resetLaunchLatch(): void {
  claimed = false;
}

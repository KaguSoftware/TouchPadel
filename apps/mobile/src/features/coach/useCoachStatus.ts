/**
 * `useCoachStatus({read})` (docs/design/coaching/guest.md §4.13.1), at the
 * path the guest screens import it from (Profile's "Coach mode" row). The hook
 * lives with its provider; this file only re-exports it.
 */
export { useCoachStatus, type CoachStatusValue } from './CoachStatusProvider';
export { coachModeEntry } from './status';

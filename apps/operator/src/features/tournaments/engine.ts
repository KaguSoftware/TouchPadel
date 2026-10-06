/**
 * The rounds engine as the desk calls it (docs/design/tournaments/
 * build-contracts-2026-10-03.md §1.11, TD-7): `americanoSchedule`,
 * `mexicanoRound` and `seedFrom` from `@touch/core/tournaments`. One seam, so
 * the logic tests mock the engine here and nothing else in the operator
 * imports it directly.
 */
export { americanoSchedule, mexicanoRound, seedFrom } from '@touch/core/tournaments';
export type { AmericanoInput, MexicanoInput } from '@touch/core/tournaments';

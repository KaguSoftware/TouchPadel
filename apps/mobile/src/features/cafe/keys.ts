/**
 * The café menu query key family (the guest's view-only menu, `app/cafe-menu.tsx`).
 *
 * The menu is public (anon and authenticated read the same active rows of an open branch), so it
 * IS persisted: a guest opening the menu with no signal still sees the last copy this phone read.
 *
 * PURE (vitest). `hooks.ts` re-exports it.
 */
export const cafeKeys = {
  /** Every café read. */
  all: ['cafe'] as const,
  /** One branch's café menu: categories, items and their sizes. */
  menu: (venueId: string) => ['cafe', 'menu', venueId] as const,
};

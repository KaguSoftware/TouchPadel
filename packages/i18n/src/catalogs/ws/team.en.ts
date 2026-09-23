/**
 * team workspace strings — owned by the team lane. Mirror every key in team.ar.ts.
 * The team workspace is driver and marketing (0155): the any-staff baseline
 * plus My tasks, which will hold purchases, marketing tasks and checklists
 * once they can be assigned. Until then the page is its empty state.
 */
export const teamEn = {
  tasks: {
    title: 'My tasks',
    empty: {
      title: 'Nothing is assigned to you yet',
      body: 'Purchases, marketing tasks and checklists will appear here once they are assigned to you.',
    },
  },
} as const;

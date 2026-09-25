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
      // By role (MyTasks BODY_BY_ROLE): each reads only what will be handed to
      // them. `other` is for a role /tasks admits without a line of its own.
      body: {
        driver: 'Purchases and checklists will appear here once they are assigned to you.',
        marketing: 'Marketing tasks and checklists will appear here once they are assigned to you.',
        other: 'Tasks and checklists will appear here once they are assigned to you.',
      },
    },
  },
} as const;

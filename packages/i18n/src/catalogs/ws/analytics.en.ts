/**
 * Management → Analytics: the tab strip, the Courts tab, the court x cafe
 * section and the InfoTip definitions. Owned by the analytics lane. Mirror
 * every key in analytics.ar.ts. The Cafe tab's own strings predate this file
 * and stay under the root `analytics.*` block of catalogs/en.ts.
 */
export const analyticsEn = {
  tabs: {
    courts: 'Courts',
    cafe: 'Cafe',
  },
  courts: {
    building: 'Courts analytics are being built',
    buildingBody: 'Bookings, occupancy, guests and the court to cafe link will appear here. The Cafe tab is live.',
  },
} as const;

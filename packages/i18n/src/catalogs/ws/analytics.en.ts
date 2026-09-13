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
  // The info button beside a card or zone title.
  tips: {
    about: 'About {title}',
  },
  // The KPI tile's delta opens both figures.
  kpi: {
    compareLabel: '{label}: both figures',
    compareValues: '{previous} before, {current} now',
  },
  // Every chart's table and CSV twin.
  twin: {
    table: 'Show as table',
    chart: 'Show as chart',
    csv: 'Download CSV',
  },
  heatmap: {
    hint: 'Hover a cell for its value',
    closed: 'Closed',
    ofPeak: '{pct} of the busiest cell',
    cells: 'cells',
    less: 'Less',
    more: 'More',
  },
} as const;

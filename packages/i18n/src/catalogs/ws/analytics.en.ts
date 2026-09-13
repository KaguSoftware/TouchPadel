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
  // The sticky bar's disclosure for the once-a-month settings.
  more: {
    title: 'More',
    count: 'More ({n})',
  },
  // Cafe tab additions (its older strings live under the root analytics.* block).
  cafe: {
    tillHeatmap: 'Orders by weekday and hour',
    tillHeatmapTip: 'Till and guest orders placed in each hour, on the weekday of the business day they belong to (a 01:00 order counts with the evening before). Works without guest analytics.',
    viewsHeatmapTip: 'Guest menu sessions from the QR menu by weekday and hour, from guest analytics.',
    toggleOrders: 'Orders',
    toggleRevenue: 'Sales',
    priceBandSales: 'Units sold per price band',
    priceBandSalesTip: 'What actually sold in each list-price band, from till data alone. Read it next to the conversion bars: a band that draws views but sells little is a pricing question.',
    trendTip: 'Sales per business day above; menu views and waiter calls below on their own axis. The crosshairs move together, so a day can be read across both.',
    bands: {
      lt3000: 'Under 3,000',
      b3000: '3,000 to 5,999',
      b6000: '6,000 to 9,999',
      gte10000: '10,000 and over',
    },
    tips: {
      sales: 'Item sales on settled tabs, before tab-level discounts and before the court fee.',
      tabs: 'Tabs settled in the period.',
      covers: 'An estimate: guest menu visits multiplied by the covers multiplier in More. Shown with a tilde because it is not counted.',
      perPerson: 'Item sales divided by the estimated covers.',
      visits: 'Distinct guest visits to the QR menu.',
      views: 'Menu item views on the QR menu.',
      median: 'Median length of a guest menu session.',
      calls: 'Waiter calls raised from the QR menu, counted from the till database.',
      basketToCall: 'Guest sessions that built a basket and then called a waiter or ordered, as a share of sessions with a basket.',
    },
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

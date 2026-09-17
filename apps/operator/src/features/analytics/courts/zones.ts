/**
 * The Courts tab's sections, in the order an owner asks: the summary, what
 * stands out, when the courts are busy, how the courts compare, what is lost
 * to cancellations and no-shows, how people book, who comes back, and what
 * court players spend at the cafe. (See Zone.tsx for the shape.)
 */
import type { ZoneDef } from '../Zone';

export const COURT_ZONES: readonly ZoneDef[] = [
  { id: 'pulse', titleKey: 'ws.analytics.courts.zones.pulse', descKey: 'ws.analytics.courts.zones.pulseDesc' },
  { id: 'insights', titleKey: 'ws.analytics.courts.zones.insights', descKey: 'ws.analytics.courts.zones.insightsDesc', navKey: 'ws.analytics.courts.zones.insightsNav' },
  { id: 'when', titleKey: 'ws.analytics.courts.zones.when', descKey: 'ws.analytics.courts.zones.whenDesc', navKey: 'ws.analytics.courts.zones.whenNav' },
  { id: 'courts', titleKey: 'ws.analytics.courts.zones.courts', descKey: 'ws.analytics.courts.zones.courtsDesc', navKey: 'ws.analytics.courts.zones.courtsNav' },
  { id: 'losses', titleKey: 'ws.analytics.courts.zones.losses', descKey: 'ws.analytics.courts.zones.lossesDesc', navKey: 'ws.analytics.courts.zones.lossesNav' },
  { id: 'shape', titleKey: 'ws.analytics.courts.zones.shape', descKey: 'ws.analytics.courts.zones.shapeDesc', navKey: 'ws.analytics.courts.zones.shapeNav' },
  { id: 'guests', titleKey: 'ws.analytics.courts.zones.guests', descKey: 'ws.analytics.courts.zones.guestsDesc' },
  { id: 'cafe', titleKey: 'ws.analytics.courts.zones.cafe', descKey: 'ws.analytics.courts.zones.cafeDesc', navKey: 'ws.analytics.courts.zones.cafeNav' },
];

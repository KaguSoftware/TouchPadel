/** The eight zones of the Courts tab (see Zone.tsx for the shape). */
import type { ZoneDef } from '../Zone';

export const COURT_ZONES: readonly ZoneDef[] = [
  { id: 'pulse', ordinal: '01', titleKey: 'ws.analytics.courts.zones.pulse', descKey: 'ws.analytics.courts.zones.pulseDesc' },
  { id: 'insights', ordinal: '02', titleKey: 'ws.analytics.courts.zones.insights', descKey: 'ws.analytics.courts.zones.insightsDesc' },
  { id: 'when', ordinal: '03', titleKey: 'ws.analytics.courts.zones.when', descKey: 'ws.analytics.courts.zones.whenDesc' },
  { id: 'shape', ordinal: '04', titleKey: 'ws.analytics.courts.zones.shape', descKey: 'ws.analytics.courts.zones.shapeDesc' },
  { id: 'courts', ordinal: '05', titleKey: 'ws.analytics.courts.zones.courts', descKey: 'ws.analytics.courts.zones.courtsDesc' },
  { id: 'losses', ordinal: '06', titleKey: 'ws.analytics.courts.zones.losses', descKey: 'ws.analytics.courts.zones.lossesDesc' },
  { id: 'guests', ordinal: '07', titleKey: 'ws.analytics.courts.zones.guests', descKey: 'ws.analytics.courts.zones.guestsDesc' },
  { id: 'cafe', ordinal: '08', titleKey: 'ws.analytics.courts.zones.cafe', descKey: 'ws.analytics.courts.zones.cafeDesc' },
];

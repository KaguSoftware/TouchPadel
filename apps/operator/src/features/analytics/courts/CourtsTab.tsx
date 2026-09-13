/**
 * `/analytics/courts` — the Courts tab. This is the scaffold that lets the
 * route, the rail row and the tab strip ship ahead of the courts data layer;
 * the sections (pulse, insights, when, shape, courts, losses, guests, court x
 * cafe) replace the empty state as the analytics_courts_* RPCs land.
 */
import { EmptyState } from '../../../components/kit';
import { useLocale } from '../../../lib/i18n';
import { AnalyticsFrame } from '../AnalyticsFrame';

export function CourtsTab() {
  const { tr } = useLocale();
  return (
    <AnalyticsFrame tab="courts">
      <EmptyState icon="court" title={tr('ws.analytics.courts.building')} body={tr('ws.analytics.courts.buildingBody')} />
    </AnalyticsFrame>
  );
}

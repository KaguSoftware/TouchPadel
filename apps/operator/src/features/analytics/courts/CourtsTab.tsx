/**
 * `/analytics/courts` — the Courts tab. This is the scaffold that lets the
 * route, the rail row and the tab strip ship ahead of the courts data layer;
 * the sections (pulse, insights, when, shape, courts, losses, guests, court x
 * cafe) replace the empty state as the analytics_courts_* RPCs land.
 */
import { useNavigate, useSearch } from '@tanstack/react-router';
import { EmptyState } from '../../../components/kit';
import { useLocale } from '../../../lib/i18n';
import { AnalyticsBar } from '../AnalyticsBar';
import { AnalyticsFrame } from '../AnalyticsFrame';
import type { AnalyticsSearch } from '../search';

export function CourtsTab() {
  const { tr } = useLocale();
  const search = useSearch({ from: '/analytics' }) as AnalyticsSearch;
  const navigate = useNavigate();
  const setSearch = (next: Partial<AnalyticsSearch>) => {
    void navigate({ to: '/analytics/courts', search: { ...search, ...next } });
  };
  return (
    <AnalyticsFrame>
      <AnalyticsBar tab="courts" search={search} setSearch={setSearch} zones={[]} compareBasis={search.cmp ?? 'prev'} />
      <EmptyState icon="court" title={tr('ws.analytics.courts.building')} body={tr('ws.analytics.courts.buildingBody')} />
    </AnalyticsFrame>
  );
}

/** CourtsReportScreen (spec 06.41): occupancy by court and by hour, revenue per court and per available hour, volumes, cancellations, peak vs off-peak. */
import { useLocale } from '../../lib/i18n';
import { ReportScreen } from './ReportScreen';

export function CourtsReportScreen() {
  const { tr } = useLocale();
  return (
    <ReportScreen
      name="courts"
      rpc="report_courts"
      fields={['court', 'group']}
      views={[
        { id: 'byCourt', label: tr('ws.reports.views.courts.byCourt') },
        { id: 'byHour', label: tr('ws.reports.views.courts.byHour'), bars: { labelKey: 'hour', valueKey: 'occupancy_pct' } },
        { id: 'volumes', label: tr('ws.reports.views.courts.volumes') },
        { id: 'cancellations', label: tr('ws.reports.views.courts.cancellations') },
        { id: 'peak', label: tr('ws.reports.views.courts.peak') },
      ]}
    />
  );
}

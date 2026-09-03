/** CafeReportScreen (spec 06.42): orders and AOV, best sellers, cost/margin, waste by reason, prep times by station. */
import { useLocale } from '../../lib/i18n';
import { ReportScreen } from './ReportScreen';

export function CafeReportScreen() {
  const { tr } = useLocale();
  return (
    <ReportScreen
      name="cafe"
      rpc="report_cafe"
      fields={['category', 'payment', 'group']}
      views={[
        { id: 'orders', label: tr('ws.reports.views.cafe.orders') },
        { id: 'bestSellers', label: tr('ws.reports.views.cafe.bestSellers') },
        { id: 'margins', label: tr('ws.reports.views.cafe.margins') },
        { id: 'waste', label: tr('ws.reports.views.cafe.waste') },
        { id: 'prepTimes', label: tr('ws.reports.views.cafe.prepTimes') },
      ]}
    />
  );
}

/**
 * CafeReportScreen (spec 06.42): orders and AOV, best sellers, cost/margin,
 * waste by reason, prep times by station.
 *
 * Each view declares its own 5-7 columns (rulebook 6.1) with the item, station
 * or period first; the rest of the payload stays behind "Show all columns" and
 * is always exported in full.
 */
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
        {
          id: 'orders',
          label: tr('ws.reports.views.cafe.orders'),
          columns: ['date', 'period', 'orders', 'revenue_iqd', 'aov_iqd', 'discounts_iqd'],
        },
        {
          id: 'bestSellers',
          label: tr('ws.reports.views.cafe.bestSellers'),
          columns: ['item', 'category', 'qty', 'revenue_iqd', 'gross_profit_iqd'],
        },
        {
          id: 'margins',
          label: tr('ws.reports.views.cafe.margins'),
          columns: ['item', 'category', 'qty', 'revenue_iqd', 'cogs_iqd', 'gross_profit_iqd', 'margin_pct'],
        },
        {
          id: 'waste',
          label: tr('ws.reports.views.cafe.waste'),
          columns: ['item', 'reason', 'waste_qty', 'waste_iqd', 'date'],
          emptyKind: 'nothingToDo',
        },
        {
          id: 'prepTimes',
          label: tr('ws.reports.views.cafe.prepTimes'),
          columns: ['station', 'item', 'orders', 'avg_prep_min', 'max_prep_min'],
        },
      ]}
    />
  );
}

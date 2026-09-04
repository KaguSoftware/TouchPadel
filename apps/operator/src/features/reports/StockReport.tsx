/** StockReportScreen (spec 06.43): value on hand, variance, low / below par, expiring / expired, consumption. */
import { useLocale } from '../../lib/i18n';
import { ReportScreen } from './ReportScreen';

export function StockReportScreen() {
  const { tr } = useLocale();
  return (
    <ReportScreen
      name="stock"
      rpc="report_stock"
      fields={['category']}
      views={[
        { id: 'value', label: tr('ws.reports.views.stock.value') },
        { id: 'variance', label: tr('ws.reports.views.stock.variance') },
        { id: 'lowStock', label: tr('ws.reports.views.stock.lowStock') },
        { id: 'expiry', label: tr('ws.reports.views.stock.expiry') },
        { id: 'consumption', label: tr('ws.reports.views.stock.consumption') },
      ]}
    />
  );
}

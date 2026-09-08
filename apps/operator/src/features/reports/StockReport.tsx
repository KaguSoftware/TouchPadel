/**
 * StockReportScreen (spec 06.43): value on hand, variance, low / below par,
 * expiring / expired, consumption.
 *
 * The ingredient identifies every row, so it leads every view (rulebook 6.2);
 * the unit sits beside any quantity, because "12" of an unnamed unit is not a
 * figure a manager can act on.
 */
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
        {
          id: 'value',
          label: tr('ws.reports.views.stock.value'),
          columns: ['ingredient', 'category', 'on_hand', 'unit', 'par', 'value_iqd'],
        },
        {
          id: 'variance',
          label: tr('ws.reports.views.stock.variance'),
          columns: ['ingredient', 'unit', 'theoretical', 'counted', 'variance', 'variance_iqd'],
          emptyKind: 'nothingToDo',
        },
        {
          id: 'lowStock',
          label: tr('ws.reports.views.stock.lowStock'),
          columns: ['ingredient', 'category', 'on_hand', 'par', 'unit', 'value_iqd'],
          emptyKind: 'nothingToDo',
        },
        {
          id: 'expiry',
          label: tr('ws.reports.views.stock.expiry'),
          columns: ['ingredient', 'expires_on', 'on_hand', 'unit', 'value_iqd'],
          emptyKind: 'nothingToDo',
        },
        {
          id: 'consumption',
          label: tr('ws.reports.views.stock.consumption'),
          columns: ['ingredient', 'category', 'consumed', 'unit', 'waste_qty', 'value_iqd'],
        },
      ]}
    />
  );
}

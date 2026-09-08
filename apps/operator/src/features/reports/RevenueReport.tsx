/**
 * RevenueReportScreen (spec 06.40). Owner-only: the route guards it and the
 * screen states the refusal for anyone else.
 *
 * The grouping key ('date' by day, 'period' by week or month) leads every view
 * that is a time series; only one of the two is ever in the payload, so both
 * are declared and the missing one is skipped (rulebook 6.1).
 */
import { usePermissions, requiredRoleFor } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { PermissionRefusedNotice } from '../../components/kit';
import { ReportScreen } from './ReportScreen';

export function RevenueReportScreen() {
  const { tr } = useLocale();
  const can = usePermissions();
  return (
    <ReportScreen
      name="revenue"
      rpc="report_revenue"
      fields={['group', 'payment', 'staff']}
      enabled={can.viewFinancials}
      notice={
        can.viewFinancials ? null : (
          <PermissionRefusedNotice action={tr('ws.reports.refusedRevenue')} requiredRole={requiredRoleFor('viewFinancials')} style={{ marginBlockEnd: 'var(--tp-sp-4)' }} />
        )
      }
      views={[
        {
          id: 'byPeriod',
          label: tr('ws.reports.views.revenue.byPeriod'),
          columns: ['date', 'period', 'revenue_iqd', 'padel_iqd', 'cafe_iqd', 'orders'],
        },
        {
          id: 'bySource',
          label: tr('ws.reports.views.revenue.bySource'),
          columns: ['source', 'revenue_iqd', 'bookings', 'orders', 'aov_iqd'],
        },
        {
          id: 'byMethod',
          label: tr('ws.reports.views.revenue.byMethod'),
          columns: ['method', 'revenue_iqd', 'cash_iqd', 'card_iqd', 'orders'],
        },
        {
          id: 'adjustments',
          label: tr('ws.reports.views.revenue.adjustments'),
          columns: ['date', 'period', 'discounts_iqd', 'voids_iqd', 'refunds_iqd', 'authoriser'],
          emptyKind: 'nothingToDo',
        },
        {
          id: 'tax',
          label: tr('ws.reports.views.revenue.tax'),
          columns: ['rate', 'date', 'period', 'revenue_iqd', 'tax_iqd'],
        },
      ]}
    />
  );
}

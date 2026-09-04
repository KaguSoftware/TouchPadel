/** RevenueReportScreen (spec 06.40). Owner-only: the route guards it and the screen states the refusal for anyone else. */
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
          <PermissionRefusedNotice action={tr('ws.reports.refusedRevenue')} requiredRole={requiredRoleFor('viewFinancials')} style={{ marginBlockEnd: '0.9rem' }} />
        )
      }
      views={[
        { id: 'byPeriod', label: tr('ws.reports.views.revenue.byPeriod') },
        { id: 'bySource', label: tr('ws.reports.views.revenue.bySource') },
        { id: 'byMethod', label: tr('ws.reports.views.revenue.byMethod') },
        { id: 'adjustments', label: tr('ws.reports.views.revenue.adjustments') },
        { id: 'tax', label: tr('ws.reports.views.revenue.tax') },
      ]}
    />
  );
}

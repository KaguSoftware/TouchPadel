/**
 * StaffActivityReportScreen (spec 06.44) — activity and exceptions ONLY.
 * Rows stay in name order (no sorting by any figure), every figure sits
 * beside the person's shift context, and there is no rank, score or
 * leaderboard anywhere. The audit log filtered to one person is one click.
 *
 * The person is the identity of every row and leads every view. Days worked
 * stays in the activity set on purpose: an order count read without it is the
 * ranking this screen exists to refuse.
 */
import { useNavigate } from '@tanstack/react-router';
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';
import { MessagePresenter } from '../../components/kit';
import { ReportScreen } from './ReportScreen';
import type { ReportRow } from './reportTypes';

export function StaffActivityReportScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();

  const openAudit = (actor: string) => void navigate({ to: '/admin/audit', search: { actor } as never });

  return (
    <ReportScreen
      name="staff"
      rpc="report_staff_activity"
      fields={['staff']}
      sortable={false}
      defaultSort={{ key: 'staff', dir: 'asc' }}
      views={[
        {
          id: 'activity',
          label: tr('ws.reports.views.staff.activity'),
          columns: ['staff', 'orders_taken', 'bookings_created', 'days_worked', 'busiest_day'],
        },
        {
          id: 'exceptions',
          label: tr('ws.reports.views.staff.exceptions'),
          columns: ['staff', 'kind', 'count', 'amount_iqd', 'authoriser'],
          emptyKind: 'nothingToDo',
        },
        {
          id: 'waiterCalls',
          label: tr('ws.reports.views.staff.waiterCalls'),
          columns: ['staff', 'count', 'response_min', 'busiest_day'],
        },
        {
          id: 'cashVariance',
          label: tr('ws.reports.views.staff.cashVariance'),
          columns: ['staff', 'business_date', 'cash_variance_iqd', 'closed_by', 'note'],
          emptyKind: 'nothingToDo',
        },
      ]}
      intro={<MessagePresenter tone="info" icon="users" message={tr('ws.reports.staff.note')} style={{ marginBlockEnd: 'var(--tp-sp-4)' }} />}
      extraControls={({ filters }) =>
        filters.staffId ? (
          <div style={{ marginBlockEnd: 'var(--tp-sp-4)' }}>
            <Button size="sm" icon="shield" onClick={() => openAudit(filters.staffId!)}>
              {tr('ws.reports.staff.audit')}
            </Button>
          </div>
        ) : (
          <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-4)' }}>{tr('ws.reports.staff.filterFirst')}</p>
        )
      }
      rowExtra={() => ({
        header: '',
        render: (row: ReportRow) => {
          const id = typeof row.staff_id === 'string' ? row.staff_id : null;
          const days = typeof row.days_worked === 'number' ? row.days_worked : null;
          const busiest = typeof row.busiest_day === 'string' ? row.busiest_day : null;
          return (
            <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2-5)', alignItems: 'center', whiteSpace: 'nowrap' }}>
              {days != null && (
                <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                  {tr('ws.reports.staff.context', { days: formatNumber(days, locale), day: busiest ?? '—' })}
                </span>
              )}
              {/* DataTable no longer fires the row action for a control inside a
                  cell, so the private stopPropagation this button carried is gone. */}
              {id && (
                <Button size="sm" kind="ghost" icon="shield" onClick={() => openAudit(id)} title={tr('ws.reports.staff.audit')} aria-label={tr('ws.reports.staff.audit')} />
              )}
            </span>
          );
        },
      })}
    />
  );
}

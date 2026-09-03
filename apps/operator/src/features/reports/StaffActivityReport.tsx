/**
 * StaffActivityReportScreen (spec 06.44) — activity and exceptions ONLY.
 * Rows stay in name order (no sorting by any figure), every figure sits
 * beside the person's shift context, and there is no rank, score or
 * leaderboard anywhere. The audit log filtered to one person is one click.
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
        { id: 'activity', label: tr('ws.reports.views.staff.activity') },
        { id: 'exceptions', label: tr('ws.reports.views.staff.exceptions') },
        { id: 'waiterCalls', label: tr('ws.reports.views.staff.waiterCalls') },
        { id: 'cashVariance', label: tr('ws.reports.views.staff.cashVariance') },
      ]}
      intro={<MessagePresenter tone="info" icon="users" message={tr('ws.reports.staff.note')} style={{ marginBlockEnd: '0.9rem' }} />}
      extraControls={({ filters }) =>
        filters.staffId ? (
          <div style={{ marginBlockEnd: '0.9rem' }}>
            <Button size="sm" icon="shield" onClick={() => openAudit(filters.staffId!)}>
              {tr('ws.reports.staff.audit')}
            </Button>
          </div>
        ) : (
          <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockEnd: '0.9rem' }}>{tr('ws.reports.staff.filterFirst')}</p>
        )
      }
      rowExtra={() => ({
        header: '',
        render: (row: ReportRow) => {
          const id = typeof row.staff_id === 'string' ? row.staff_id : null;
          const days = typeof row.days_worked === 'number' ? row.days_worked : null;
          const busiest = typeof row.busiest_day === 'string' ? row.busiest_day : null;
          return (
            <span style={{ display: 'inline-flex', gap: '0.6rem', alignItems: 'center', whiteSpace: 'nowrap' }}>
              {days != null && (
                <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                  {tr('ws.reports.staff.context', { days: formatNumber(days, locale), day: busiest ?? '—' })}
                </span>
              )}
              {id && (
                <Button size="sm" kind="ghost" icon="shield" onClick={(e) => { e.stopPropagation(); openAudit(id); }} title={tr('ws.reports.staff.audit')} aria-label={tr('ws.reports.staff.audit')} />
              )}
            </span>
          );
        },
      })}
    />
  );
}

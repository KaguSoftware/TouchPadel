/**
 * ReportFilterBar (spec §07 Reporting): court, category, staff member and
 * payment method selects, plus the grouping and view switches a report asks
 * for. Emits one `onChange` with the whole filter object.
 */
import { useQuery } from '@tanstack/react-query';
import { Select } from '../../components/ui';
import { SegmentedControl } from '../../components/kit';
import { QK, fetchActiveCourts } from '../../lib/queries';
import { useLocale, pickName } from '../../lib/i18n';
import { REPORT_CATEGORIES_KEY, REPORT_STAFF_KEY, fetchReportCategories, fetchReportStaff } from './filterOptions';
import type { PaymentMethodFilter, ReportFilters, ReportGroup } from './reportTypes';

export type FilterField = 'court' | 'category' | 'staff' | 'payment' | 'group';

export interface ReportView {
  id: string;
  label: string;
  /** Render an inline bar list above the table from these row keys. */
  bars?: { labelKey: string; valueKey: string };
}

export function ReportFilterBar({
  fields,
  filters,
  onChange,
  group,
  onGroup,
  views,
  disabled,
}: {
  fields: readonly FilterField[];
  filters: ReportFilters;
  onChange: (next: ReportFilters) => void;
  group: ReportGroup;
  onGroup: (g: ReportGroup) => void;
  views: readonly ReportView[];
  disabled?: boolean;
}) {
  const { tr, locale } = useLocale();
  const has = (f: FilterField) => fields.includes(f);
  const courtsQ = useQuery({ queryKey: QK.courts, queryFn: fetchActiveCourts, enabled: has('court'), staleTime: 60_000 });
  const categoriesQ = useQuery({ queryKey: REPORT_CATEGORIES_KEY, queryFn: fetchReportCategories, enabled: has('category'), staleTime: 60_000 });
  const staffQ = useQuery({ queryKey: REPORT_STAFF_KEY, queryFn: fetchReportStaff, enabled: has('staff'), staleTime: 60_000 });

  const selectStyle = { inlineSize: 'auto', minInlineSize: '10rem' } as const;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 0.75rem', alignItems: 'center', marginBlockEnd: '0.9rem' }}>
      {views.length > 1 && (
        <SegmentedControl
          aria-label={tr('ws.reports.filters.view')}
          size="sm"
          value={filters.view}
          onChange={(view) => onChange({ ...filters, view })}
          options={views.map((v) => ({ value: v.id, label: v.label, disabled }))}
        />
      )}
      {has('group') && (
        <SegmentedControl<ReportGroup>
          aria-label={tr('ws.reports.filters.group')}
          size="sm"
          value={group}
          onChange={onGroup}
          options={[
            { value: 'day', label: tr('ws.reports.filters.day'), disabled },
            { value: 'week', label: tr('ws.reports.filters.week'), disabled },
            { value: 'month', label: tr('ws.reports.filters.month'), disabled },
          ]}
        />
      )}
      {has('court') && (
        <Select
          aria-label={tr('ws.reports.filters.court')}
          value={filters.courtId ?? ''}
          disabled={disabled}
          style={selectStyle}
          onChange={(v) => onChange({ ...filters, courtId: v || undefined })}
          options={[{ value: '', label: tr('ws.reports.filters.allCourts') }, ...(courtsQ.data ?? []).map((c) => ({ value: c.id, label: pickName(locale, c) }))]}
        />
      )}
      {has('category') && (
        <Select
          aria-label={tr('ws.reports.filters.category')}
          value={filters.categoryId ?? ''}
          disabled={disabled}
          style={selectStyle}
          onChange={(v) => onChange({ ...filters, categoryId: v || undefined })}
          options={[{ value: '', label: tr('ws.reports.filters.allCategories') }, ...(categoriesQ.data ?? []).map((c) => ({ value: c.id, label: pickName(locale, c) }))]}
        />
      )}
      {has('staff') && (
        <Select
          aria-label={tr('ws.reports.filters.staff')}
          value={filters.staffId ?? ''}
          disabled={disabled}
          style={selectStyle}
          onChange={(v) => onChange({ ...filters, staffId: v || undefined })}
          options={[{ value: '', label: tr('ws.reports.filters.allStaff') }, ...(staffQ.data ?? []).map((s) => ({ value: s.id, label: s.display_name }))]}
        />
      )}
      {has('payment') && (
        <Select<PaymentMethodFilter | ''>
          aria-label={tr('ws.reports.filters.payment')}
          value={filters.paymentMethod ?? ''}
          disabled={disabled}
          style={selectStyle}
          onChange={(v) => onChange({ ...filters, paymentMethod: v === '' ? undefined : v })}
          options={[
            { value: '', label: tr('ws.reports.filters.allPayments') },
            { value: 'cash', label: tr('ws.reports.filters.cash') },
            { value: 'card', label: tr('ws.reports.filters.card') },
          ]}
        />
      )}
    </div>
  );
}

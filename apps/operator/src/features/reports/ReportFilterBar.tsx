/**
 * ReportFilterBar (spec §07 Reporting): court, category, staff member and
 * payment method selects, plus the grouping and view switches a report asks
 * for. Emits one `onChange` with the whole filter object.
 *
 * Rulebook 6.6: the active filters also render as removable chips under the
 * controls, with one "Clear all". The chips live here rather than in
 * ReportScreen because this is where the court, category and staff names are
 * already fetched — a chip that could only print an id would be worse than none.
 */
import { useQuery } from '@tanstack/react-query';
import { Select } from '../../components/ui';
import { FilterChips, SegmentedControl, type FilterChip } from '../../components/kit';
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
  /**
   * Rulebook 6.1: the 5-7 columns this view is *about*, in reading order, with
   * the identifying column first. Presentational only — the server still sends
   * whatever it sends, the normaliser is untouched, and the CSV export keeps
   * every column. Keys the payload does not carry are simply skipped.
   */
  columns?: readonly string[];
  /**
   * Rulebook 9.2: for a view that lists exceptions — waste, cancellations,
   * cash variance — an empty result is good news, not missing data.
   */
  emptyKind?: 'nothingToDo';
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

  // A chip names its filter as well as its value: "Court: Court 3" reads on its
  // own, where a bare "Court 3" beside a bare "Coffee" does not say which
  // control either came from.
  const chips: FilterChip[] = [];
  if (has('court') && filters.courtId) {
    const court = (courtsQ.data ?? []).find((c) => c.id === filters.courtId);
    chips.push({
      id: 'court',
      label: `${tr('ws.reports.filters.court')}: ${court ? pickName(locale, court) : filters.courtId}`,
      text: `${tr('ws.reports.filters.court')}: ${court ? pickName(locale, court) : filters.courtId}`,
      onRemove: () => onChange({ ...filters, courtId: undefined }),
    });
  }
  if (has('category') && filters.categoryId) {
    const cat = (categoriesQ.data ?? []).find((c) => c.id === filters.categoryId);
    chips.push({
      id: 'category',
      label: `${tr('ws.reports.filters.category')}: ${cat ? pickName(locale, cat) : filters.categoryId}`,
      text: `${tr('ws.reports.filters.category')}: ${cat ? pickName(locale, cat) : filters.categoryId}`,
      onRemove: () => onChange({ ...filters, categoryId: undefined }),
    });
  }
  if (has('staff') && filters.staffId) {
    const person = (staffQ.data ?? []).find((s) => s.id === filters.staffId);
    chips.push({
      id: 'staff',
      label: `${tr('ws.reports.filters.staff')}: ${person ? person.display_name : filters.staffId}`,
      text: `${tr('ws.reports.filters.staff')}: ${person ? person.display_name : filters.staffId}`,
      onRemove: () => onChange({ ...filters, staffId: undefined }),
    });
  }
  if (has('payment') && filters.paymentMethod) {
    const method = tr(filters.paymentMethod === 'cash' ? 'ws.reports.filters.cash' : 'ws.reports.filters.card');
    chips.push({
      id: 'payment',
      label: `${tr('ws.reports.filters.payment')}: ${method}`,
      text: `${tr('ws.reports.filters.payment')}: ${method}`,
      onRemove: () => onChange({ ...filters, paymentMethod: undefined }),
    });
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', marginBlockEnd: 'var(--tp-sp-4)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-2) var(--tp-sp-3)', alignItems: 'center' }}>
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
      {/* Clearing keeps the view: it is a lens on the report, not a filter on it. */}
      <FilterChips chips={chips} onClearAll={chips.length > 0 ? () => onChange({ view: filters.view }) : undefined} />
    </div>
  );
}

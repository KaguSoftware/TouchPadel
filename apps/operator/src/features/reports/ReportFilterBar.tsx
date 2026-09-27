/**
 * The filters a report can offer, one labelled control each.
 *
 * WHAT CHANGED, AND WHY
 *
 * The bar used to be a row of unlabelled selects — "Everyone", "Cash and
 * card", "All categories" — with removable chips repeating the choice
 * underneath. A select reading "Everyone" does not say everyone *what*, and
 * the chips printed the same value a second time an inch away. Each control
 * now carries its label above it (the audit log's pattern), and the select
 * itself is the way back: its first option is "All …".
 *
 * Only filters the server honours are offered. The old bar also showed a
 * category select on stock, and payment + day/week/month on the cafe report:
 * `report_stock` and `report_cafe` ignore those keys (migrations 0068 / 0096),
 * so choosing one changed nothing on screen.
 */
import { useQuery } from '@tanstack/react-query';
import { Field, Select } from '../../components/ui';
import { SegmentedControl } from '../../components/kit';
import { QK, fetchActiveCourts } from '../../lib/queries';
import { useLocale, pickName } from '../../lib/i18n';
import { REPORT_CATEGORIES_KEY, REPORT_STAFF_KEY, fetchReportCategories, fetchReportStaff } from './filterOptions';
import type { PaymentMethodFilter, ReportGroup } from './reportTypes';

const selectStyle = { inlineSize: 'auto', minInlineSize: '11rem', maxInlineSize: '18rem' } as const;
const fieldStyle = { marginBlockEnd: 0 } as const;

export function CourtFilter({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const { tr, locale } = useLocale();
  const courtsQ = useQuery({ queryKey: QK.courts, queryFn: fetchActiveCourts, staleTime: 60_000 });
  return (
    <Field label={tr('ws.reports.filters.court')} style={fieldStyle}>
      <Select
        value={value}
        disabled={disabled}
        style={selectStyle}
        onChange={onChange}
        options={[{ value: '', label: tr('ws.reports.filters.allCourts') }, ...(courtsQ.data ?? []).map((c) => ({ value: c.id, label: pickName(locale, c) }))]}
      />
    </Field>
  );
}

export function CategoryFilter({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const { tr, locale } = useLocale();
  const categoriesQ = useQuery({ queryKey: REPORT_CATEGORIES_KEY, queryFn: fetchReportCategories, staleTime: 60_000 });
  return (
    <Field label={tr('ws.reports.filters.category')} style={fieldStyle}>
      <Select
        value={value}
        disabled={disabled}
        style={selectStyle}
        onChange={onChange}
        options={[{ value: '', label: tr('ws.reports.filters.allCategories') }, ...(categoriesQ.data ?? []).map((c) => ({ value: c.id, label: pickName(locale, c) }))]}
      />
    </Field>
  );
}

/** The staff list, shared with the screen so it can name the chosen person. */
export function useReportStaff() {
  return useQuery({ queryKey: REPORT_STAFF_KEY, queryFn: fetchReportStaff, staleTime: 60_000 });
}

export function StaffFilter({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const { tr } = useLocale();
  const staffQ = useReportStaff();
  return (
    <Field label={tr('ws.reports.filters.staff')} style={fieldStyle}>
      <Select
        value={value}
        disabled={disabled}
        style={selectStyle}
        onChange={onChange}
        options={[{ value: '', label: tr('ws.reports.filters.allStaff') }, ...(staffQ.data ?? []).map((s) => ({ value: s.id, label: s.display_name }))]}
      />
    </Field>
  );
}

export function PaymentFilter({ value, onChange, disabled }: { value: PaymentMethodFilter | ''; onChange: (m: PaymentMethodFilter | '') => void; disabled?: boolean }) {
  const { tr } = useLocale();
  return (
    <Field label={tr('ws.reports.filters.payment')} style={fieldStyle}>
      <Select<PaymentMethodFilter | ''>
        value={value}
        disabled={disabled}
        style={{ ...selectStyle, minInlineSize: '9rem' }}
        onChange={onChange}
        options={[
          { value: '', label: tr('ws.reports.filters.allPayments') },
          { value: 'cash', label: tr('ws.reports.filters.cash') },
          { value: 'card', label: tr('ws.reports.filters.card') },
        ]}
      />
    </Field>
  );
}

/** Day / week / month for a table's rows. Inline, beside the breakdown switch it belongs to. */
export function GroupFilter({ value, onChange, disabled }: { value: ReportGroup; onChange: (g: ReportGroup) => void; disabled?: boolean }) {
  const { tr } = useLocale();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
      <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>{tr('ws.reports.filters.group')}</span>
      <SegmentedControl<ReportGroup>
        aria-label={tr('ws.reports.filters.group')}
        value={value}
        onChange={onChange}
        options={[
          { value: 'day', label: tr('ws.reports.filters.day'), disabled },
          { value: 'week', label: tr('ws.reports.filters.week'), disabled },
          { value: 'month', label: tr('ws.reports.filters.month'), disabled },
        ]}
      />
    </span>
  );
}

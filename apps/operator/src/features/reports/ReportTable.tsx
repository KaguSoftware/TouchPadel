/**
 * ReportTable (spec §07 Reporting) = DataTable over a normalised server
 * result: sortable columns, a totals row from `result.totals`, drill on row
 * click. Every cell is a formatted server value.
 *
 * Sort and page live in ReportScreen, not here: the count beside the page title
 * has to know how many of how many rows are on screen, and a table that owned
 * that privately could only tell the header after the fact. `rows` arrives
 * sorted and sliced; the totals are the server's for the whole result, not the
 * page, which is why they are labelled Total and never move with the pager.
 */
import { useMemo, type ReactNode } from 'react';
import { useLocale } from '../../lib/i18n';
import { DataTable, type SortState } from '../../components/kit';
import { toDataColumns, unitsFor } from './columns';
import { formatCell, type NormalizedColumn, type ReportRow } from './reportTypes';

export function ReportTable({
  columns,
  rows,
  totals,
  onDrill,
  sortable = true,
  sort,
  onSort,
  rowExtra,
  'aria-label': ariaLabel,
}: {
  columns: readonly NormalizedColumn[];
  rows: readonly ReportRow[];
  totals?: ReportRow | null;
  onDrill?: (row: ReportRow) => void;
  sortable?: boolean;
  sort?: SortState | null;
  onSort?: (next: SortState) => void;
  /** Rendered in a trailing column (e.g. the staff report's audit-log link). */
  rowExtra?: { header: ReactNode; render: (row: ReportRow) => ReactNode };
  'aria-label'?: string;
}) {
  const { tr, locale } = useLocale();
  const units = unitsFor(tr);
  const dataColumns = useMemo(() => {
    const cols = toDataColumns(columns, locale, tr, { sortable });
    if (rowExtra) cols.push({ key: '__extra', header: rowExtra.header, render: rowExtra.render, align: 'end' });
    return cols;
  }, [columns, locale, tr, sortable, rowExtra]);
  const hasTotals = Boolean(totals && Object.keys(totals).length > 0);

  return (
    <DataTable
      aria-label={ariaLabel}
      columns={dataColumns}
      rows={rows}
      rowKey={(row, i) => String(row.id ?? row.key ?? i)}
      sort={sortable ? (sort ?? null) : null}
      onSort={sortable ? onSort : undefined}
      onRowClick={onDrill}
      dense
      footer={
        hasTotals ? (
          <tr style={{ fontWeight: 700, background: 'var(--tp-surface-2)' }}>
            {dataColumns.map((c, i) => {
              const col = columns.find((n) => n.key === c.key);
              const v = totals ? totals[c.key] : undefined;
              const text = i === 0 && v == null ? tr('ws.reports.totals') : col ? formatCell(v, col.kind, locale, units) : '';
              return (
                <td key={c.key} data-align={c.align ?? (c.numeric ? 'end' : 'start')} style={c.numeric ? { fontFamily: 'var(--tp-font-numeric)', fontVariantNumeric: 'tabular-nums' } : undefined}>
                  {text}
                </td>
              );
            })}
          </tr>
        ) : undefined
      }
    />
  );
}

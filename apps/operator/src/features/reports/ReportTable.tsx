/**
 * ReportTable (spec §07 Reporting) = DataTable over a normalised server
 * result: sortable columns, a totals row from `result.totals`, drill on row
 * click. Every cell is a formatted server value.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useLocale } from '../../lib/i18n';
import { DataTable, type SortState } from '../../components/kit';
import { toDataColumns, unitsFor } from './columns';
import { formatCell, sortRows, type NormalizedColumn, type ReportRow } from './reportTypes';

export function ReportTable({
  columns,
  rows,
  totals,
  onDrill,
  sortable = true,
  defaultSort,
  rowExtra,
  'aria-label': ariaLabel,
}: {
  columns: readonly NormalizedColumn[];
  rows: readonly ReportRow[];
  totals?: ReportRow | null;
  onDrill?: (row: ReportRow) => void;
  sortable?: boolean;
  defaultSort?: SortState | null;
  /** Rendered in a trailing column (e.g. the staff report's audit-log link). */
  rowExtra?: { header: ReactNode; render: (row: ReportRow) => ReactNode };
  'aria-label'?: string;
}) {
  const { tr, locale } = useLocale();
  const [sort, setSort] = useState<SortState | null>(defaultSort ?? null);
  const units = unitsFor(tr);
  const dataColumns = useMemo(() => {
    const cols = toDataColumns(columns, locale, tr, { sortable });
    if (rowExtra) cols.push({ key: '__extra', header: rowExtra.header, render: rowExtra.render, align: 'end' });
    return cols;
  }, [columns, locale, tr, sortable, rowExtra]);
  const sorted = useMemo(() => sortRows(rows, sort?.key ?? null, sort?.dir ?? 'asc'), [rows, sort]);
  const hasTotals = Boolean(totals && Object.keys(totals).length > 0);

  return (
    <DataTable
      aria-label={ariaLabel}
      columns={dataColumns}
      rows={sorted}
      rowKey={(row, i) => String(row.id ?? row.key ?? i)}
      sort={sortable ? sort : null}
      onSort={sortable ? setSort : undefined}
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

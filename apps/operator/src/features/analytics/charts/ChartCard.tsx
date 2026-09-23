/**
 * `CardShell` + the LTR plotting box every chart on this page needs: axes are
 * numeric and must run left-to-right even when the operator is in Arabic, so
 * the plot area is forced `dir="ltr"` while the card chrome inherits page dir.
 *
 * `twin` is the chart's table: the same rows, as a dense DataTable behind a
 * toggle, and as a CSV download. Dataviz asks for one on every chart so no
 * value is reachable only through colour or hover; it is also what a screen
 * reader gets instead of the SVG.
 */
import { useState, type ReactNode } from 'react';
import type { MessageKey } from '@touch/i18n';
import { Button } from '../../../components/ui';
import { DataTable, type Column } from '../../../components/kit';
import { useLocale } from '../../../lib/i18n';
import { CardShell, type CardState } from '../cards/CardShell';
import { downloadTable, type CsvCell } from '../exportTables';

export interface ChartTwinColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

export interface ChartTwin {
  columns: readonly ChartTwinColumn[];
  rows: readonly Record<string, string | number | null | undefined>[];
  /** The downloaded file name, without an extension. */
  file: string;
}

type TwinRow = ChartTwin['rows'][number];

export function ChartCard({
  title,
  state,
  height = 260,
  children,
  note,
  tip,
  refreshing,
  actions,
  twin,
  emptyKey,
  error,
  onRetry,
}: {
  title: string;
  state: CardState;
  height?: number;
  children: ReactNode;
  note?: ReactNode;
  tip?: ReactNode;
  refreshing?: boolean;
  actions?: ReactNode;
  twin?: ChartTwin;
  emptyKey?: MessageKey;
  error?: unknown;
  onRetry?: () => void;
}) {
  const { tr, locale } = useLocale();
  const [showTable, setShowTable] = useState(false);
  const columns: Column<TwinRow>[] =
    twin?.columns.map((c) => ({
      key: c.key,
      header: c.label,
      numeric: c.numeric,
      render: (row) => (row[c.key] == null ? '—' : String(row[c.key])),
    })) ?? [];
  const exportCsv = () => {
    if (!twin) return;
    const cells: CsvCell[][] = twin.rows.map((row) => twin.columns.map((c) => row[c.key] ?? null));
    downloadTable(twin.file, locale, { name: title, columns: twin.columns.map((c) => c.label), rows: cells });
  };
  const twinActions = twin && state === 'ready' && (
    <>
      <Button
        kind="ghost"
        size="sm"
        icon="table"
        aria-label={showTable ? tr('ws.analytics.twin.chart') : tr('ws.analytics.twin.table')}
        aria-pressed={showTable}
        onClick={() => setShowTable((v) => !v)}
      />
      <Button kind="ghost" size="sm" icon="fileText" aria-label={tr('ws.analytics.twin.csv')} onClick={exportCsv} />
    </>
  );
  return (
    <CardShell
      title={title}
      state={state}
      note={note}
      tip={tip}
      refreshing={refreshing}
      actions={
        twinActions || actions ? (
          <>
            {actions}
            {twinActions}
          </>
        ) : undefined
      }
      emptyKey={emptyKey}
      error={error}
      onRetry={onRetry}
      skeletonLines={5}
    >
      {showTable && twin ? (
        <DataTable<TwinRow>
          columns={columns}
          rows={[...twin.rows]}
          rowKey={(_row, i) => String(i)}
          dense
          maxBlockSize={`${height}px`}
          aria-label={title}
        />
      ) : (
        <div dir="ltr" style={{ blockSize: `${height}px`, inlineSize: '100%' }}>
          {children}
        </div>
      )}
    </CardShell>
  );
}

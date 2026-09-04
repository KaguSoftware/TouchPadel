/**
 * Inline horizontal bars for a by-hour (or by-anything) view — tokens only,
 * no charting library (Recharts stays inside /analytics). The bar length is
 * the server's percentage when the column is a percent; otherwise it is scaled
 * against the largest value purely for display.
 */
import { useLocale } from '../../lib/i18n';
import { unitsFor } from './columns';
import { formatCell, type NormalizedColumn, type ReportRow } from './reportTypes';

export function HourBars({
  rows,
  labelKey,
  valueKey,
  columns,
  title,
}: {
  rows: readonly ReportRow[];
  labelKey: string;
  valueKey: string;
  columns: readonly NormalizedColumn[];
  title: string;
}) {
  const { tr, locale } = useLocale();
  const units = unitsFor(tr);
  const valueCol = columns.find((c) => c.key === valueKey);
  const labelCol = columns.find((c) => c.key === labelKey);
  if (!valueCol || rows.length === 0) return null;
  const values = rows.map((r) => (typeof r[valueKey] === 'number' ? (r[valueKey] as number) : 0));
  const max = valueCol.kind === 'percent' ? 100 : Math.max(...values, 0);
  return (
    <section aria-label={title} style={{ display: 'grid', gap: '0.3rem', marginBlockEnd: '1rem', maxInlineSize: '48rem' }}>
      <h2 style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</h2>
      {rows.map((row, i) => {
        const v = values[i] ?? 0;
        const width = max > 0 ? Math.min(100, Math.max(0, (v / max) * 100)) : 0;
        const label = labelCol ? formatCell(row[labelKey], labelCol.kind, locale, units) : String(row[labelKey] ?? '');
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '5rem minmax(0, 1fr) 6rem', alignItems: 'center', gap: '0.6rem', fontSize: 'var(--tp-fs-sm)' }}>
            <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'start' }}>{label}</span>
            <span style={{ display: 'block', blockSize: '0.8rem', background: 'var(--tp-surface-2)', borderRadius: 'var(--tp-radius-pill)', overflow: 'hidden' }}>
              <span aria-hidden="true" style={{ display: 'block', blockSize: '100%', inlineSize: `${width}%`, background: 'var(--tp-accent)', transition: 'inline-size var(--tp-dur-fast) var(--tp-ease-out)' }} />
            </span>
            <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--tp-font-numeric)', textAlign: 'end' }}>
              {formatCell(row[valueKey], valueCol.kind, locale, units)}
            </span>
          </div>
        );
      })}
    </section>
  );
}

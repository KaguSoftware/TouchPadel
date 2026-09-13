/**
 * 24 bars, one per venue hour, the peak emphasised. A thin wrapper over
 * CountBars kept for the cafe tab's existing call site.
 */
import { useLocale } from '../../../lib/i18n';
import type { PeakHourRow } from '../shape';
import type { Formatters } from '../format';
import { CountBars } from './CountBars';

export function PeakHoursChart({ rows, f }: { rows: readonly PeakHourRow[]; f: Formatters }) {
  const { tr } = useLocale();
  return (
    <CountBars
      rows={rows.map((r) => ({ label: f.hour(r.hour), value: r.views }))}
      format={(n) => f.compact(n)}
      name={tr('analytics.cards.viewsSeries')}
      tickFontSize={10}
      interval={1}
    />
  );
}

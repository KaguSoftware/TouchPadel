/** 01 Pulse: eight tiles in two rows of four, each with its comparison behind the delta. */
import { useLocale } from '../../../../lib/i18n';
import { Kpi, type KpiCompare } from '../../cards/Kpi';
import type { CourtKpiKey, KpiDelta } from '../derive';
import { hoursText, rateText } from '../format';
import type { SectionProps } from './types';

export function PulseSection({ raw, derived, state, f, vsLabel }: SectionProps & { vsLabel: string }) {
  const { tr } = useLocale();
  const k = raw?.summary.kpis;
  const cafe = raw?.cafe.attach;
  const loading = state === 'loading';
  const broken = state === 'error';
  const mutedReason = derived && !derived.compareReliable ? tr('ws.analytics.courts.notices.compareMuted') : undefined;
  const d = (key: CourtKpiKey): KpiDelta | undefined => derived?.deltas[key];
  const cmp = (key: CourtKpiKey, fmt: (n: number) => string): KpiCompare | undefined => {
    const x = d(key);
    return x && x.current != null && x.previous != null ? { label: vsLabel, current: fmt(x.current), previous: fmt(x.previous) } : undefined;
  };
  const noHours = derived?.noOpeningHours ?? false;
  const tile = (
    label: string,
    value: string,
    key: CourtKpiKey,
    fmt: (n: number) => string,
    tip: string,
    opts: { unavailable?: boolean; note?: string; invert?: boolean } = {},
  ) => (
    <Kpi
      label={label}
      value={value}
      delta={d(key)?.delta ?? null}
      reason={mutedReason}
      vsLabel={vsLabel}
      tip={tip}
      compare={cmp(key, fmt)}
      invert={opts.invert}
      note={opts.note}
      loading={loading}
      unavailable={broken || opts.unavailable}
      f={f}
    />
  );
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2-5)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 'var(--tp-sp-2-5)' }}>
        {tile(tr('ws.analytics.courts.kpi.bookings'), f.num(k?.bookings ?? 0), 'bookings', f.num, tr('ws.analytics.courts.tips.bookings'))}
        {tile(tr('ws.analytics.courts.kpi.bookedHours'), hoursText(f, k?.bookedMinutes ?? 0), 'bookedHours', (n) => f.num1(n), tr('ws.analytics.courts.tips.bookedHours'))}
        {tile(tr('ws.analytics.courts.kpi.occupancy'), k?.occupancyPct == null ? '—' : f.pct(k.occupancyPct), 'occupancy', f.pct, tr('ws.analytics.courts.tips.occupancy'), { unavailable: noHours })}
        {tile(tr('ws.analytics.courts.kpi.revenue'), f.money(k?.revenueIqd ?? 0), 'revenue', f.money, tr('ws.analytics.courts.tips.revenue'))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 'var(--tp-sp-2-5)' }}>
        {tile(tr('ws.analytics.courts.kpi.revPerOpenHour'), k?.revPerOpenHourIqd == null ? '—' : f.money(k.revPerOpenHourIqd), 'revPerOpenHour', f.money, tr('ws.analytics.courts.tips.revPerOpenHour'), { unavailable: noHours })}
        {tile(tr('ws.analytics.courts.kpi.cancelRate'), k ? rateText(tr, f, k.cancellationRatePct, k.cancellations, k.bookedTotal) : '—', 'cancellationRate', f.pct, tr('ws.analytics.courts.tips.cancelRate'), { invert: true })}
        {tile(tr('ws.analytics.courts.kpi.noShowRate'), k ? rateText(tr, f, k.noShowRatePct, k.noShows, k.bookedTotal) : '—', 'noShowRate', f.pct, tr('ws.analytics.courts.tips.noShowRate'), { invert: true })}
        {tile(tr('ws.analytics.courts.kpi.attachRate'), cafe ? rateText(tr, f, cafe.attachPct, cafe.linkedBookings, cafe.liveBookings) : '—', 'attachRate', f.pct, tr('ws.analytics.courts.tips.attachRate'))}
      </div>
    </div>
  );
}

/**
 * Day × hour heatmap as a CSS grid (no Recharts: a 7×24 matrix of coloured
 * cells is cheaper and sharper as DOM). Sequential ramp, one hue; the busiest
 * cell is the ramp's own darkest step, never a second colour. Generic over the
 * measure: guest views, till orders, court occupancy and attach rate all plot
 * through it, the caller names the unit and formats the value.
 *
 * Hover layer: the cell under the pointer (or the focused cell) prints its
 * reading on a reserved line under the grid, so the layout never jumps and a
 * screen reader hears the same text. Cells the venue is closed for (`open:
 * false`) are hatched, not blank, so "nothing booked" and "not open" stay
 * different. Every value is also in the card's table twin, so nothing is
 * gated on hovering.
 *
 * `totals` adds a second view behind a Squares | Charts switch (2026-10-24): the
 * squares on their own, or a column chart of the hours and a bar per weekday,
 * so "which hour" and "which day" read off the same card as "which hour of
 * which day" (they used to be two more charts behind Show more, then margins
 * crowding the grid). The caller supplies them, because a rate's
 * margin is the server's roll-up (occupancy by hour), never a sum of cells;
 * `sumTotals` (./geometry.ts) is for measures that add up.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { SegmentedControl } from '../../../components/kit';
import { useLocale } from '../../../lib/i18n';
import { weekdayName } from '../copy';
import type { Formatters } from '../format';
import { heatColor, useChartColors } from './colors';
import type { HeatTotals } from './geometry';

export interface HeatValue {
  dow: number;
  hour: number;
  value: number;
  /** `false` hatches the cell (venue closed); default open. */
  open?: boolean;
  /** Under the sample floor: painted muted, never the peak, and read out with `label`. */
  thin?: boolean;
  /** Readout text for a thin cell ("3 of 7") in place of the formatted value. */
  label?: string;
}

export type HeatView = 'squares' | 'charts';

/** The card body height each view needs: the charts view stacks an hour chart and seven weekday bars. */
export const heatHeight = (view: HeatView) => (view === 'charts' ? 400 : 240);

/** The thin rule that parts the view switch from the measure switch beside it. */
export const heatDivider = <span aria-hidden="true" style={{ inlineSize: 1, blockSize: '1.25rem', background: 'var(--tp-border-strong)' }} />;

/** The Squares | Charts state and its switch, for a card to put in its controls (ahead of the measure switch). */
export function useHeatView(): { view: HeatView; switcher: ReactNode } {
  const { tr } = useLocale();
  const [view, setView] = useState<HeatView>('squares');
  const switcher = (
    <SegmentedControl<HeatView>
      size="sm"
      aria-label={tr('ws.analytics.heatmap.view')}
      value={view}
      onChange={setView}
      options={[
        { value: 'squares', label: tr('ws.analytics.heatmap.viewSquares') },
        { value: 'charts', label: tr('ws.analytics.heatmap.viewCharts') },
      ]}
    />
  );
  return { view, switcher };
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DOWS = [0, 1, 2, 3, 4, 5, 6];

const closedGround: CSSProperties = {
  background: 'repeating-linear-gradient(135deg, var(--tp-surface-2) 0 3px, var(--tp-surface) 3px 6px)',
};

export function WeekHeatmap({
  cells,
  f,
  format,
  unit,
  hint,
  totals,
  relative = true,
  scaleMax,
  view = 'squares',
}: {
  cells: readonly HeatValue[];
  f: Formatters;
  /** Formats one cell's value for the readout ("12 bookings", "82%"). */
  format: (value: number) => string;
  /** What is being measured, for the accessible summary. */
  unit: string;
  /** Idle readout text (what hovering will reveal). */
  hint: string;
  /** Hour and weekday margins; `format` reads them out (an average reads differently from a total). */
  totals?: HeatTotals & { format: (value: number) => string };
  /** Read a cell out as a share of the peak too ("· 80% of peak"). Off where the values are levels, not amounts. */
  relative?: boolean;
  /** A fixed top of the ramp (levels 0..4 run against 4), so a quiet week never paints its busiest hour as full. */
  scaleMax?: number;
  /** With `totals`: the squares, or the hour and weekday charts. The card's controls hold the switch (useHeatView). */
  view?: HeatView;
}) {
  const { GRID, HEAT_RAMP } = useChartColors();
  const { tr } = useLocale();
  const hourMax = Math.max(0, ...(totals?.hours ?? []).map((v) => v ?? 0));
  const dayMax = Math.max(0, ...(totals?.days ?? []).map((v) => v ?? 0));
  const margin = (v: number | null | undefined, max: number) => (v == null ? 'transparent' : max > 0 && v === max ? HEAT_RAMP[5] : HEAT_RAMP[3]);
  const byKey = new Map(cells.map((c) => [`${c.dow}:${c.hour}`, c]));
  const max = scaleMax ?? cells.reduce((m, c) => Math.max(m, c.open === false || c.thin ? 0 : c.value), 0);
  const [active, setActive] = useState<string | null>(null);
  const activeCell = active ? byKey.get(active) : undefined;
  const activeParts = active?.split(':').map(Number) ?? [];
  const activeDow = activeParts[0] ?? 0;
  const activeHour = activeParts[1] ?? 0;

  /** A margin's key is "h=9" (an hour) or "d=2" (a weekday); a cell's is "2:9". */
  const marginReadout = (key: string): string | null => {
    if (!totals) return null;
    const kind = key[0];
    const n = Number(key.slice(2));
    if (kind === 'h') return `${tr('ws.analytics.viz.everyDay', { hour: f.hour(n) })} · ${totals.hours[n] == null ? tr('ws.analytics.heatmap.closed') : totals.format(totals.hours[n]!)}`;
    if (kind === 'd') return `${tr('ws.analytics.viz.allDay', { day: weekdayName(tr, n) })} · ${totals.days[n] == null ? tr('ws.analytics.heatmap.closed') : totals.format(totals.days[n]!)}`;
    return null;
  };
  const readout = active && active.includes('=')
    ? (marginReadout(active) ?? hint)
    : active
    ? `${weekdayName(tr, activeDow)} ${f.hour(activeHour)} · ${
        activeCell?.open === false
          ? tr('ws.analytics.heatmap.closed')
          : activeCell?.thin
            ? (activeCell.label ?? format(activeCell.value))
            : `${format(activeCell?.value ?? 0)}${relative && max > 0 ? ` · ${tr('ws.analytics.heatmap.ofPeak', { pct: f.pct(((activeCell?.value ?? 0) / max) * 100) })}` : ''}`
      }`
    : hint;

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      {totals && view === 'charts' ? (
        <div dir="ltr" style={{ display: 'grid', gap: 'var(--tp-sp-4)' }} onPointerLeave={() => setActive(null)}>
          <section style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
            <h4 style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-muted-fg)' }}>{tr('ws.analytics.heatmap.byHour')}</h4>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(24, minmax(0, 1fr))', gap: '2px', minInlineSize: '30rem' }}>
                {HOURS.map((h) => {
                  const v = totals.hours[h];
                  const key = `h=${h}`;
                  return (
                    <span key={key} data-total-hour={h} onPointerEnter={() => setActive(key)} style={{ display: 'flex', alignItems: 'flex-end', blockSize: '7rem' }}>
                      <span
                        style={{
                          inlineSize: '100%',
                          blockSize: v == null ? 0 : `${hourMax > 0 ? Math.max(4, (v / hourMax) * 100) : 4}%`,
                          background: margin(v, hourMax),
                          borderStartStartRadius: 2,
                          borderStartEndRadius: 2,
                          outline: active === key ? '1px solid var(--tp-accent)' : undefined,
                        }}
                      />
                    </span>
                  );
                })}
                {HOURS.map((h) => (
                  <span key={h} style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', textAlign: 'center' }}>
                    {h % 3 === 0 ? h : ''}
                  </span>
                ))}
              </div>
            </div>
          </section>
          <section style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
            <h4 style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-muted-fg)' }}>{tr('ws.analytics.heatmap.byDay')}</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 'var(--tp-sp-2)', rowGap: '4px', alignItems: 'center' }}>
              {DOWS.map((dow) => {
                const v = totals.days[dow];
                const key = `d=${dow}`;
                return (
                  <div key={key} data-total-day={dow} onPointerEnter={() => setActive(key)} style={{ display: 'contents' }}>
                    <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', whiteSpace: 'nowrap' }}>{f.weekday(dow)}</span>
                    <span style={{ display: 'flex', alignItems: 'center', blockSize: '1.1rem' }}>
                      <span
                        style={{
                          blockSize: '0.8rem',
                          // An open day always shows a stub, so "open, nothing booked" never reads as closed.
                          inlineSize: v == null ? 0 : `${dayMax > 0 ? Math.max(2, ((v ?? 0) / dayMax) * 100) : 2}%`,
                          background: margin(v, dayMax),
                          borderStartEndRadius: 2,
                          borderEndEndRadius: 2,
                          outline: active === key ? '1px solid var(--tp-accent)' : undefined,
                        }}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      ) : (
      <div dir="ltr" style={{ overflowX: 'auto' }} onPointerLeave={() => setActive(null)}>
        <div
          role="img"
          aria-label={`${unit}: ${cells.length} ${tr('ws.analytics.heatmap.cells')}`}
          style={{ display: 'grid', gridTemplateColumns: `max-content repeat(24, minmax(0, 1fr))`, gap: '1px', minInlineSize: '42rem' }}
        >
          <span />
          {HOURS.map((h) => (
            <span key={h} style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', textAlign: 'center' }}>
              {h % 3 === 0 ? h : ''}
            </span>
          ))}
          {DOWS.map((dow) => (
            <Row
              key={dow}
              dow={dow}
              label={f.weekday(dow)}
              byKey={byKey}
              max={max}
              active={active}
              onActive={setActive}
            />
          ))}
        </div>
      </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-3)', minBlockSize: '1.25rem' }}>
        <span aria-live="polite" style={{ fontSize: 'var(--tp-fs-xs)', color: active ? 'var(--tp-fg)' : 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>
          {readout}
        </span>
        <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          <span style={{ marginInlineEnd: 'var(--tp-sp-1)' }}>{tr('ws.analytics.heatmap.less')}</span>
          {HEAT_RAMP.map((c) => (
            <span key={c} style={{ inlineSize: '0.75rem', blockSize: '0.6rem', background: c, border: `1px solid ${GRID}`, borderRadius: '2px' }} />
          ))}
          <span style={{ marginInlineStart: 'var(--tp-sp-1)' }}>{tr('ws.analytics.heatmap.more')}</span>
        </span>
      </div>
    </div>
  );
}

function Row({
  dow,
  label,
  byKey,
  max,
  active,
  onActive,
}: {
  dow: number;
  label: string;
  byKey: Map<string, HeatValue>;
  max: number;
  active: string | null;
  onActive: (key: string | null) => void;
}) {
  const { GRID, HEAT_RAMP } = useChartColors();
  return (
    <>
      <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', lineHeight: '1.1rem', paddingInlineEnd: 'var(--tp-sp-2)', whiteSpace: 'nowrap' }}>{label}</span>
      {HOURS.map((hour) => {
        const key = `${dow}:${hour}`;
        const cell = byKey.get(key);
        const closed = cell?.open === false;
        const thin = Boolean(cell?.thin);
        const value = closed ? 0 : (cell?.value ?? 0);
        const peak = !thin && max > 0 && value === max;
        const isActive = active === key;
        return (
          <span
            key={hour}
            data-dow={dow}
            data-hour={hour}
            data-thin={thin ? 'true' : undefined}
            onPointerEnter={() => onActive(key)}
            style={{
              blockSize: '1.1rem',
              ...(closed
                ? closedGround
                : { background: peak ? HEAT_RAMP[HEAT_RAMP.length - 1] : heatColor(HEAT_RAMP, max > 0 ? Math.min(1, value / max) : 0) }),
              opacity: thin ? 0.35 : undefined,
              border: `1px solid ${isActive ? 'var(--tp-accent)' : GRID}`,
              borderRadius: '2px',
              boxShadow: isActive ? '0 0 0 1px var(--tp-accent)' : undefined,
            }}
          />
        );
      })}
    </>
  );
}

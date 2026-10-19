/**
 * The menu-engineering matrix as what it is: every costed item placed by how
 * many sold (across) and what each one earns (up), with the two lines that
 * split the menu into its four quadrants: the popularity rule and the menu's
 * average profit per unit, both from the same derivation the quadrant lists
 * use (@touch/core menuEngineering). The lists name the items; this shows
 * where each one sits and how far from a line.
 *
 * Units sold run on a square-root scale, so the one item that sold 800 does
 * not press the other forty against the axis. An item sold below cost sits
 * under zero and takes the danger colour; the popular-and-profitable corner
 * takes the accent, every other dot the muted bar colour (emphasis, not a
 * colour per quadrant: the lines and the corner names carry the quadrant).
 * Pointing at a dot reads it out on a line under the plot, which never moves.
 */
import { useState } from 'react';
import { pickLocale, type MenuQuadrant } from '@touch/core';
import type { MessageKey } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import type { Formatters } from '../format';
import { useChartColors } from './colors';

export interface ScatterItem {
  id: string;
  nameEn: string;
  nameAr: string;
  qty: number;
  unitMarginIqd: number;
  quadrant: MenuQuadrant;
  losingMoney: boolean;
}

const W = 520;
const H = 230;
const PAD = { top: 10, right: 12, bottom: 26, left: 52 };

const CORNER: Record<MenuQuadrant, MessageKey> = {
  star: 'analytics.matrix.star',
  plowhorse: 'analytics.matrix.plowhorse',
  puzzle: 'analytics.matrix.puzzle',
  dog: 'analytics.matrix.dog',
};

export function MenuScatter({ items, qtyLine, marginLine, f }: { items: readonly ScatterItem[]; qtyLine: number; marginLine: number; f: Formatters }) {
  const { tr, locale } = useLocale();
  const { AXIS, GRID, HIGHLIGHT, BAR_MUTED, DANGER, SURFACE, HEAT_RAMP } = useChartColors();
  const [at, setAt] = useState<string | null>(null);
  const maxQty = Math.max(1, qtyLine, ...items.map((i) => i.qty));
  const maxM = Math.max(1, marginLine, ...items.map((i) => i.unitMarginIqd));
  const minM = Math.min(0, ...items.map((i) => i.unitMarginIqd));
  const x = (q: number) => PAD.left + (Math.sqrt(Math.max(0, q)) / Math.sqrt(maxQty)) * (W - PAD.left - PAD.right);
  const y = (m: number) => PAD.top + ((maxM - m) / (maxM - minM || 1)) * (H - PAD.top - PAD.bottom);
  const lx = x(qtyLine);
  const ly = y(marginLine);
  const name = (i: ScatterItem) => pickLocale({ en: i.nameEn, ar: i.nameAr }, locale) || i.id;
  const lit = items.find((i) => i.id === at);
  const corner = (q: MenuQuadrant, cx: number, cy: number, anchor: 'start' | 'end') => (
    <text x={cx} y={cy} textAnchor={anchor} fontSize={10.5} fontWeight={600} fill={AXIS}>
      {tr(CORNER[q])}
    </text>
  );
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
      <div dir="ltr" onPointerLeave={() => setAt(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={tr('ws.analytics.viz.scatter.label', { n: f.num(items.length) })} style={{ display: 'block', overflow: 'visible' }}>
          {/* The popular-and-profitable corner, faintly lit. */}
          <rect x={lx} y={PAD.top} width={Math.max(0, W - PAD.right - lx)} height={Math.max(0, ly - PAD.top)} fill={HEAT_RAMP[1]} opacity={0.55} />
          <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke={GRID} />
          <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={H - PAD.bottom} stroke={GRID} />
          {minM < 0 && <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke={DANGER} strokeOpacity={0.5} strokeDasharray="2 3" />}
          <line x1={lx} x2={lx} y1={PAD.top} y2={H - PAD.bottom} stroke={AXIS} strokeOpacity={0.6} strokeDasharray="4 3" />
          <line x1={PAD.left} x2={W - PAD.right} y1={ly} y2={ly} stroke={AXIS} strokeOpacity={0.6} strokeDasharray="4 3" />
          {corner('star', W - PAD.right - 4, PAD.top + 13, 'end')}
          {corner('puzzle', PAD.left + 6, PAD.top + 13, 'start')}
          {corner('plowhorse', W - PAD.right - 4, H - PAD.bottom - 6, 'end')}
          {corner('dog', PAD.left + 6, H - PAD.bottom - 6, 'start')}
          <text x={PAD.left - 6} y={ly + 3.5} textAnchor="end" fontSize={10} fill={AXIS}>
            {f.compact(marginLine)}
          </text>
          <text x={PAD.left - 6} y={PAD.top + 8} textAnchor="end" fontSize={10} fill={AXIS}>
            {f.compact(maxM)}
          </text>
          <text x={lx} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={10} fill={AXIS}>
            {f.num(Math.round(qtyLine))}
          </text>
          <text x={W - PAD.right} y={H - 2} textAnchor="end" fontSize={10.5} fill={AXIS}>
            {tr('ws.analytics.viz.scatter.popularity')}
          </text>
          <text x={4} y={PAD.top + 8} fontSize={10.5} fill={AXIS} transform={`rotate(-90 ${4} ${PAD.top + 8})`} textAnchor="end">
            {tr('ws.analytics.viz.scatter.profitEach')}
          </text>
          {items.map((i) => {
            const on = at === i.id;
            const fill = i.losingMoney ? DANGER : i.quadrant === 'star' ? HIGHLIGHT : BAR_MUTED;
            return (
              <g key={i.id} onPointerEnter={() => setAt(i.id)}>
                {/* A hit target bigger than the mark (dataviz interaction). */}
                <circle cx={x(i.qty)} cy={y(i.unitMarginIqd)} r={10} fill="transparent" />
                <circle cx={x(i.qty)} cy={y(i.unitMarginIqd)} r={on ? 6.5 : 4.5} fill={fill} stroke={SURFACE} strokeWidth={2} opacity={at && !on ? 0.45 : 0.95} />
              </g>
            );
          })}
        </svg>
      </div>
      <span aria-live="polite" style={{ fontSize: 'var(--tp-fs-xs)', minBlockSize: '1.1rem', color: lit ? 'var(--tp-fg)' : 'var(--tp-muted-fg)' }}>
        {lit ? (
          <>
            <strong>{name(lit)}</strong> · {tr(CORNER[lit.quadrant])} · {tr('analytics.matrix.itemLine', { margin: f.money(lit.unitMarginIqd), qty: f.num(lit.qty) })}
          </>
        ) : (
          tr('ws.analytics.viz.scatter.hint')
        )}
      </span>
    </div>
  );
}

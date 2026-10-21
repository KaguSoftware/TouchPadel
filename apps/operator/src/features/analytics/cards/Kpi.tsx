/**
 * The summary figures of both analytics tabs, in two sizes.
 *
 *  - `Kpi` is a LEAD figure: one of the three or four numbers the tab answers
 *    first, as a tile with a large value.
 *  - `FigureLine` is a SUPPORTING figure: a row in a list, value at the end,
 *    the way the management panel lists its figures.
 *
 * The page used to give ten (courts) or fourteen (cafe) figures the same tile,
 * so nothing said which ones matter; and when the comparison was unreliable
 * every tile printed the same two-line reason, ten times over. Now:
 *
 *  - The change is ONE short line: an arrow, the signed change in its proper
 *    unit (percent for amounts, points for rates, see ../change.ts) and what
 *    the figure was before. When there is no reliable change the line says
 *    only what it was, or nothing, and the page's notice says why, once.
 *  - The value prints "—" when the query behind it failed, never a 0.
 *  - A figure that opens its transactions says so in words ("See
 *    transactions"), and a tile with two figures names each.
 */
import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Button, Skeleton, card } from '../../../components/ui';
import { BreakdownCard, BreakdownList, breakdownRowStyle, type BreakdownTone } from '../../../components/BreakdownCards';
import { InfoTip } from '../../../components/InfoTip';
import { Icon } from '../../../components/icons';
import { useLocale } from '../../../lib/i18n';
import { MARK_FG } from '../../ops/OpsVisuals';
import { describeChange, type Change, type DeltaKind } from '../change';
import type { Formatters } from '../format';
import { Sparkline, type SparkSeries } from '../charts/Sparkline';

export interface KpiDrill {
  /** Names the figure when a tile carries more than one; a lone drill reads "See transactions". */
  label?: string;
  onOpen: () => void;
}

interface FigureProps {
  label: string;
  value: string;
  /** Whole-number change against the comparison window; null = none to show. */
  delta?: number | null;
  /** 'points' for rates (a 20% → 23% move is "+3 pts"). */
  kind?: DeltaKind;
  /** Up is bad (a cancellation rate): a rise reads in the danger tone. */
  invert?: boolean;
  /** Neither direction is good (waiter calls, session length): the change stays muted. */
  neutral?: boolean;
  /** The comparison window's figure, formatted. Printed as "was …". */
  previous?: string | null;
  /** STATE under the number (a split, a sample size). Stays visible. */
  note?: ReactNode;
  /** EXPLANATION of what is counted. Behind the info button. */
  tip?: ReactNode;
  /** Open the transactions behind the figure. Hidden while loading or unavailable. */
  drills?: readonly KpiDrill[];
  loading?: boolean;
  /** A lead tile's card colour, by its place among the frame's cards (Sait, 2026-10-19). */
  tone?: BreakdownTone;
  /** The query behind this figure failed — show a dash, never a misleading 0. */
  unavailable?: boolean;
  f: Formatters;
}

interface LeadVisuals {
  /** The figure's days, as a line under the value (a lead tile only). */
  spark?: SparkSeries | null;
  /** A small picture of the figure beside the value: a ring for a rate (a lead tile only). */
  aside?: ReactNode;
}

function useChange(delta: number | null | undefined, kind: DeltaKind | undefined, invert: boolean | undefined, neutral: boolean | undefined, f: Formatters): Change | null {
  const { tr } = useLocale();
  return describeChange(delta, { kind, invert, neutral }, { num: f.num, points: (n) => tr('ws.analytics.summary.points', { n }) });
}

/** "▲ +12% · was 540,000 IQD" — or just "was …", or nothing. */
function ChangeLine({ change, previous }: { change: Change | null; previous?: string | null }) {
  const { tr } = useLocale();
  if (!change && !previous) return null;
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
      {change && (
        <span
          dir="ltr"
          data-tone={change.tone}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--tp-sp-0)',
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            color: change.tone === 'neutral' ? 'var(--tp-muted-fg)' : MARK_FG[change.tone],
          }}
        >
          {change.direction !== 'flat' && <Icon name={change.direction === 'up' ? 'trendUp' : 'trendDown'} size={13} />}
          {change.text}
        </span>
      )}
      {change && previous && <span aria-hidden="true">·</span>}
      {previous && <bdi>{tr('ws.analytics.summary.was', { value: previous })}</bdi>}
    </span>
  );
}

/** A lead figure: a tile with a large value. */
export function Kpi({ label, value, delta, kind, invert, neutral, previous, note, tip, drills, loading, unavailable, tone, f, spark, aside }: FigureProps & LeadVisuals) {
  const { tr } = useLocale();
  const change = useChange(unavailable ? null : delta, kind, invert, neutral, f);
  const live = !loading && !unavailable;
  return (
    // With a tone the tile keeps its shape and takes a Breakdown card's
    // colours (wash, outline, one ink) from the class, so no inline ground.
    <div
      className={tone ? 'tp-breakdown-card' : undefined}
      data-tone={tone}
      style={{ ...card, ...(tone ? { background: undefined, border: undefined, overflow: 'hidden' } : null), minInlineSize: 0, display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-1)' }}
    >
      {/* With a tone the label row is the card colour's band, out to the
          tile's edges, like a Breakdown card's (Sait, 2026-10-19). */}
      <span
        className={tone ? 'tp-breakdown-head' : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--tp-sp-0)',
          minInlineSize: 0,
          ...(tone
            ? {
                justifyContent: 'space-between',
                marginInline: 'calc(-1 * var(--tp-sp-3))',
                marginBlockStart: 'calc(-1 * var(--tp-sp-3))',
                marginBlockEnd: 'var(--tp-sp-1)',
                paddingBlock: 'var(--tp-sp-2)',
                paddingInline: 'var(--tp-sp-3)',
                minBlockSize: '2.75rem',
              }
            : null),
        }}
      >
        <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: tone ? 'inherit' : 'var(--tp-muted-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {/* At the band's end with a tone, its icon on the tile's inset (Sait, 2026-10-19). */}
        {tip && (
          <InfoTip
            content={tip}
            label={tr('ws.analytics.tips.about', { title: label })}
            style={{ marginBlock: '-0.4rem', ...(tone ? { flexShrink: 0, marginInlineEnd: 'calc((14px - 1.85rem) / 2)' } : null) }}
          />
        )}
      </span>
      {loading ? (
        <Skeleton lines={1} blockSize="1.75rem" style={{ marginBlock: '0.2rem' }} />
      ) : (
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--tp-sp-2)', minInlineSize: 0 }}>
          <strong dir="auto" style={{ display: 'block', fontSize: 'var(--tp-fs-2xl)', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--tp-font-numeric)', minInlineSize: 0 }}>
            {unavailable ? '—' : value}
          </strong>
          {live && aside}
        </span>
      )}
      {live && spark && <Sparkline series={spark} label={tr(spark.byMonth ? 'ws.analytics.viz.byMonth' : 'ws.analytics.viz.byDay', { figure: label })} />}
      {live && <ChangeLine change={change} previous={previous} />}
      {live && note && <span style={{ display: 'block', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{note}</span>}
      {live && drills && drills.length > 0 && (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1)', marginBlockStart: 'auto', paddingBlockStart: 'var(--tp-sp-1)', marginInlineStart: 'calc(-1 * var(--tp-sp-2))' }}>
          {drills.map((d, i) => (
            <Button
              key={d.label ?? i}
              size="sm"
              kind="ghost"
              iconEnd="arrowUpRight"
              onClick={d.onOpen}
              aria-label={tr('ws.analytics.drill.openAria', { figure: d.label ?? label })}
            >
              {drills.length > 1 && d.label ? d.label : tr('ws.analytics.drill.open')}
            </Button>
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * A supporting figure, as a Breakdown row (Sait, 2026-10-19): label, its info
 * tip and its change at the start, the value at the end. A figure that opens
 * its transactions opens from anywhere on the row: the label is a button
 * stretched over the whole row (the info tip sits above it), so there is no
 * arrow on the row; the frame's note says the figures open.
 */
export function FigureLine({ label, value, delta, kind, invert, neutral, previous, note, tip, drills, loading, unavailable, f }: FigureProps) {
  const { tr } = useLocale();
  const change = useChange(unavailable ? null : delta, kind, invert, neutral, f);
  const live = !loading && !unavailable;
  const drill = live ? drills?.[0] : undefined;
  return (
    <div className="tp-row" data-clickable={drill ? 'true' : undefined} style={{ ...breakdownRowStyle, position: 'relative' }}>
      <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
          {drill ? (
            <button
              type="button"
              className="tp-breakdown-stretch"
              onClick={drill.onOpen}
              aria-label={tr('ws.analytics.drill.openAria', { figure: drill.label ?? label })}
              title={tr('ws.kit.drill.title')}
            >
              {label}
            </button>
          ) : (
            <span style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 500 }}>{label}</span>
          )}
          {tip && <InfoTip content={tip} label={tr('ws.analytics.tips.about', { title: label })} style={{ marginBlock: '-0.4rem', position: 'relative', zIndex: 1 }} />}
        </span>
        {live && <ChangeLine change={change} previous={previous} />}
        {live && note && <span style={{ fontSize: 'var(--tp-fs-xs)' }}>{note}</span>}
      </span>
      {loading ? (
        <Skeleton lines={1} blockSize="1.1rem" style={{ inlineSize: '5rem' }} />
      ) : (
        <strong dir="auto" style={{ fontSize: 'var(--tp-fs-xl)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--tp-font-numeric)', textAlign: 'end' }}>
          {unavailable ? '—' : value}
        </strong>
      )}
    </div>
  );
}

/** Every FigureLine among the children, fragments opened, so the card can cap and key them. */
function rowsOf(children: ReactNode): { key: string; node: ReactNode }[] {
  const out: { key: string; node: ReactNode }[] = [];
  const walk = (nodes: ReactNode, prefix: string) =>
    Children.toArray(nodes).forEach((child, i) => {
      if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) walk(child.props.children, `${prefix}${i}.`);
      else if (child) out.push({ key: `${prefix}${isValidElement(child) && child.key != null ? child.key : i}`, node: child });
    });
  walk(children, '');
  return out;
}

/**
 * A titled list of supporting figures, as a Breakdown card (Sait,
 * 2026-10-19): its colour band, outline and wash, three rows and "View more".
 * Inside a BreakdownFrame it takes the frame's shared tracks; `alone` for one
 * card set beside lead tiles.
 */
export function FigureGroup({ title, tone, alone, children }: { title: string; tone: BreakdownTone; alone?: boolean; children: ReactNode }) {
  return (
    <BreakdownCard tone={tone} title={title} alone={alone}>
      <BreakdownList rows={rowsOf(children)} />
    </BreakdownCard>
  );
}

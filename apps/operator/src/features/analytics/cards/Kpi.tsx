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
import type { ReactNode } from 'react';
import { Button, Skeleton, card } from '../../../components/ui';
import { InfoTip } from '../../../components/InfoTip';
import { Icon } from '../../../components/icons';
import { useLocale } from '../../../lib/i18n';
import { MARK_FG } from '../../ops/OpsVisuals';
import { describeChange, type Change, type DeltaKind } from '../change';
import type { Formatters } from '../format';

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
  /** The query behind this figure failed — show a dash, never a misleading 0. */
  unavailable?: boolean;
  f: Formatters;
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
export function Kpi({ label, value, delta, kind, invert, neutral, previous, note, tip, drills, loading, unavailable, f }: FigureProps) {
  const { tr } = useLocale();
  const change = useChange(unavailable ? null : delta, kind, invert, neutral, f);
  const live = !loading && !unavailable;
  return (
    <div style={{ ...card, minInlineSize: 0, display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-1)' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
        <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-muted-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {tip && <InfoTip content={tip} label={tr('ws.analytics.tips.about', { title: label })} style={{ marginBlock: '-0.4rem' }} />}
      </span>
      {loading ? (
        <Skeleton lines={1} blockSize="1.75rem" style={{ marginBlock: '0.2rem' }} />
      ) : (
        <strong dir="auto" style={{ display: 'block', fontSize: 'var(--tp-fs-2xl)', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--tp-font-numeric)' }}>
          {unavailable ? '—' : value}
        </strong>
      )}
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
 * A supporting figure: label (and its change) at the start, the value at the
 * end, and an icon button into the transactions when there are any. Rows
 * without a drill keep the button's width so every value ends on one edge.
 */
export function FigureLine({ label, value, delta, kind, invert, neutral, previous, note, tip, drills, loading, unavailable, f }: FigureProps) {
  const { tr } = useLocale();
  const change = useChange(unavailable ? null : delta, kind, invert, neutral, f);
  const live = !loading && !unavailable;
  const drill = live ? drills?.[0] : undefined;
  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto 2rem',
        alignItems: 'center',
        columnGap: 'var(--tp-sp-2)',
        paddingBlock: 'var(--tp-sp-2)',
        borderBlockEnd: '1px solid var(--tp-border)',
      }}
    >
      <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontWeight: 600 }}>{label}</span>
          {tip && <InfoTip content={tip} label={tr('ws.analytics.tips.about', { title: label })} style={{ marginBlock: '-0.4rem' }} />}
        </span>
        {live && <ChangeLine change={change} previous={previous} />}
        {live && note && <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{note}</span>}
      </span>
      {loading ? (
        <Skeleton lines={1} blockSize="1.1rem" style={{ inlineSize: '5rem' }} />
      ) : (
        <strong dir="auto" style={{ fontSize: 'var(--tp-fs-lg)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--tp-font-numeric)', textAlign: 'end' }}>
          {unavailable ? '—' : value}
        </strong>
      )}
      {drill ? (
        <Button size="sm" kind="ghost" icon="arrowUpRight" onClick={drill.onOpen} aria-label={tr('ws.analytics.drill.openAria', { figure: drill.label ?? label })} />
      ) : (
        <span aria-hidden="true" />
      )}
    </li>
  );
}

/** A titled list of supporting figures (the panel's figure-row look). */
export function FigureGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ ...card, minInlineSize: 0 }}>
      <h3 style={{ margin: 0, fontSize: 'var(--tp-fs-md)', fontWeight: 700 }}>{title}</h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{children}</ul>
    </section>
  );
}

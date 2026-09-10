/**
 * The marks the operations overview draws (spec 06.21).
 *
 * Hand-rolled rather than recharts. These are inline meters a few pixels tall
 * inside a panel, not plots: recharts would pull a chart runtime into the /ops
 * chunk to draw a dozen rectangles, and it cannot read the `--tp-*` custom
 * properties at all — which is why `features/analytics/charts/colors.ts` has to
 * mirror every operator token as a hand-typed literal and carries a comment
 * begging the next editor to keep the two in sync. Divs read the tokens
 * directly, so these marks cannot drift from the palette.
 *
 * Four rules the marks follow, and why each one is here:
 *
 *  - **Every value is also printed as text beside its mark.** Nothing is encoded
 *    by colour or length alone (DESIGN.md: "Status is never carried by colour
 *    alone"), so the bars themselves are `aria-hidden` — a screen reader reads
 *    the figures from the legend rather than a prose description of a picture,
 *    and no value is gated behind seeing the chart.
 *  - **Fills take the `-mark` rungs (~58% lightness), never the `-fill` rungs.**
 *    DESIGN.md is explicit: a 7px dot drawn in `--tp-success` measures 1.78:1 on
 *    operator paper and is simply not there. `-mark` is the rung that exists for
 *    dots, small icons and 2px rules, and a 10px bar is in that company.
 *  - **A 2px gap, never a border, separates touching fills.** A stroke around a
 *    mark adds ink that isn't data; the gap is the mechanism.
 *  - **Nothing here transitions.** The figures move when the 30 s poll returns,
 *    and animating that would break the motion rule twice over: `inline-size`
 *    is a layout property, and a poll landing is not something the operator's
 *    finger caused — but it also isn't worth the frame, because a bar that
 *    slides every 30 s while a manager is reading it is just noise.
 */
import type { ReactNode } from 'react';
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Icon, type IconName } from '../../components/icons';

/** The severities these marks can wear. A subset of the kit's `Tone`. */
export type MarkTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger';

/** Fill colours — the `-mark` rungs, for the reason in the file header. */
export const MARK: Record<MarkTone, string> = {
  // A step lighter than --tp-neutral-mark. Drawn at full strength, the benign
  // row ("tickets waiting") was the heaviest ink in its own panel, out-weighing
  // the amber and red rows beside it — the opposite of what the colour says.
  neutral: 'color-mix(in oklab, var(--tp-neutral-mark) 62%, var(--tp-surface-2))',
  accent: 'var(--tp-accent)',
  success: 'var(--tp-success-mark)',
  warn: 'var(--tp-warn-mark)',
  danger: 'var(--tp-danger-mark)',
};

/** Text colours. Ink tokens, never a fill — a label never wears the data colour. */
export const MARK_FG: Record<MarkTone, string> = {
  neutral: 'var(--tp-muted-fg)',
  accent: 'var(--tp-accent-soft-fg)',
  success: 'var(--tp-success-fg)',
  warn: 'var(--tp-warn-fg)',
  danger: 'var(--tp-danger-fg)',
};

/** Soft grounds, for the one band that wears its severity as a surface. */
export const MARK_SOFT: Record<MarkTone, string> = {
  neutral: 'var(--tp-neutral-soft)',
  accent: 'var(--tp-accent-soft)',
  success: 'var(--tp-success-soft)',
  warn: 'var(--tp-warn-soft)',
  danger: 'var(--tp-danger-soft)',
};

/**
 * A lighter step of a ramp, mixed from the tokens rather than typed as a sixth
 * colour. A meter's unfilled track has to be a lighter step of the FILL's own
 * hue so the state reads across the whole bar; `--tp-surface-2` alone makes the
 * track read as an absence rather than as the rest of the same measure.
 */
function trackFor(fill: string): string {
  return `color-mix(in oklab, ${fill} 20%, var(--tp-surface-2))`;
}

/** 10px: a thin mark. The mark spec caps a bar at 24px and means it. */
const METER_BLOCK = '0.625rem';
/** 6px for the ladder rows, which are stacked four deep and want less weight. */
const BAR_BLOCK = '0.375rem';

/**
 * A fill shorter than this reads as an empty track, so a count of 1 beside a
 * max of 400 would look like nothing at all. The exact figure is printed next
 * to every bar, so the floor cannot cause a value to be misread — it only stops
 * "some" from rendering as "none".
 */
const MIN_FILL = '3px';

/**
 * ONE value against a stated limit — the only honest bar-with-a-denominator on
 * this screen.
 *
 * THERE IS NO STACKED PART-TO-WHOLE BAR HERE, and that is a finding about the
 * data rather than a matter of taste. Two of the 0068 groupings look like
 * partitions and are not:
 *
 *   - `bookings.today` counts `confirmed | arrived | completed`, so `noShows`
 *     is NOT inside it and `completed` is in none of `arrived` / `upcoming` /
 *     `noShows`. Stacking those three against `today` invents a whole.
 *   - `cafe.ticketsLate` counts tickets whose status is ALREADY `queued` or
 *     `preparing` and which are past target, so late is a SUBSET of the other
 *     two, not a third slice. On the local fixtures that is 470 + 3 = 473 =
 *     late; a stacked bar would have drawn 946 tickets where 473 exist.
 *
 * `arrived` and `upcoming` are genuine subsets of `today`, so a single one of
 * them against `today` is a real ratio and gets this meter. Everything else on
 * the screen is a set of independent counts and gets `SeverityLadder`, which
 * ranks without implying that the rows add up to anything.
 */
export function RatioMeter({
  label,
  value,
  limit,
  limitLabel,
  tone = 'success',
}: {
  label: string;
  value: number;
  /** The denominator, as a server figure. A zero limit draws an empty track. */
  limit: number;
  /** How to say the limit, e.g. "of 12". */
  limitLabel: string;
  tone?: MarkTone;
}) {
  const { locale } = useLocale();
  const fill = MARK[tone];
  const pct = limit > 0 ? Math.max(0, Math.min(1, value / limit)) * 100 : 0;
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--tp-sp-2)',
          marginBlockEnd: 'var(--tp-sp-1-5)',
        }}
      >
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{label}</span>
        <span style={{ marginInlineStart: 'auto', fontVariantNumeric: 'tabular-nums' }}>
          <strong>{formatNumber(value, locale)}</strong>
          <span style={{ color: 'var(--tp-muted-fg)' }}> {limitLabel}</span>
        </span>
      </div>
      <div
        aria-hidden="true"
        style={{
          blockSize: METER_BLOCK,
          background: trackFor(fill),
          borderRadius: 'var(--tp-radius-sm)',
          overflow: 'hidden',
        }}
      >
        {pct > 0 && (
          <div
            style={{
              inlineSize: `${pct}%`,
              minInlineSize: MIN_FILL,
              blockSize: '100%',
              background: fill,
              borderStartEndRadius: 'var(--tp-radius-sm)',
              borderEndEndRadius: 'var(--tp-radius-sm)',
            }}
          />
        )}
      </div>
    </div>
  );
}

/** The track + fill both the ladder and the drill list draw. */
function Bar({
  fraction,
  tone,
  block = BAR_BLOCK,
}: {
  fraction: number;
  tone: MarkTone;
  block?: string;
}) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div
      aria-hidden="true"
      style={{
        blockSize: block,
        background: 'var(--tp-surface-2)',
        borderRadius: 'var(--tp-radius-sm)',
        overflow: 'hidden',
      }}
    >
      {pct > 0 && (
        <div
          style={{
            inlineSize: `${pct}%`,
            minInlineSize: MIN_FILL,
            blockSize: '100%',
            background: MARK[tone],
            // Square where it grows from, rounded at the data end. Logical, so
            // it rounds the correct corners under Arabic.
            borderStartEndRadius: 'var(--tp-radius-sm)',
            borderEndEndRadius: 'var(--tp-radius-sm)',
          }}
        />
      )}
    </div>
  );
}

export interface LadderRow {
  key: string;
  label: string;
  /** `null` when the server does not report it — prints "—" and draws no bar. */
  value: number | null;
  /** The severity this STATE carries. Length carries the count; colour the state. */
  tone: MarkTone;
}

/**
 * Independent counts, ranked against the largest of them.
 *
 * Two encodings doing two different jobs: bar length is magnitude, fill colour
 * is the state's own severity. These are deliberately NOT a part-to-whole —
 * a stock item can be both low and below par, and a late ticket is also a
 * queued one — so each row gets its own bar and the rows are never stacked or
 * totalled. Ranking against the largest ROW rather than against some outside
 * total is the point: it compares the rows to each other without asserting that
 * they sum to anything.
 *
 * The row order is FIXED and does not sort by value. A manager reads this panel
 * every thirty seconds; a ladder that reshuffles as the counts move costs more
 * to re-read than the ranking saves. A zero row keeps its place, drops its
 * colour entirely and shows an empty track, so colour appears on this panel
 * only where there is actually something to do.
 */
export function SeverityLadder({
  rows,
  caption,
}: {
  rows: readonly LadderRow[];
  caption?: string;
}) {
  const { locale } = useLocale();
  const max = rows.reduce((m, r) => Math.max(m, r.value ?? 0), 0);
  return (
    <div>
      {caption && (
        <p
          style={{
            fontSize: 'var(--tp-fs-sm)',
            color: 'var(--tp-muted-fg)',
            fontWeight: 600,
            marginBlockEnd: 'var(--tp-sp-2)',
          }}
        >
          {caption}
        </p>
      )}
      <dl style={{ margin: 0, display: 'grid', gap: 'var(--tp-sp-2-5)' }}>
        {rows.map((r) => {
          const clear = r.value === null || r.value === 0;
          return (
            <div key={r.key} style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--tp-sp-2)' }}>
                <dt
                  style={{
                    fontSize: 'var(--tp-fs-sm)',
                    color: 'var(--tp-muted-fg)',
                    minInlineSize: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.label}
                </dt>
                <dd
                  style={{
                    margin: 0,
                    marginInlineStart: 'auto',
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    color: clear ? 'var(--tp-muted-fg)' : MARK_FG[r.tone],
                  }}
                >
                  {r.value === null ? '—' : formatNumber(r.value, locale)}
                </dd>
              </div>
              <Bar fraction={clear || max === 0 ? 0 : (r.value ?? 0) / max} tone={r.tone} />
            </div>
          );
        })}
      </dl>
    </div>
  );
}

export interface DrillBarRow<K extends string = string> {
  key: K;
  label: string;
  /** The figure as the manager should read it — money where the server sends money. */
  value: ReactNode;
  /** The secondary line (a count beneath an amount). */
  hint?: string;
  /** 0..1 against the largest row. */
  fraction: number;
  title: string;
}

/**
 * Same-unit magnitudes that each open the list behind them.
 *
 * One hue for every bar, because the only thing separating these rows is *how
 * much* — the sequential job. The old screen toned voids and refunds amber,
 * which said "alarm" about a figure a manager reviews at day close rather than
 * acts on now; anything that genuinely needs acting on now is in the attention
 * band at the top of the page instead.
 *
 * The bar sits on its own line under the label rather than in a third column,
 * so every bar starts at the same edge and runs the same length whatever the
 * label's language does — which is the whole point of drawing them.
 *
 * The list is its own responsive grid rather than sitting inside one, because a
 * single <ul> inside a grid is a single grid item: the columns did nothing and
 * four bars ran the full width of the page. Equal-width cells keep every track
 * the same length, which is what makes the lengths comparable at all.
 */
export function DrillBarList<K extends string>({
  rows,
  onDrill,
  minColumn = '13rem',
}: {
  rows: readonly DrillBarRow<K>[];
  onDrill: (key: K) => void;
  minColumn?: string;
}) {
  return (
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'grid',
        gap: 'var(--tp-sp-2)',
        gridTemplateColumns: `repeat(auto-fit, minmax(${minColumn}, 1fr))`,
        alignItems: 'start',
      }}
    >
      {rows.map((r) => (
        <li key={r.key}>
          <button
            type="button"
            className="tp-tile"
            title={r.title}
            onClick={() => onDrill(r.key)}
            style={{
              inlineSize: '100%',
              display: 'grid',
              gap: 'var(--tp-sp-1-5)',
              background: 'transparent',
              border: '1px solid transparent',
              borderRadius: 'var(--tp-radius-ctl)',
              paddingBlock: 'var(--tp-sp-2)',
              paddingInline: 'var(--tp-sp-2)',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--tp-sp-2)' }}>
              <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                {r.label}
              </span>
              <span
                style={{
                  marginInlineStart: 'auto',
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {r.value}
              </span>
            </span>
            <Bar fraction={r.fraction} tone="accent" />
            {r.hint && (
              <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                {r.hint}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

export interface GateRow {
  key: string;
  label: string;
  /** A server count. Zero is the only clear state. */
  count: number;
  /** What to call zero — reusing the kit's "None" rather than a bare 0. */
  clearLabel: string;
  tone: MarkTone;
}

/**
 * Day close is a gate, not a magnitude, so it gets a checklist and no bars.
 * Each row says which condition it is and whether it is met; a met condition
 * wears the success tick, an unmet one wears its own severity and the count
 * standing in the way.
 */
export function GateList({ gates }: { gates: readonly GateRow[] }) {
  const { locale } = useLocale();
  return (
    <ul
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}
    >
      {gates.map((g) => {
        const clear = g.count === 0;
        const tone: MarkTone = clear ? 'success' : g.tone;
        const icon: IconName = clear ? 'checkCircle' : 'alert';
        return (
          <li
            key={g.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--tp-sp-2)',
              fontSize: 'var(--tp-fs-sm)',
            }}
          >
            <Icon name={icon} size={15} style={{ color: MARK[tone], flex: '0 0 auto' }} />
            <span style={{ color: 'var(--tp-muted-fg)', minInlineSize: 0 }}>{g.label}</span>
            <span
              style={{
                marginInlineStart: 'auto',
                fontWeight: 700,
                color: MARK_FG[tone],
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {clear ? g.clearLabel : formatNumber(g.count, locale)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A cluster's single promoted number.
 *
 * Deliberately not `HeadlineFigure`: that component brings the `card` surface
 * with it, and inside a Panel it drew a tile within a tile. Here the Panel is
 * the container and this is just the largest text in it — which is the whole
 * mechanism by which a cluster has a lead rather than five equals.
 */
export function LeadFigure({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  tone?: MarkTone;
}) {
  return (
    <div>
      <div style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontWeight: 600 }}>
        {label}
      </div>
      <div
        style={{
          // 2xl, not 3xl: four of these must out-weigh everything inside their
          // own panel without out-weighing the page's own h1, which is 2xl too.
          fontSize: 'var(--tp-fs-2xl)',
          fontWeight: 700,
          lineHeight: 1.1,
          fontVariantNumeric: 'tabular-nums',
          color: tone === 'neutral' ? 'var(--tp-fg)' : MARK_FG[tone],
          marginBlockStart: 'var(--tp-sp-0)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

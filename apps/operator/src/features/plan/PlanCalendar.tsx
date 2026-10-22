/**
 * The month as a calendar of ideas (0362). Each day is a button that opens it
 * beside the calendar; inside, up to three ideas by title with a mark for
 * where each stands, then "+N more". A hollow ring is an idea the owner has
 * not decided yet, a filled dot one that was approved (its colour says what
 * its result needs), and a struck-through title one that was left out or
 * taken off. Days before today are greyed: nothing new can be planned there.
 *
 * Days of the neighbouring months fill the rectangle but are blank and not
 * buttons: the plan is one month.
 */
import { formatDate, formatDayNumber, formatMonthYear, formatNumber, formatWeekdayShort } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { monthWeeks } from '../desk/calendar/monthLogic';
import { STAGE_TONE, ideaStage, type IdeaStage, type PlanIdea } from './planLogic';
import type { Tone } from '../../components/kit';

/** The dot or ring of a stage, at mark strength so a 7px shape reads on paper and on blue. */
const MARK: Readonly<Record<Tone, string>> = {
  neutral: 'var(--tp-neutral-mark)',
  accent: 'var(--tp-accent)',
  info: 'var(--tp-accent)',
  success: 'var(--tp-success-mark)',
  live: 'var(--tp-success-mark)',
  warn: 'var(--tp-warn-mark)',
  danger: 'var(--tp-danger-mark)',
};

/** Shown in a day before "+N more". */
const PER_DAY = 3;

const noon = (iso: string) => new Date(`${iso}T12:00:00Z`);

export function StageMark({ stage }: { stage: IdeaStage }) {
  const colour = MARK[STAGE_TONE[stage]];
  const hollow = stage === 'proposed';
  const gone = stage === 'dropped' || stage === 'cancelled';
  return (
    <span
      aria-hidden="true"
      style={{
        flex: '0 0 auto',
        inlineSize: '0.5rem',
        blockSize: '0.5rem',
        borderRadius: '50%',
        background: hollow || gone ? 'transparent' : colour,
        border: `1.5px solid ${colour}`,
        opacity: gone ? 0.6 : 1,
      }}
    />
  );
}

export function PlanCalendar({
  month,
  today,
  byDay,
  selected,
  leftOut,
  onPick,
}: {
  /** 'YYYY-MM-01'. */
  month: string;
  today: string;
  byDay: ReadonlyMap<string, readonly PlanIdea[]>;
  selected: string | null;
  /** Ideas the owner has marked to leave out, not sent yet. */
  leftOut: ReadonlySet<string>;
  onPick: (day: string) => void;
}) {
  const { tr, locale } = useLocale();
  const ym = month.slice(0, 7);
  const weeks = monthWeeks(month);

  return (
    <div role="grid" aria-label={formatMonthYear(noon(month), locale, 'UTC')} style={{ display: 'grid', gap: 'var(--tp-sp-1)' }} data-testid="plan.calendar">
      <div role="row" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 'var(--tp-sp-1)' }}>
        {weeks[0]!.map((d) => (
          <div key={d} role="columnheader" style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 600, color: 'var(--tp-muted-fg)', textAlign: 'center', paddingBlock: 'var(--tp-sp-1)' }}>
            {formatWeekdayShort(noon(d), locale, 'UTC')}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]} role="row" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 'var(--tp-sp-1)' }}>
          {week.map((d) => {
            if (!d.startsWith(ym)) return <div key={d} role="gridcell" aria-hidden="true" />;
            const ideas = byDay.get(d) ?? [];
            const past = d < today;
            const isSelected = d === selected;
            const shown = ideas.slice(0, PER_DAY);
            const spoken = `${formatDate(noon(d), locale, 'UTC')} · ${ideas.length === 0 ? tr('ws.plan.day.nothing') : ideas.map((i) => i.title).join(', ')}`;
            return (
              <button
                key={d}
                type="button"
                role="gridcell"
                aria-selected={isSelected}
                aria-label={spoken}
                onClick={() => onPick(d)}
                data-testid={`plan.day.${d}`}
                className="tp-tile"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  gap: 'var(--tp-sp-1)',
                  minBlockSize: '6.75rem',
                  minInlineSize: 0,
                  padding: 'var(--tp-sp-2)',
                  font: 'inherit',
                  textAlign: 'start',
                  cursor: 'pointer',
                  borderRadius: 'var(--tp-radius-ctl)',
                  border: '1px solid var(--tp-border)',
                  background: past ? 'var(--tp-surface-2)' : 'var(--tp-surface)',
                  color: 'var(--tp-fg)',
                  outline: isSelected ? '2px solid var(--tp-accent)' : undefined,
                  outlineOffset: isSelected ? '-2px' : undefined,
                }}
              >
                <span
                  style={{
                    alignSelf: 'flex-start',
                    fontWeight: d === today ? 800 : 600,
                    fontVariantNumeric: 'tabular-nums',
                    color: past ? 'var(--tp-muted-fg)' : undefined,
                    ...(d === today
                      ? { display: 'inline-grid', placeItems: 'center', minInlineSize: '1.6rem', blockSize: '1.6rem', borderRadius: '999px', background: 'var(--tp-fg)', color: 'var(--tp-bg)' }
                      : null),
                  }}
                >
                  {formatDayNumber(noon(d), locale, 'UTC')}
                </span>
                {shown.map((i) => {
                  const stage = leftOut.has(i.id) ? 'dropped' : ideaStage(i, today);
                  const gone = stage === 'dropped' || stage === 'cancelled';
                  return (
                    <span key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1)', minInlineSize: 0, fontSize: 'var(--tp-fs-xs)', lineHeight: 1.3 }}>
                      <StageMark stage={stage} />
                      <bdi
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontWeight: stage === 'proposed' ? 600 : 500,
                          textDecoration: gone ? 'line-through' : undefined,
                          color: gone ? 'var(--tp-muted-fg)' : undefined,
                        }}
                      >
                        {i.title}
                      </bdi>
                    </span>
                  );
                })}
                {ideas.length > PER_DAY && (
                  <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                    {tr('ws.plan.day.more', { count: formatNumber(ideas.length - PER_DAY, locale) })}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * The content plan at a glance (0362; Majed: "the owner has a clear panel to
 * view what the content plan is and what it contains in detail").
 *
 * `StageCounts` is one line of counts, one per stage that holds any idea, so
 * a month reads as "3 new · 8 to make · 1 late · 2 done" before any idea is
 * opened. `PlanSummaryPanel` sits on the owner's Marketing page under the
 * posts to approve: this month's plan by status and counts, a plan waiting on
 * the owner named first, and the ideas of the coming week in full (day, type,
 * channel, title, the explanation and where each stands). "Open the plan"
 * goes to the whole month as a list.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { QK } from '../../lib/queryKeys';
import { Button, ErrorText, Skeleton } from '../../components/ui';
import { MessagePresenter, Panel, StatusBadge, type Tone } from '../../components/kit';
import { CardTitle } from '../ops/OpsVisuals';
import { monthLabel } from '../deductions/venueDate';
import { shiftIsoDate } from '../desk/weekLogic';
import { fetchPlan } from './api';
import { StageMark } from './PlanCalendar';
import { IdeaList, type PlanActions } from './IdeaParts';
import { ideaStage, monthKey, readPlan, type IdeaStage, type MonthPlan, type PlanStatus } from './planLogic';

/** The order a month is read in: what needs a decision, what needs making, what is out, what is done. */
const STAGE_ORDER: readonly IdeaStage[] = ['proposed', 'late', 'changes', 'declined', 'toMake', 'sent', 'done', 'dropped', 'cancelled'];
const STATUS_TONE: Readonly<Record<PlanStatus | 'none', Tone>> = { none: 'neutral', draft: 'neutral', waiting: 'info', changes: 'warn', approved: 'success' };
/** The coming days shown in full on the panel. */
const AHEAD_DAYS = 7;

export function stageCounts(plan: MonthPlan): { stage: IdeaStage; count: number }[] {
  const counts = new Map<IdeaStage, number>();
  for (const i of plan.ideas) {
    const s = ideaStage(i, plan.today);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return STAGE_ORDER.filter((s) => counts.has(s)).map((stage) => ({ stage, count: counts.get(stage)! }));
}

export function StageCounts({ plan }: { plan: MonthPlan }) {
  const { tr, locale } = useLocale();
  const rows = stageCounts(plan);
  if (rows.length === 0) return null;
  return (
    <ul aria-label={tr('ws.plan.summary.counts')} style={{ display: 'flex', gap: 'var(--tp-sp-4)', flexWrap: 'wrap', listStyle: 'none', margin: 0, padding: 0 }} data-testid="plan.counts">
      {rows.map(({ stage, count }) => (
        <li key={stage} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
          <StageMark stage={stage} />
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatNumber(count, locale)}</strong>
          <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr(`ws.plan.stage.${stage}`)}</span>
        </li>
      ))}
    </ul>
  );
}

export function PlanSummaryPanel() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: QK.planNow, queryFn: () => fetchPlan(null), refetchInterval: 60_000 });
  const plan = q.data !== undefined ? readPlan(q.data) : null;
  const open = (month?: string) => void navigate({ to: '/plan', search: { ...(month ? { month: monthKey(month) } : null), view: 'list' } as never });

  let body;
  if (q.isError && !plan) {
    body = (
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start', padding: 'var(--tp-sp-3)' }}>
        <ErrorText error={q.error} style={{ marginBlock: 0 }} />
        <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
          {tr('common.retry')}
        </Button>
      </div>
    );
  } else if (!plan) {
    body = (
      <div style={{ padding: 'var(--tp-sp-3)' }}>
        <Skeleton lines={4} />
      </div>
    );
  } else {
    // A payload with no business date (an older server, a failed read) shows no coming days.
    const soon = plan.today ? shiftIsoDate(plan.today, AHEAD_DAYS) : '';
    const ahead = plan.ideas.filter((i) => i.day >= plan.today && i.day < soon && (i.status === 'approved' || i.status === 'proposed'));
    // Read-only here: deciding and leaving out happen on the plan itself.
    const actions: PlanActions = {
      plan: { ...plan, canDecide: false, canEdit: false },
      writer: false,
      deciding: false,
      leftOut: new Set(),
      toggleLeftOut: () => undefined,
      onEdit: () => undefined,
      onSendResult: () => undefined,
      onOpenResult: () => void navigate({ to: '/marketing' }),
    };
    body = (
      <>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', padding: 'var(--tp-sp-3)' }}>
          {plan.waitingMonths.map((m) => (
            <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
              <MessagePresenter tone="info" message={tr('ws.plan.summary.waiting', { month: monthLabel(m, locale) })} style={{ flex: '1 1 18rem' }} />
              <Button size="sm" kind="primary" iconEnd="arrowEnd" onClick={() => open(m)} data-testid="plan.summary.review">
                {tr('ws.plan.needs.action')}
              </Button>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
            <strong>{monthLabel(plan.month, locale)}</strong>
            <StatusBadge size="sm" tone={STATUS_TONE[plan.plan?.status ?? 'none']} label={tr(plan.plan?.status === 'waiting' ? 'ws.plan.status.waitingYou' : `ws.plan.status.${plan.plan?.status ?? 'none'}`)} />
          </div>
          {plan.ideas.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr('ws.plan.lead.owner.none')}</p>
          ) : (
            <StageCounts plan={plan} />
          )}
        </div>
        {plan.ideas.length > 0 && (
          <div style={{ borderBlockStart: '1px solid var(--tp-border)' }}>
            <h3 style={{ margin: 0, paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', background: 'var(--tp-surface-2)', fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>
              {tr('ws.plan.summary.coming', { count: formatNumber(AHEAD_DAYS, locale) })}
            </h3>
            {ahead.length > 0 ? (
              <IdeaList ideas={ahead} actions={actions} withDays />
            ) : (
              <p style={{ margin: 0, padding: 'var(--tp-sp-3)', color: 'var(--tp-muted-fg)' }}>{tr('ws.plan.summary.nothingComing')}</p>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <Panel
      title={<CardTitle icon="calendar">{tr('ws.plan.title')}</CardTitle>}
      actions={
        <Button size="sm" iconEnd="arrowEnd" onClick={() => open()} data-testid="plan.summary.open">
          {tr('ws.plan.summary.open')}
        </Button>
      }
      padded={false}
      data-testid="plan.summary"
    >
      {body}
    </Panel>
  );
}

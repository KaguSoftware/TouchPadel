/**
 * The content plan (0362, Majed 2026-10-22): marketing's month of content on
 * one page, and the owner's approval of it.
 *
 * Marketing comes out of the month's meeting and writes it here: a day, a
 * title, what kind of thing and where it goes, and the idea itself; a weekly
 * idea goes on every week in one go. "Send plan to the owner" sends the new
 * ideas. The owner reads them (the list is their default while deciding),
 * leaves out any they do not want, and approves the plan or sends it back with
 * a note; marketing gets a push either way. Then each approved idea waits for
 * its result: marketing presses "Send result" on it, and what they send is an
 * ordinary post for approval (0199), with a Google Drive link for anything
 * that is not an image.
 *
 * One bar under the title says where the month stands and holds the one
 * action that moves it on. The calendar is the plan; the day beside it is
 * where ideas are read, written and acted on. Nothing here is a dialog but the
 * remove confirmation.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { formatDate, formatNumber, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { can, useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { QK } from '../../lib/queryKeys';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Skeleton, inputStyle } from '../../components/ui';
import { MessagePresenter, PageHeader, Panel, SegmentedControl, StatusBadge, type Tone } from '../../components/kit';
import { monthLabel } from '../deductions/venueDate';
import { shiftMonth } from '../desk/calendar/monthLogic';
import { ContentForm } from '../content/ContentForm';
import { EMPTY_DRAFT } from '../content/contentLogic';
import { PK, fetchPlan, refreshPlan } from './api';
import { PlanCalendar, StageMark } from './PlanCalendar';
import { IdeaForm, IdeaList, MonthList, longDay, type PlanActions } from './IdeaParts';
import { StageCounts } from './PlanSummary';
import {
  PLAN_NOTE_MAX,
  ideasByDay,
  madeCount,
  monthFirst,
  monthKey,
  proposedIdeas,
  readPlan,
  resultDay,
  type IdeaStage,
  type MonthPlan,
  type PlanIdea,
  type PlanStatus,
} from './planLogic';
import type { PlanSearch, PlanView } from './search';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;
const STATUS_TONE: Readonly<Record<PlanStatus | 'none', Tone>> = { none: 'neutral', draft: 'neutral', waiting: 'info', changes: 'warn', approved: 'success' };
/** The stages the legend explains, in the order an idea moves through them. */
const LEGEND: readonly IdeaStage[] = ['proposed', 'toMake', 'late', 'sent', 'changes', 'done', 'dropped'];

type Panelled = { kind: 'idea'; day: string; idea: PlanIdea | null } | { kind: 'result'; idea: PlanIdea } | null;

export function PlanScreen() {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const writer = can(staff, 'editPlan');
  const owner = can(staff, 'decidePlan');
  const search = useSearch({ strict: false }) as PlanSearch;
  const navigate = useNavigate();
  const setSearch = (next: PlanSearch, replace = false) => void navigate({ to: '/plan', search: next as never, replace });

  const month = search.month ? monthFirst(search.month) : null;
  const q = useQuery({ queryKey: month ? PK.month(month) : QK.planNow, queryFn: () => fetchPlan(month), refetchInterval: 60_000 });
  const plan = useMemo(() => (q.data !== undefined ? readPlan(q.data) : null), [q.data]);

  // The owner opens on the oldest month waiting on them.
  const firstWaiting = plan?.waitingMonths[0];
  useEffect(() => {
    if (owner && !search.month && plan && !plan.canDecide && firstWaiting) setSearch({ month: monthKey(firstWaiting) }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, search.month, plan?.canDecide, firstWaiting]);

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', alignContent: 'start' }}>
      <PageHeader
        title={tr('ws.plan.title')}
        titleAfter={plan && <StatusBadge tone={STATUS_TONE[plan.plan?.status ?? 'none']} label={statusLabel(tr, plan, owner)} />}
        actions={plan && <MonthStepper plan={plan} onMonth={(m) => setSearch({ month: monthKey(m), view: search.view })} />}
        style={{ marginBlockEnd: 0 }}
      />
      {q.isError && q.data === undefined ? (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
          <ErrorText error={q.error} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
            {tr('common.retry')}
          </Button>
        </div>
      ) : !plan ? (
        <Skeleton lines={8} />
      ) : (
        // Keyed on the plan's state: a decision or a send starts the owner's
        // left-out picks and note afresh.
        <PlanBody key={`${plan.month}:${plan.plan?.id ?? ''}:${plan.plan?.status ?? ''}`} plan={plan} writer={writer} owner={owner} search={search} setSearch={setSearch} />
      )}
    </div>
  );
}

/** The plan's state in a word; the owner reads a plan waiting on them as "Waiting for you". */
export function statusLabel(tr: ReturnType<typeof useLocale>['tr'], plan: MonthPlan, owner: boolean): string {
  const status = plan.plan?.status ?? 'none';
  return tr(owner && status === 'waiting' ? 'ws.plan.status.waitingYou' : `ws.plan.status.${status}`);
}

function MonthStepper({ plan, onMonth }: { plan: MonthPlan; onMonth: (month: string) => void }) {
  const { tr, locale } = useLocale();
  const current = monthFirst(plan.today);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}>
      {plan.month !== current && (
        <Button size="sm" kind="ghost" onClick={() => onMonth(current)}>
          {tr('ws.plan.month.thisMonth')}
        </Button>
      )}
      <Button size="sm" kind="ghost" icon="chevronStart" aria-label={tr('ws.plan.month.prev')} onClick={() => onMonth(shiftMonth(plan.month, -1))} data-testid="plan.month.prev" />
      <strong style={{ minInlineSize: '9rem', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }} data-testid="plan.month">
        {monthLabel(plan.month, locale)}
      </strong>
      <Button size="sm" kind="ghost" icon="chevronEnd" aria-label={tr('ws.plan.month.next')} onClick={() => onMonth(shiftMonth(plan.month, 1))} data-testid="plan.month.next" />
    </div>
  );
}

function PlanBody({
  plan,
  writer,
  owner,
  search,
  setSearch,
}: {
  plan: MonthPlan;
  writer: boolean;
  owner: boolean;
  search: PlanSearch;
  setSearch: (next: PlanSearch, replace?: boolean) => void;
}) {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const [leftOut, setLeftOut] = useState<ReadonlySet<string>>(new Set());
  const [panelled, setPanelled] = useState<Panelled>(null);

  const byDay = useMemo(() => ideasByDay(plan.ideas), [plan.ideas]);
  const inMonth = plan.today.startsWith(plan.month.slice(0, 7));
  const day = search.day ?? (inMonth ? plan.today : plan.month);
  // The owner reads the month in full, as a list; marketing plans it on the calendar.
  const view: PlanView = search.view ?? (owner ? 'list' : 'calendar');
  const keep = { month: monthKey(plan.month) };

  const actions: PlanActions = {
    plan,
    writer,
    deciding: plan.canDecide,
    leftOut,
    toggleLeftOut: (id) =>
      setLeftOut((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    onEdit: (idea) => {
      setSearch({ ...keep, day: idea.day, view: 'calendar' });
      setPanelled({ kind: 'idea', day: idea.day, idea });
    },
    onSendResult: (idea) => {
      setSearch({ ...keep, day: idea.day, view: 'calendar' });
      setPanelled({ kind: 'result', idea });
    },
    onOpenResult: (idea) => {
      if (!idea.result) return;
      if (writer) void navigate({ to: '/posts', search: { open: idea.result.id } as never });
      else void navigate({ to: '/marketing' });
    },
  };
  const pickDay = (d: string) => {
    setSearch({ ...keep, day: d, view: 'calendar' });
    setPanelled(null);
  };

  const others = owner ? plan.waitingMonths.filter((m) => m !== plan.month) : [];

  return (
    <>
      <PlanBar plan={plan} writer={writer} owner={owner} />
      <StageCounts plan={plan} />
      {plan.canDecide && <DecisionBar plan={plan} leftOut={leftOut} />}
      {others.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
          <MessagePresenter tone="info" message={tr('ws.plan.otherWaiting')} style={{ flex: '1 1 20rem' }} />
          {others.map((m) => (
            <Button key={m} size="sm" iconEnd="arrowEnd" onClick={() => setSearch({ month: monthKey(m) })}>
              {monthLabel(m, locale)}
            </Button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
        <SegmentedControl<PlanView>
          size="sm"
          aria-label={tr('ws.plan.view.label')}
          value={view}
          onChange={(v) => setSearch({ ...keep, day: search.day, view: v })}
          options={[
            { value: 'calendar', label: tr('ws.plan.view.calendar') },
            { value: 'list', label: tr('ws.plan.view.list', { count: formatNumber(plan.ideas.length, locale) }) },
          ]}
        />
        <Legend />
      </div>

      {view === 'list' ? (
        <Panel padded={false} data-testid="plan.listPanel">
          <MonthList actions={actions} onPickDay={pickDay} />
        </Panel>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--tp-sp-4)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '999 1 34rem', minInlineSize: 0 }}>
            <PlanCalendar month={plan.month} today={plan.today} byDay={byDay} selected={day} leftOut={leftOut} onPick={pickDay} />
          </div>
          <div style={{ flex: `1 1 ${panelled?.kind === 'result' ? '26rem' : '22rem'}`, minInlineSize: 0, position: 'sticky', insetBlockStart: 'var(--tp-sp-3)' }}>
            <DayPanel day={day} ideas={byDay.get(day) ?? []} actions={actions} panelled={panelled} setPanelled={setPanelled} />
          </div>
        </div>
      )}
    </>
  );
}

function Legend() {
  const { tr } = useLocale();
  return (
    <ul aria-label={tr('ws.plan.legend')} style={{ display: 'flex', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', listStyle: 'none', margin: 0, padding: 0, ...muted, fontSize: 'var(--tp-fs-xs)' }}>
      {LEGEND.map((s) => (
        <li key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}>
          <StageMark stage={s} />
          {tr(`ws.plan.stage.${s}`)}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Where the month stands, and the one action that moves it on
// ---------------------------------------------------------------------------

function PlanBar({ plan, writer, owner }: { plan: MonthPlan; writer: boolean; owner: boolean }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const send = useMutation({
    mutationFn: () => appRpc('send_marketing_plan', { p_month: plan.month }),
    onSuccess: () => {
      toast.ok(tr('ws.plan.toast.sent'));
      refreshPlan(qc);
    },
  });
  const takeBack = useMutation({
    mutationFn: () => appRpc('take_back_marketing_plan', { p_month: plan.month }),
    onSuccess: () => {
      toast.ok(tr('ws.plan.toast.takenBack'));
      refreshPlan(qc);
    },
  });

  const h = plan.plan;
  const status: PlanStatus | 'none' = h?.status ?? 'none';
  const who = writer ? 'writer' : 'owner';
  const fresh = proposedIdeas(plan).length;
  const { made, of } = madeCount(plan);
  const when = (iso: string | null) => (iso ? formatDate(new Date(iso), locale) : '');
  const lead =
    status === 'draft' && writer && fresh === 0
      ? tr('ws.plan.lead.writer.draftEmpty')
      : tr(`ws.plan.lead.${who}.${status}`, {
          count: formatNumber(fresh, locale),
          name: isolate(status === 'approved' ? (h?.decidedByName ?? '') : (h?.sentByName ?? '')),
          date: when(status === 'approved' ? (h?.decidedAt ?? null) : (h?.sentAt ?? null)),
          made: formatNumber(made, locale),
          of: formatNumber(of, locale),
        });
  const note = h?.decisionNote && (status === 'changes' || status === 'approved') ? h.decisionNote : null;
  const busy = send.isPending || takeBack.isPending;
  const failed = send.error ?? takeBack.error;

  return (
    <section
      aria-label={tr('ws.plan.barLabel')}
      data-testid="plan.bar"
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-2)',
        paddingBlock: 'var(--tp-sp-3)',
        paddingInline: 'var(--tp-sp-4)',
        borderRadius: 'var(--tp-radius-panel)',
        border: '1px solid var(--tp-border)',
        background: status === 'changes' && writer ? 'var(--tp-warn-soft)' : 'var(--tp-surface)',
        color: status === 'changes' && writer ? 'var(--tp-warn-fg)' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
        <p style={{ margin: 0, flex: '1 1 24rem', maxInlineSize: '75ch', fontWeight: 600 }} data-testid="plan.lead">
          {lead}
        </p>
        {writer && plan.canSend && (
          <Button kind="primary" icon="arrowUpRight" busy={send.isPending} disabled={busy} onClick={() => send.mutate()} data-testid="plan.send">
            {tr('ws.plan.actions.send')}
          </Button>
        )}
        {writer && plan.canTakeBack && (
          <Button icon="undo" busy={takeBack.isPending} disabled={busy} onClick={() => takeBack.mutate()} data-testid="plan.takeBack">
            {tr('ws.plan.actions.takeBack')}
          </Button>
        )}
      </div>
      {note && (
        <p style={{ margin: 0, whiteSpace: 'pre-wrap', maxInlineSize: '75ch' }} data-testid="plan.note">
          <span style={{ fontWeight: 700 }}>{tr(owner ? 'ws.plan.yourNote' : 'ws.plan.ownerNote')} </span>
          <bdi dir="auto">{note}</bdi>
        </p>
      )}
      {failed && <ErrorText error={failed} style={{ marginBlock: 0 }} />}
    </section>
  );
}

/**
 * The owner's answer, under the bar while the plan waits on them: one
 * optional note, and the two answers. Approving takes every new idea but the
 * ones left out; the summary under the buttons counts both before the press.
 */
function DecisionBar({ plan, leftOut }: { plan: MonthPlan; leftOut: ReadonlySet<string> }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const fresh = proposedIdeas(plan);
  const drop = fresh.filter((i) => leftOut.has(i.id)).map((i) => i.id);
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'changes') =>
      appRpc('decide_marketing_plan', { p_id: plan.plan?.id, p_decision: decision, p_note: note.trim() || null, p_drop: decision === 'approve' ? drop : [] }),
    onSuccess: (_r, decision) => {
      toast.ok(tr(decision === 'approve' ? 'ws.plan.toast.approved' : 'ws.plan.toast.changes'));
      refreshPlan(qc);
    },
  });
  const busy = decide.isPending;
  return (
    <Panel title={tr('ws.plan.decide.title')} data-testid="plan.decide">
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        <Field label={tr('ws.plan.decide.note')} optional hint={tr('ws.plan.decide.noteHint')} style={{ marginBlockEnd: 0 }}>
          <textarea
            value={note}
            rows={2}
            maxLength={PLAN_NOTE_MAX}
            dir="auto"
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
            style={{ ...inputStyle, minBlockSize: '3.5rem', resize: 'vertical', fontFamily: 'inherit' }}
            data-testid="plan.decide.note"
          />
        </Field>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
          <span style={{ ...muted, flex: '1 1 16rem' }} data-testid="plan.decide.summary">
            {tr(drop.length > 0 ? 'ws.plan.decide.summaryLeftOut' : 'ws.plan.decide.summary', {
              approve: formatNumber(fresh.length - drop.length, locale),
              out: formatNumber(drop.length, locale),
            })}
          </span>
          <Button icon="undo" busy={busy && decide.variables === 'changes'} disabled={busy} onClick={() => decide.mutate('changes')} data-testid="plan.decide.changes">
            {tr('ws.plan.decide.changes')}
          </Button>
          <Button kind="primary" icon="check" busy={busy && decide.variables === 'approve'} disabled={busy} onClick={() => decide.mutate('approve')} data-testid="plan.decide.approve">
            {tr('ws.plan.decide.approve')}
          </Button>
        </div>
        {decide.isError && <ErrorText error={decide.error} style={{ marginBlock: 0 }} />}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// The day beside the calendar
// ---------------------------------------------------------------------------

function DayPanel({
  day,
  ideas,
  actions: a,
  panelled,
  setPanelled,
}: {
  day: string;
  ideas: readonly PlanIdea[];
  actions: PlanActions;
  panelled: Panelled;
  setPanelled: (p: Panelled) => void;
}) {
  const { tr, locale } = useLocale();
  const { plan, writer } = a;
  const past = day < plan.today;
  const canAdd = writer && plan.canEdit && !past;
  const close = () => setPanelled(null);

  let body;
  if (panelled?.kind === 'idea') {
    body = <IdeaForm key={panelled.idea?.id ?? `new:${panelled.day}`} day={panelled.day} idea={panelled.idea} onClose={close} />;
  } else if (panelled?.kind === 'result') {
    const idea = panelled.idea;
    body = (
      <div style={{ padding: 'var(--tp-sp-3)' }}>
        <ContentForm
          key={`result:${idea.id}`}
          mode={{
            kind: 'new',
            idea: { id: idea.id, title: idea.title },
            draft: { ...EMPTY_DRAFT, title: idea.title, channel: idea.channel, plannedFor: resultDay(idea.day, plan.today) },
          }}
          onClose={close}
        />
      </div>
    );
  } else {
    body = (
      <>
        {ideas.length > 0 ? (
          <IdeaList ideas={ideas} actions={a} />
        ) : (
          <p style={{ ...muted, margin: 0, padding: 'var(--tp-sp-3)' }}>{tr(past ? 'ws.plan.day.nothingPast' : 'ws.plan.day.nothing')}</p>
        )}
        {canAdd && (
          <div style={{ padding: 'var(--tp-sp-3)', borderBlockStart: ideas.length > 0 ? '1px solid var(--tp-border)' : undefined }}>
            <Button icon="plus" kind={ideas.length === 0 ? 'primary' : 'default'} onClick={() => setPanelled({ kind: 'idea', day, idea: null })} data-testid="plan.add">
              {tr('ws.plan.day.add')}
            </Button>
          </div>
        )}
        {writer && !plan.canEdit && !past && (
          <p style={{ ...muted, margin: 0, padding: 'var(--tp-sp-3)', borderBlockStart: '1px solid var(--tp-border)' }}>{tr('ws.plan.day.locked')}</p>
        )}
      </>
    );
  }

  return (
    <Panel title={longDay(day, locale)} padded={false} data-testid="plan.dayPanel">
      {body}
    </Panel>
  );
}

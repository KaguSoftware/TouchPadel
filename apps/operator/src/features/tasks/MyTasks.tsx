/**
 * My tasks (/tasks) — protocol work for every hireable role but management
 * (build-contracts-2026-09-23 §5.1, §5.4, Q2: every step form works on the
 * desktop as well as on the phone).
 *
 * The page answers three questions, in order:
 *
 *  1. **What can I start?** The head roles propose a new item, marketing
 *     proposes a price or promo change, the court desk starts a tournament.
 *     A head also reviews the new-item ideas their team sent (#65).
 *  2. **What is mine to do, and what is waiting on someone else?** To do,
 *     Waiting for a decision and Decided this week, from app.my_protocol_work.
 *     A row opens the same step the phone opens: its form, its checklist and
 *     what was said about it last time. Nobody here decides a step; that is
 *     management's, on /protocols.
 *  3. **What do I do on the phone?** A read-only copy of those pages, marked
 *     as such (PhoneCopies).
 *
 * The driver's and marketing's landing screen, a rail row for the till and
 * the desk, and the kitchen board's "My tasks" button: from the board the
 * page has no rail, so it carries its own way back.
 *
 * A finished product release shows here as done, with no figures: the day-30
 * review is management's alone (#54), and this page never reads it.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { formatDateTime, formatNumber, isolate } from '@touch/i18n';
import { can, useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { useWorkspaceOrNull } from '../../routes/__root';
import { Button, ErrorText } from '../../components/ui';
import { PageHeader, Panel, StatusBadge } from '../../components/kit';
import { CardTitle, MARK_FG } from '../ops/OpsVisuals';
import { IdeasToReviewList, useIdeasToReview } from '../roleExtras/Ideas';
import { decisionTone } from '../protocols/protocolLogic';
import { readIdeasToReview, type IdeaRow } from '../roleExtras/roleExtrasLogic';
import { TK } from './keys';
import { fetchMyWork } from './api';
import { PhoneCopies } from './PhoneCopies';
import { MarketingContentPanel } from '../content/ContentSection';
import { StartSheet } from './StartSheet';
import { StepSheet } from './StepSheet';
import { readMyWork, runTitle, taskStarts, type WorkItem } from './tasksLogic';
import type { TaskStart, TasksSearch } from './search';

const START_ICON: Record<TaskStart, 'plus' | 'tag' | 'star'> = { product_release: 'plus', price_promo: 'tag', tournament: 'star' };

export function MyTasksScreen() {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const navigate = useNavigate();
  const workspace = useWorkspaceOrNull();
  const search = useSearch({ strict: false }) as TasksSearch;
  const starts = useMemo(() => taskStarts(staff?.role), [staff?.role]);
  const reviewsIdeas = can(staff?.role, 'reviewIdeas');

  const workQ = useQuery({ queryKey: TK.work, queryFn: fetchMyWork, refetchInterval: 60_000 });
  const work = useMemo(() => readMyWork(workQ.data), [workQ.data]);
  const ideasQ = useIdeasToReview(reviewsIdeas);
  const ideas = readIdeasToReview(ideasQ.data);

  // Open sheets live in the URL, so the kitchen board, the desk's event blocks
  // and a reload land on the same step or form.
  const setSearch = (next: TasksSearch) => void navigate({ to: '/tasks', search: next, replace: true });
  const openStep = search.step ?? null;
  const openStart = search.start && starts.includes(search.start) ? search.start : null;
  const [idea, setIdea] = useState<IdeaRow | null>(null);
  const startIdea = idea ?? (search.idea ? (ideas.ideas.find((i) => i.id === search.idea) ?? null) : null);

  // From the kitchen board the page has no rail: the board is the way back.
  const onBoard = workspace?.active === 'prep';

  return (
    // With no rail beside it (from the board), the page sits in the middle of
    // the screen rather than against its edge.
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', maxInlineSize: '72rem', marginInline: onBoard ? 'auto' : undefined }}>
      <PageHeader
        title={tr('ws.team.tasks.title')}
        subtitle={tr('ws.team.tasks.lead')}
        actions={
          <span style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {onBoard && (
              <Button icon="chevronStart" onClick={() => void navigate({ to: '/kds' })} data-testid="tasks.back-to-board">
                {tr('ws.team.tasks.backToBoard')}
              </Button>
            )}
            {starts.map((s) => (
              <Button key={s} kind="primary" icon={START_ICON[s]} onClick={() => setSearch({ start: s })} data-testid={`tasks.start.${s}`}>
                {tr(`ws.team.tasks.start.button.${s}`)}
              </Button>
            ))}
          </span>
        }
      />

      {reviewsIdeas && (
        <Panel
          title={<CardTitle icon="spark">{tr('ws.team.tasks.ideas.title', { count: formatNumber(ideas.count, locale) })}</CardTitle>}
          data-testid="tasks.ideas"
        >
          <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.team.tasks.ideas.lead')}</p>
          <IdeasToReviewList
            onStart={(i) => {
              setIdea(i);
              setSearch({ start: 'product_release', idea: i.id });
            }}
          />
        </Panel>
      )}

      <Panel title={<CardTitle icon="checkCircle">{tr('ws.team.tasks.work.title')}</CardTitle>} data-testid="tasks.work">
        {workQ.isError ? (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
            <ErrorText error={workQ.error} style={{ marginBlock: 0 }} />
            <Button size="sm" icon="refresh" onClick={() => void workQ.refetch()}>
              {tr('ws.kit.async.retry')}
            </Button>
          </div>
        ) : workQ.isPending ? (
          <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('common.loading')}</p>
        ) : work.todo.length + work.waiting.length + work.decided.length === 0 ? (
          <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', fontWeight: 600, color: MARK_FG.success }}>
            {tr('ws.team.tasks.work.none')}
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
            <WorkList title={tr('ws.team.tasks.work.todo')} empty={tr('ws.team.tasks.work.todoNone')} items={work.todo} kind="todo" onOpen={(i) => setSearch({ step: i.runStepId })} />
            <WorkList title={tr('ws.team.tasks.work.waiting')} empty={tr('ws.team.tasks.work.waitingNone')} items={work.waiting} kind="waiting" onOpen={(i) => setSearch({ step: i.runStepId })} />
            {work.decided.length > 0 && (
              <WorkList title={tr('ws.team.tasks.work.decided')} empty="" items={work.decided} kind="decided" onOpen={(i) => setSearch({ step: i.runStepId })} />
            )}
          </div>
        )}
      </Panel>

      {/* Marketing's posts for the owners' approval (wave5-addendum-2026-09-25
          §5.1): written and revised here as well as on the phone. */}
      {can(staff?.role, 'submitContent') && <MarketingContentPanel />}

      <PhoneCopies />

      {openStep && <StepSheet runStepId={openStep} onClose={() => setSearch({})} />}
      {openStart && (openStart !== 'product_release' || !search.idea || startIdea) && (
        <StartSheet
          key={`${openStart}:${startIdea?.id ?? ''}`}
          start={openStart}
          idea={openStart === 'product_release' ? startIdea : null}
          onClose={() => {
            setIdea(null);
            setSearch({});
          }}
          onStarted={() => {
            setIdea(null);
            setSearch({});
          }}
        />
      )}
    </div>
  );
}


function WorkList({
  title,
  empty,
  items,
  kind,
  onOpen,
}: {
  title: string;
  empty: string;
  items: readonly WorkItem[];
  kind: 'todo' | 'waiting' | 'decided';
  onOpen: (item: WorkItem) => void;
}) {
  const { tr, locale } = useLocale();
  return (
    <section style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
      <h3 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700, color: 'var(--tp-muted-fg)' }}>
        {title}
        {items.length > 0 && <span style={{ fontVariantNumeric: 'tabular-nums' }}> · {formatNumber(items.length, locale)}</span>}
      </h3>
      {items.length === 0 ? (
        <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{empty}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
          {items.map((item) => (
            <li
              key={`${item.runStepId}:${item.submissionId ?? ''}`}
              data-testid={`tasks.${kind}.${item.runStepId}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--tp-sp-3)',
                flexWrap: 'wrap',
                paddingBlock: 'var(--tp-sp-2)',
                paddingInline: 'var(--tp-sp-2)',
                borderRadius: 'var(--tp-radius-ctl)',
                background: 'var(--tp-surface-2)',
              }}
            >
              <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 16rem', minInlineSize: 0 }}>
                <strong>
                  <bdi>{locale === 'ar' ? item.stepAr || item.stepEn : item.stepEn || item.stepAr}</bdi>
                </strong>
                <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                  <bdi>{runTitle(item, locale, tr)}</bdi> · {tr(`work.protocol.kind.${item.kind}`)}
                  {item.at && ` · ${formatDateTime(new Date(item.at), locale)}`}
                  {kind === 'todo' && item.round > 1 && ` · ${tr('work.protocol.round', { round: formatNumber(item.round, locale) })}`}
                </span>
                {kind === 'decided' && item.decisionNote && (
                  <span dir="auto" style={{ fontSize: 'var(--tp-fs-sm)' }}>
                    {tr('ws.team.tasks.work.note', { name: isolate(item.decidedByName ?? '—'), note: isolate(item.decisionNote) })}
                  </span>
                )}
              </span>
              {kind === 'decided' && item.decision && (
                <StatusBadge size="sm" tone={decisionTone(item.decision)} label={tr(`work.protocol.decision.${item.decision}`)} />
              )}
              {/* No badge under "Waiting for a decision": the heading says it for every row, as on the phone. */}
              <Button size="sm" kind={kind === 'todo' ? 'primary' : 'default'} iconEnd="arrowUpRight" onClick={() => onOpen(item)}>
                {tr(kind === 'todo' ? 'ws.team.tasks.work.open' : 'ws.team.tasks.work.view')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One conversation, end to end (plan §5.2): the stored turns, the live turn
 * streaming in, any job estimate or running job, the scope strip above the
 * composer, and the composer. The drawer and the full page both render this;
 * `compact` is the only thing that changes between them.
 *
 * The record is the database. The live turn is shown until the messages
 * query carries its ids, then the stored rows take over; a turn that failed
 * stays with its error sentence until the next question.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ASSISTANT_SCOPES, type AssistantScope } from '@touch/core/assistant/tools';
import { VENUE_TZ } from '@touch/i18n';
import { useAuth } from '../../lib/auth';
import { QK as SHARED_QK, fetchVenueSettings } from '../../lib/queries';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { ErrorText, Spinner } from '../../components/ui';
import type { PricingMap } from '../../lib/assistantPricing';
import { formatTokens } from '../../lib/assistantPricing';
import {
  QK,
  TERMINAL_JOB_STATUSES,
  acceptJob,
  fetchConversation,
  fetchConversationJobs,
  fetchMessages,
  fetchModels,
  fetchUsage,
  setScopes,
  sourcesOf,
  startSize,
  textOfContent,
  type JobMode,
  type MessageRow,
} from './api';
import { Composer } from './Composer';
import { JobEstimateCard } from './JobEstimateCard';
import { JobProgress } from './JobProgress';
import { Message } from './Message';
import { Disclosure } from './Disclosure';
import { ModelSwitch, modelName } from './ModelSwitch';
import { ScopeStrip } from './ScopeStrip';
import { UsageMeter, slotHasUsage, slotTotal, type MeterSlot } from './UsageMeter';
import { normaliseScopes, refusedScopes, saveRememberedScopes } from './scopes';
import { useAssistantChat } from './useAssistantChat';
import { monthSoFar } from './usageDates';

export function Thread({
  conversationId,
  onConversation,
  newScopes,
  onNewScopesChange,
  compact,
  autoFocus,
  onNavigate,
}: {
  conversationId: string | null;
  onConversation: (id: string) => void;
  /** The checked set for a chat that does not exist yet. */
  newScopes: readonly AssistantScope[];
  onNewScopesChange: (next: AssistantScope[]) => void;
  compact?: boolean;
  autoFocus?: boolean;
  /** A source link was followed (the drawer closes itself). */
  onNavigate?: () => void;
}) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const conversation = useQuery({
    queryKey: QK.conversation(conversationId ?? ''),
    queryFn: () => fetchConversation(conversationId!),
    enabled: conversationId !== null,
  });
  const messages = useQuery({
    queryKey: QK.messages(conversationId ?? ''),
    queryFn: () => fetchMessages(conversationId!),
    enabled: conversationId !== null,
  });
  const jobs = useQuery({
    queryKey: QK.jobs(conversationId ?? ''),
    queryFn: () => fetchConversationJobs(conversationId!),
    enabled: conversationId !== null,
    refetchInterval: (q) => (q.state.data?.some((j) => !TERMINAL_JOB_STATUSES.includes(j.status) && j.status !== 'estimated') ? 5_000 : false),
  });
  const settings = useQuery({ queryKey: SHARED_QK.venueSettings, queryFn: fetchVenueSettings });
  const tz = settings.data?.timezone ?? VENUE_TZ;
  const month = useMemo(() => monthSoFar(tz), [tz]);
  const usage = useQuery({ queryKey: QK.usage(month.from, month.to), queryFn: () => fetchUsage(month.from, month.to), staleTime: 60_000 });
  const pricing: PricingMap | null = usage.data?.pricing ?? null;
  const fallback = usage.data?.fallback_micros_per_mtok ?? 0;

  const scopes = useMemo<AssistantScope[]>(
    () => (conversation.data ? normaliseScopes(conversation.data.scopes) : normaliseScopes(newScopes)),
    [conversation.data, newScopes],
  );

  // 0114: the model. An existing chat carries its own (null = venue default);
  // a chat with no row yet holds the choice here and the first question
  // carries it. Switching chats drops the held choice.
  const [newModel, setNewModel] = useState<string | null>(null);
  useEffect(() => setNewModel(null), [conversationId]);
  const modelsQ = useQuery({ queryKey: QK.models, queryFn: fetchModels, staleTime: 5 * 60_000 });
  const chosenModel: string | null = conversationId ? (conversation.data?.model ?? null) : newModel;

  // What a question starts at with the checked boxes and this chat's model, in
  // one dry-run call (no model call, nothing billed). Re-measured when a box or
  // the model changes; the edge caches 30 s too.
  const startQ = useQuery({
    queryKey: QK.start(scopes.join(','), chosenModel ?? ''),
    queryFn: ({ signal }) => startSize(scopes, chosenModel, undefined, signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const start = startQ.isError ? null : startQ.data?.start;

  const chat = useAssistantChat({
    conversationId,
    onConversation,
    scopes,
    model: chosenModel,
    lang: locale,
  });

  const changeScopes = useMutation({
    mutationFn: async (next: AssistantScope[]) => {
      if (conversationId) await setScopes(conversationId, next, conversation.data?.range ?? null);
      else onNewScopesChange(next);
      if (staff) saveRememberedScopes(staff.id, next);
      return next;
    },
    onSuccess: () => {
      if (conversationId) {
        toast.ok(tr('ws.owner.assistant.scopes.saved'));
        void qc.invalidateQueries({ queryKey: QK.conversation(conversationId) });
        void qc.invalidateQueries({ queryKey: QK.conversations });
      }
    },
  });

  // "Cafe context is off for this chat" → Turn on Cafe → re-ask.
  const [turningOn, setTurningOn] = useState(false);
  const turnOn = async (scope: AssistantScope) => {
    setTurningOn(true);
    try {
      await changeScopes.mutateAsync(normaliseScopes([...scopes, scope]));
      if (chat.lastQuestion) void chat.ask(chat.lastQuestion);
    } finally {
      setTurningOn(false);
    }
  };
  const scopeLabels = useMemo(() => {
    const out = {} as Record<AssistantScope, string[]>;
    for (const s of ASSISTANT_SCOPES) out[s] = [s, tr(`ws.owner.assistant.scopes.${s}`)];
    return out;
  }, [tr]);

  // Jobs: accept from the estimate card, then watch the row.
  const [dismissedJobs, setDismissedJobs] = useState<Set<string>>(() => new Set());
  const [watchedJobs, setWatchedJobs] = useState<string[]>([]);
  const [acceptBusy, setAcceptBusy] = useState<JobMode | 'aggregate' | null>(null);
  const accept = async (jobId: string, mode: JobMode) => {
    setAcceptBusy(mode);
    try {
      await acceptJob(jobId, mode);
      toast.ok(tr('ws.owner.assistant.job.accepted'));
      setWatchedJobs((w) => (w.includes(jobId) ? w : [...w, jobId]));
      setDismissedJobs((d) => new Set(d).add(jobId));
      if (conversationId) void qc.invalidateQueries({ queryKey: QK.jobs(conversationId) });
    } catch (err) {
      toast.err(err instanceof Error ? err.message : String(err));
    } finally {
      setAcceptBusy(null);
    }
  };
  const aggregate = (jobId: string, tools: string[]) => {
    setDismissedJobs((d) => new Set(d).add(jobId));
    void chat.ask(tr('ws.owner.assistant.job.aggregateAsk', { tools: tools.join(', ') }));
  };

  // The live turn is superseded once its stored rows are in the list.
  const rows: MessageRow[] = messages.data ?? [];
  const live = chat.live;
  const liveSuperseded =
    live !== null && live.done && !live.error && !live.stopped && live.assistantMessageId !== null && rows.some((m) => m.id === live.assistantMessageId);
  const showLive = live !== null && !liveSuperseded;

  // Keep the newest thing in view as it arrives.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length, live?.text, live?.tools.length, live?.jobEstimate]);

  // The model that priced the live answer beats the one the next answer will
  // use, which beats what the chat last paid, which beats any priced model.
  const model =
    live?.model ?? live?.usage?.model ?? chosenModel ?? modelsQ.data?.default_model ?? conversation.data?.tokens.model ?? Object.keys(pricing ?? {})[0] ?? '';
  const visibleJobs = (jobs.data ?? []).filter((j) => j.status !== 'estimated' && (!TERMINAL_JOB_STATUSES.includes(j.status) || watchedJobs.includes(j.id)));
  const liveEstimate = live?.jobEstimate && !dismissedJobs.has(live.jobEstimate.job_id) ? live.jobEstimate : null;

  const todayRow = usage.data?.days.find((d) => d.usage_date === month.to);
  const meterSlots: MeterSlot[] = [
    ...(conversation.data ? [{ label: 'thisChat' as const, tokens: conversation.data.tokens, costMicros: conversation.data.tokens.cost_micros ?? null, model: conversation.data.tokens.model ?? null }] : []),
    ...(todayRow
      ? [{ label: 'today' as const, tokens: { input: todayRow.input_tokens, cache_write: todayRow.cache_write_tokens, cache_read: todayRow.cache_read_tokens, output: todayRow.output_tokens }, costMicros: todayRow.cost_micros }]
      : []),
    ...(usage.data
      ? [{ label: 'month' as const, tokens: { input: usage.data.month.input_tokens, cache_write: usage.data.month.cache_write_tokens, cache_read: usage.data.month.cache_read_tokens, output: usage.data.month.output_tokens }, costMicros: usage.data.month.cost_micros }]
      : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minBlockSize: 0, blockSize: '100%', gap: 'var(--tp-sp-2)' }}>
      {/* In the drawer the panel is itself --tp-surface, so the thread gets the
          page ground as a well; otherwise the answer bubbles would vanish into it. */}
      <div
        ref={scroller}
        data-thread-scroll=""
        style={{
          flex: 1,
          minBlockSize: 0,
          overflowY: 'auto',
          display: 'grid',
          gap: 'var(--tp-sp-4)',
          alignContent: 'start',
          ...(compact
            ? { background: 'var(--tp-bg)', borderRadius: 'var(--tp-radius-panel)', padding: 'var(--tp-sp-3)' }
            : { paddingInlineEnd: 'var(--tp-sp-1)' }),
        }}
      >
        {conversationId && messages.isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingBlock: 'var(--tp-sp-4)' }}>
            <Spinner size="md" />
          </div>
        )}
        {messages.isError && <ErrorText error={messages.error} />}
        {conversationId && conversation.isSuccess && conversation.data === null && (
          <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.assistant.notFound')}</p>
        )}
        {!conversationId && !live && (
          <p style={{ color: 'var(--tp-muted-fg)', maxInlineSize: '60ch' }}>{tr('ws.owner.assistant.lead')}</p>
        )}

        {rows.map((m) => {
          if (m.role === 'user') return <Message key={m.id} role="user" text={textOfContent(m.content)} compact={compact} />;
          const src = sourcesOf(m);
          const text = textOfContent(m.content);
          const asked = [...rows].reverse().find((r) => r.role === 'user' && r.seq < m.seq);
          return (
            <Message
              key={m.id}
              messageId={m.id}
              question={asked ? textOfContent(asked.content) : undefined}
              role="assistant"
              text={text}
              tools={src.items}
              scopes={src.scopes.length > 0 ? src.scopes : null}
              gate={m.gate}
              usage={m.tokens}
              pricing={pricing}
              fallbackMicrosPerMtok={fallback}
              fromJob={src.jobIds.length > 0}
              compact={compact}
              onNavigate={onNavigate}
              turnOn={refusedScopes(text, src.items.map((t) => t.error ?? '').filter(Boolean), scopeLabels, scopes)}
              onTurnOn={(s) => void turnOn(s)}
              turningOn={turningOn}
            />
          );
        })}

        {showLive && live && (
          <>
            <Message role="user" text={live.userText} compact={compact} />
            <Message
              role="assistant"
              messageId={live.done && !live.error ? (live.assistantMessageId ?? undefined) : undefined}
              question={live.userText}
              text={live.text}
              tools={live.tools}
              scopes={live.scopes}
              gate={live.gate}
              usage={live.usage ? { ...live.usage, model: live.usage.model ?? live.model ?? undefined } : null}
              pricing={pricing}
              fallbackMicrosPerMtok={fallback}
              streaming={!live.done}
              stopped={live.stopped}
              error={live.error}
              compact={compact}
              onNavigate={onNavigate}
              turnOn={live.done ? refusedScopes(live.text, live.tools.map((t) => t.error ?? '').filter(Boolean), scopeLabels, scopes) : []}
              onTurnOn={(s) => void turnOn(s)}
              turningOn={turningOn}
            />
          </>
        )}

        {liveEstimate && (
          <JobEstimateCard
            estimate={liveEstimate}
            model={model}
            pricing={pricing}
            fallbackMicrosPerMtok={fallback}
            busy={acceptBusy}
            onAccept={(mode) => void accept(liveEstimate.job_id, mode)}
            onAggregate={(tools) => aggregate(liveEstimate.job_id, tools)}
            onDismiss={() => setDismissedJobs((d) => new Set(d).add(liveEstimate.job_id))}
          />
        )}

        {visibleJobs.map((j) => (
          <JobProgress key={j.id} jobId={j.id} initial={j} model={j.tokens.model ?? model} pricing={pricing} fallbackMicrosPerMtok={fallback} />
        ))}
      </div>

      {/* Folded by default (owner call 2026-09-22): three rows of meter
          above the composer crowded the answer. The header keeps the one
          figure that matters here — this chat's, or the month's before a
          chat exists. */}
      {meterSlots.some(slotHasUsage) && (
        <Disclosure
          storageKey={compact ? 'drawer-usage' : 'page-usage'}
          defaultOpen={false}
          title={tr('ws.owner.assistant.meter.title')}
          summary={(() => {
            const head = meterSlots.find(slotHasUsage)!;
            return `${tr(`ws.owner.assistant.meter.${head.label}`)} ${slotTotal(head, pricing, fallback, tr)}`;
          })()}
        >
          <UsageMeter compact pricing={pricing} fallbackMicrosPerMtok={fallback} slots={meterSlots} />
        </Disclosure>
      )}

      <div style={{ borderBlockStart: '1px solid var(--tp-border)', paddingBlockStart: 'var(--tp-sp-2)', display: 'grid', gap: 'var(--tp-sp-2)' }}>
        <Disclosure
          storageKey={compact ? 'drawer-scopes' : 'page-scopes'}
          defaultOpen={!compact}
          title={tr('ws.owner.assistant.scopes.title')}
          summary={start ? `${scopes.length} · ${tr('ws.owner.assistant.scopes.startShort', { tokens: `⁨${formatTokens(start.tokens)}⁩` })}` : String(scopes.length)}
        >
          <ScopeStrip
            scopes={scopes}
            onChange={(next) => changeScopes.mutate(next)}
            start={start}
            measuring={startQ.isFetching}
            pricing={pricing}
            fallbackMicrosPerMtok={fallback}
            disabled={changeScopes.isPending || chat.streaming}
            compact={compact}
            titleHidden
          />
        </Disclosure>
        {changeScopes.isError && <ErrorText error={changeScopes.error} />}
        <Disclosure storageKey="model" defaultOpen={false} title={tr('ws.owner.assistant.model.title')} summary={`⁨${modelName(tr, model)}⁩`}>
          <ModelSwitch
            conversationId={conversationId}
            value={chosenModel}
            onChange={(next) => {
              if (!conversationId) setNewModel(next);
            }}
            disabled={chat.streaming || (conversationId !== null && !conversation.data)}
            titleHidden
          />
        </Disclosure>
        <Composer onAsk={(q) => void chat.ask(q)} onStop={chat.stop} streaming={chat.streaming} autoFocus={autoFocus} disabled={conversationId !== null && conversation.isSuccess && conversation.data === null} />
      </div>
    </div>
  );
}

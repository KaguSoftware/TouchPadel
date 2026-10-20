/**
 * One conversation, end to end (plan §5.2): the stored turns, the live turn
 * streaming in, any job estimate or running job, the scope strip above the
 * composer, and the composer. The drawer and the full page both render this;
 * `compact` is the only thing that changes between them.
 *
 * The record is the database. The live turn is shown until the messages
 * query carries its ids, then the stored rows take over; a turn that failed
 * stays with its error sentence until the next question.
 *
 * Layout since 2026-10-20 (owner picked C for a new chat, D for the rest):
 * an open chat has one toolbar on top (the caller's controls and the cost),
 * the Reads and Model buttons sit in a row under the composer in both, a new chat opens on the ready questions
 * (StartScreen), and the newest answer ends with "Ask next" buttons. A new
 * chat reads nothing until the owner picks, so its composer stays locked.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ASSISTANT_SCOPES, type AssistantScope } from '@touch/core/assistant/tools';
import { VENUE_TZ } from '@touch/i18n';
import { QK as SHARED_QK, fetchVenueSettings } from '../../lib/queries';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { ErrorText, Spinner } from '../../components/ui';
import { Icon } from '../../components/icons';
import type { PricingMap } from '../../lib/assistantPricing';
import { formatTokens, formatUsd, priceFor, totalTokens } from '../../lib/assistantPricing';
import { QK, TERMINAL_JOB_STATUSES, acceptJob, fetchConversation, fetchConversationJobs, fetchMessages, fetchModels, fetchUsage, setScopes, sourcesOf, startSize, textOfContent, type JobMode, type MessageRow } from './api';
import { Composer } from './Composer';
import { JobEstimateCard } from './JobEstimateCard';
import { JobProgress } from './JobProgress';
import { Message } from './Message';
import { MODEL_TRIGGER_STYLE, ModelSwitch, modelName, takePendingNewChatModel, takePendingQuestion } from './ModelSwitch';
import { scopeLabel } from './Sources';
import { ScopeStrip } from './ScopeStrip';
import { slotHasUsage, type MeterSlot } from './UsageMeter';
import { normaliseScopes, refusedScopes } from './scopes';
import { StartScreen } from './StartScreen';
import { ToolbarPopover } from './ToolbarPopover';
import { followUpsFor } from './starters';
import { useAssistantChat } from './useAssistantChat';
import { useAssistantMode } from './useAssistantMode';
import { monthSoFar } from './usageDates';

export function Thread({
  conversationId,
  onConversation,
  newScopes,
  onNewScopesChange,
  compact,
  autoFocus,
  onNavigate,
  toolbarStart,
  toolbarEnd,
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
  /** The caller's controls at the toolbar's start (the page's Chats button and title). */
  toolbarStart?: ReactNode;
  /** The caller's controls at the toolbar's end (New chat). */
  toolbarEnd?: ReactNode;
}) {
  const { tr, locale } = useLocale();
  const assistantMode = useAssistantMode();
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
  // Not memoised: re-read on every render so an open thread rolls into the
  // new venue day (and month) instead of keeping the day it was opened on.
  const month = monthSoFar(tz);
  const usage = useQuery({
    queryKey: QK.usage(month.from, month.to),
    queryFn: () => fetchUsage(month.from, month.to),
    staleTime: 60_000,
  });
  const pricing: PricingMap | null = usage.data?.pricing ?? null;
  const fallback = usage.data?.fallback_micros_per_mtok ?? 0;

  const scopes = useMemo<AssistantScope[]>(() => (conversation.data ? normaliseScopes(conversation.data.scopes) : normaliseScopes(newScopes)), [conversation.data, newScopes]);

  // 0114: the model. An existing chat carries its own (null = venue default);
  // a chat with no row yet holds the choice here and the first question
  // carries it. Switching chats drops the held choice.
  // A model pressed in the free AI's row arrives here once (takePendingNewChatModel).
  const [newModel, setNewModel] = useState<string | null>(() => takePendingNewChatModel());
  const shownChat = useRef(conversationId);
  useEffect(() => {
    if (shownChat.current === conversationId) return;
    shownChat.current = conversationId;
    setNewModel(null);
  }, [conversationId]);
  const modelsQ = useQuery({ queryKey: QK.models, queryFn: fetchModels, staleTime: 5 * 60_000 });
  const chosenModel: string | null = conversationId ? (conversation.data?.model ?? null) : newModel;

  // What a question starts at with the checked boxes and this chat's model, in
  // one dry-run call (no model call, nothing billed). Re-measured when a box or
  // the model changes; the edge caches 30 s too.
  const startQ = useQuery({
    queryKey: QK.start(scopes.join(','), chosenModel ?? ''),
    queryFn: ({ signal }) => startSize(scopes, chosenModel, undefined, signal),
    staleTime: 5 * 60_000,
    // Nothing picked: there is nothing to measure (the server would size its fallback).
    enabled: scopes.length > 0,
    // A size estimate, nothing more: callEdge retries a 5xx once itself, and the
    // box simply shows no estimate when it fails.
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
  const liveSuperseded = live !== null && live.done && !live.error && !live.stopped && live.assistantMessageId !== null && rows.some((m) => m.id === live.assistantMessageId);
  const showLive = live !== null && !liveSuperseded;

  // Keep the newest thing in view as it arrives.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length, live?.text, live?.tools.length, live?.jobEstimate]);

  // The model that priced the live answer beats the one the next answer will
  // use, which beats what the chat last paid, which beats any priced model.
  const model = live?.model ?? live?.usage?.model ?? chosenModel ?? modelsQ.data?.default_model ?? conversation.data?.tokens.model ?? Object.keys(pricing ?? {})[0] ?? '';
  const visibleJobs = (jobs.data ?? []).filter((j) => j.status !== 'estimated' && (!TERMINAL_JOB_STATUSES.includes(j.status) || watchedJobs.includes(j.id)));
  const liveEstimate = live?.jobEstimate && !dismissedJobs.has(live.jobEstimate.job_id) ? live.jobEstimate : null;

  const todayRow = usage.data?.days.find((d) => d.usage_date === month.to);
  const chatSlot: MeterSlot | null = conversation.data
    ? {
        label: 'thisChat',
        tokens: conversation.data.tokens,
        costMicros: conversation.data.tokens.cost_micros ?? null,
        model: conversation.data.tokens.model ?? null,
      }
    : null;
  const monthSlot: MeterSlot | null = usage.data
    ? {
        label: 'month',
        tokens: {
          input: usage.data.month.input_tokens,
          cache_write: usage.data.month.cache_write_tokens,
          cache_read: usage.data.month.cache_read_tokens,
          output: usage.data.month.output_tokens,
        },
        costMicros: usage.data.month.cost_micros,
      }
    : null;
  const meterSlots: MeterSlot[] = [
    ...(chatSlot ? [chatSlot] : []),
    ...(todayRow
      ? [
          {
            label: 'today' as const,
            tokens: {
              input: todayRow.input_tokens,
              cache_write: todayRow.cache_write_tokens,
              cache_read: todayRow.cache_read_tokens,
              output: todayRow.output_tokens,
            },
            costMicros: todayRow.cost_micros,
          },
        ]
      : []),
    ...(monthSlot ? [monthSlot] : []),
  ];
  // The cost panel's tiles (design P1), in Sait's order: today, the month
  // (stressed), this chat.
  const todaySlot = meterSlots.find((m) => m.label === 'today') ?? null;
  const costTiles = [
    ...(todaySlot ? [{ slot: todaySlot, strong: false }] : []),
    ...(monthSlot ? [{ slot: monthSlot, strong: true }] : []),
    ...(chatSlot ? [{ slot: chatSlot, strong: false }] : []),
  ];
  const capMicros = usage.data?.cap.monthly_cap_micros ?? null;
  const capSpent = usage.data?.cap.month_cost_micros ?? 0;
  const capPct = capMicros ? Math.min(100, Math.round((capSpent / capMicros) * 100)) : 0;
  const usd = (slot: MeterSlot) => `⁨${formatUsd(slot.costMicros ?? priceFor({ model: slot.model ?? '', ...slot.tokens }, pricing, fallback))}⁩`;

  // C for a new chat, D for the rest; a new chat reads nothing until the owner picks.
  const isNew = conversationId === null && live === null;
  const locked = conversationId === null && scopes.length === 0;
  const [readsOpen, setReadsOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  // A question handed over from the free AI, typed into the box once.
  const [handedOver] = useState(() => takePendingQuestion() ?? undefined);
  const askStarter = (picked: readonly AssistantScope[], question: string) => {
    const next = normaliseScopes(picked);
    onNewScopesChange(next);
    void chat.ask(question, { scopes: next });
  };

  // "Ask next" under the newest answer that finished cleanly.
  const lastRow = rows[rows.length - 1];
  const lastAnswerTools: string[] | null = showLive
    ? live && live.done && !live.error && !live.stopped && live.text !== ''
      ? live.tools.map((t) => t.name)
      : null
    : lastRow && lastRow.role === 'assistant' && textOfContent(lastRow.content) !== ''
      ? sourcesOf(lastRow).items.map((t) => t.name)
      : null;
  const followUps = !chat.streaming && lastAnswerTools ? followUpsFor(lastAnswerTools, scopes) : [];

  const scopeStrip = (
    <>
      <ScopeStrip
        scopes={scopes}
        onChange={(next) => changeScopes.mutate(next)}
        start={start}
        measuring={startQ.isFetching}
        pricing={pricing}
        fallbackMicrosPerMtok={fallback}
        disabled={changeScopes.isPending || chat.streaming}
        titleHidden
        keepOne={conversationId !== null}
      />
      {changeScopes.isError && <ErrorText error={changeScopes.error} />}
    </>
  );
  const modelSwitch = (
    <ModelSwitch
      compact
      conversationId={conversationId}
      value={chosenModel}
      onChange={(next) => {
        if (!conversationId) setNewModel(next);
      }}
      disabled={chat.streaming || (conversationId !== null && !conversation.data)}
      onChooseFree={assistantMode.canUsePaid ? () => assistantMode.setMode('free') : undefined}
    />
  );
  const readsLabel =
    scopes.length === 0 ? (
      tr('ws.owner.assistant.toolbar.readsNone')
    ) : (
      <>
        {tr('ws.owner.assistant.toolbar.reads')}
        {/* A true circle with the figure dead centre (Sait, 2026-10-20). */}
        <span
          style={{
            inlineSize: '1.375rem',
            blockSize: '1.375rem',
            flexShrink: 0,
            borderRadius: '50%',
            background: 'var(--tp-accent)',
            color: 'var(--tp-accent-contrast)',
            fontSize: 'var(--tp-fs-xs)',
            fontWeight: 700,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
            display: 'inline-grid',
            placeItems: 'center',
          }}
        >
          {scopes.length}
        </span>
      </>
    );
  // The outlined accent button: "Pick what it reads", then "Reads n".
  const readsTrigger = {
    minBlockSize: '2.5rem',
    paddingInline: 'var(--tp-sp-3)',
    borderRadius: 'var(--tp-radius-panel)',
    border: '1.5px solid var(--tp-accent)',
    background: 'var(--tp-accent-soft)',
    color: 'var(--tp-accent-active)',
    fontWeight: 600,
    fontSize: 'var(--tp-fs-sm)',
  } as const;
  // Under the composer, which is always at the foot: the panels open upward.
  const side = 'above';
  const reads = (
    <ToolbarPopover
      open={readsOpen}
      onOpenChange={setReadsOpen}
      side={side}
      align="start"
      panelLabel={tr('ws.owner.assistant.scopes.title')}
      title={tr('ws.owner.assistant.scopes.title')}
      testId="assistant-reads"
      label={readsLabel}
      triggerStyle={readsTrigger}
      panelStyle={{ padding: 0, inlineSize: 'min(27.5rem, calc(100vw - 2 * var(--tp-sp-4)))', borderRadius: 'calc(var(--tp-radius-panel) + 4px)' }}
    >
      {scopeStrip}
    </ToolbarPopover>
  );

  const composer = (
    <Composer
      onAsk={(q) => void chat.ask(q)}
      onStop={chat.stop}
      streaming={chat.streaming}
      autoFocus={autoFocus && !locked}
      locked={locked}
      initialText={handedOver}
      hideHint
      placeholder={isNew ? undefined : tr('ws.owner.assistant.composer.followUp')}
      below={
        // Model first, then what it reads (Sait, 2026-10-20).
        <>
          <ToolbarPopover
            open={modelOpen}
            onOpenChange={setModelOpen}
            side={side}
            align="start"
            panelLabel={tr('ws.owner.assistant.model.title')}
            title={tr('ws.owner.assistant.model.title')}
            testId="assistant-model"
            // As wide as the model row, so Free AI never wraps under the Claude pair (Arabic is longer).
            panelStyle={{ inlineSize: 'max-content', maxInlineSize: 'calc(100vw - 2 * var(--tp-sp-4))' }}
            label={
              <>
                <Icon name="spark" size={14} />
                <span dir="auto">{assistantMode.mode === 'free' ? tr('ws.owner.assistant.model.free') : modelName(tr, chosenModel ?? modelsQ.data?.default_model ?? '')}</span>
              </>
            }
            triggerStyle={MODEL_TRIGGER_STYLE}
          >
            {modelSwitch}
          </ToolbarPopover>
          {reads}
        </>
      }
      disabled={conversationId !== null && conversation.isSuccess && conversation.data === null}
    />
  );

  const monthUsd = monthSlot && slotHasUsage(monthSlot) ? usd(monthSlot) : null;
  const startFooter = (
    <p
      style={{
        margin: 0,
        fontSize: 'var(--tp-fs-xs)',
        color: 'var(--tp-muted-fg)',
        display: 'flex',
        gap: 'var(--tp-sp-1)',
        flexWrap: 'wrap',
        justifyContent: 'center',
        textAlign: 'center',
      }}
    >
      <span>
        {scopes.length === 0
          ? tr('ws.owner.assistant.start.readsNothing')
          : tr('ws.owner.assistant.start.readsList', {
              scopes: scopes.map((x) => scopeLabel(tr, x)).join(', '),
            })}
      </span>
      <span aria-hidden="true">·</span>
      <span>{tr('ws.owner.assistant.start.billed')}</span>
      {monthUsd && (
        <>
          <span aria-hidden="true">·</span>
          <Link to="/assistant/usage" className="tp-link" onClick={onNavigate}>
            {tr('ws.owner.assistant.start.month', { cost: monthUsd })}
          </Link>
        </>
      )}
    </p>
  );

  const column = { inlineSize: '100%', maxInlineSize: '51.25rem', marginInline: 'auto' } as const;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minBlockSize: 0,
        blockSize: '100%',
        gap: 'var(--tp-sp-3)',
      }}
    >
      {!isNew && (
        <div
          role="toolbar"
          aria-label={tr('ws.owner.assistant.toolbar.label')}
          data-assistant-toolbar=""
          className="tp-assistant-toolbar"
          style={{
            // Start controls | the chat's subject, centred | the cost.
            display: 'grid',
            // The subject centres in the room between the two ends, so its gaps match (Sait, 2026-10-20).
            gridTemplateColumns: 'auto minmax(0, 1fr) auto',
            alignItems: 'center',
            gap: 'var(--tp-sp-2-5)',
            // Background, edge and ink: .tp-assistant-toolbar (rail blue in light mode).
            borderRadius: 'var(--tp-radius-panel)',
            paddingBlock: 'var(--tp-sp-2)',
            paddingInline: 'var(--tp-sp-3)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--tp-sp-2)',
              flexWrap: 'wrap',
              minInlineSize: 0,
            }}
          >
            {toolbarStart}
          </div>
          {conversation.data ? (
            <h1
              style={{
                margin: 0,
                fontSize: 'var(--tp-fs-xl)',
                fontWeight: 700,
                minInlineSize: 0,
                textAlign: 'center',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              <bdi>{conversation.data.title?.trim() || tr('ws.owner.assistant.conversations.untitled')}</bdi>
            </h1>
          ) : (
            <span />
          )}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 'var(--tp-sp-2)',
              flexWrap: 'wrap',
              minInlineSize: 0,
            }}
          >
            {meterSlots.some(slotHasUsage) && (
              <ToolbarPopover
                open={costOpen}
                onOpenChange={setCostOpen}
                panelLabel={tr('ws.owner.assistant.toolbar.costTitle')}
                title={tr('ws.owner.assistant.toolbar.costTitle')}
                testId="assistant-cost"
              panelStyle={{ padding: 'var(--tp-sp-4)', inlineSize: 'min(23.75rem, calc(100vw - 2 * var(--tp-sp-4)))', borderRadius: 'calc(var(--tp-radius-panel) + 4px)' }}
                triggerStyle={{
                  minBlockSize: '2.5rem',
                  paddingInline: 'var(--tp-sp-3)',
                  borderRadius: 'var(--tp-radius-pill)',
                  border: '1px solid var(--tp-border-strong)',
                  background: 'var(--tp-surface)',
                  color: 'var(--tp-fg)',
                  fontSize: 'var(--tp-fs-sm)',
                }}
                label={
                  <>
                    <span
                      aria-hidden="true"
                      style={{
                        inlineSize: '0.5rem',
                        blockSize: '0.5rem',
                        borderRadius: '50%',
                        background: 'var(--tp-brand-green)',
                      }}
                    />
                    {chatSlot && monthSlot
                      ? tr('ws.owner.assistant.toolbar.cost', {
                          chat: usd(chatSlot),
                          month: usd(monthSlot),
                        })
                      : monthSlot
                        ? tr('ws.owner.assistant.toolbar.costMonth', { month: usd(monthSlot) })
                        : usd(meterSlots.find(slotHasUsage)!)}
                  </>
                }
              >
                {/* Design P1 (Sait, 2026-10-20), as drawn: three tiles, the month's
                    highlighted, the monthly cap as a bar, the usage page under it. */}
                <div data-cost-panel="" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>{tr('ws.owner.assistant.toolbar.costHeading')}</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${costTiles.length}, minmax(0, 1fr))`, gap: 'var(--tp-sp-2)' }}>
                    {costTiles.map((t) => (
                      <div
                        key={t.slot.label}
                        data-cost-tile={t.slot.label}
                        style={{
                          background: t.strong ? 'var(--tp-accent-soft)' : 'var(--tp-surface-2)',
                          border: `1px solid ${t.strong ? 'var(--tp-border-strong)' : 'var(--tp-accent-soft)'}`,
                          borderRadius: 'var(--tp-radius-panel)',
                          padding: '10px',
                          minInlineSize: 0,
                        }}
                      >
                        <div style={{ fontSize: 'var(--tp-fs-xs)', color: t.strong ? 'var(--tp-accent-active)' : 'var(--tp-muted-fg)' }}>{tr(`ws.owner.assistant.meter.${t.slot.label}`)}</div>
                        <div style={{ fontSize: '20px', fontWeight: 700, color: t.strong ? 'var(--tp-accent-2-contrast)' : 'var(--tp-fg)' }}>{usd(t.slot)}</div>
                        <div style={{ fontSize: '11px', color: t.strong ? 'var(--tp-accent-active)' : 'var(--tp-muted-fg)' }}>
                          {tr('ws.owner.assistant.meter.tokens', { tokens: `⁨${formatTokens(totalTokens(t.slot.tokens))}⁩` })}
                        </div>
                      </div>
                    ))}
                  </div>
                  {capMicros ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--tp-fs-xs)' }}>
                        <span style={{ fontWeight: 600 }}>{tr('ws.owner.assistant.toolbar.cap')}</span>
                        <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.assistant.toolbar.capOf', { spent: `⁨${formatUsd(capSpent)}⁩`, cap: `⁨${formatUsd(capMicros)}⁩` })}</span>
                      </div>
                      <div role="progressbar" aria-label={tr('ws.owner.assistant.toolbar.cap')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={capPct} style={{ blockSize: '8px', borderRadius: 'var(--tp-radius-pill)', background: 'var(--tp-accent-soft)', overflow: 'hidden' }}>
                        <div style={{ inlineSize: `${capPct}%`, blockSize: '100%', background: capPct >= 90 ? 'var(--tp-danger)' : 'var(--tp-brand-green)' }} />
                      </div>
                    </div>
                  ) : (
                    <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.assistant.toolbar.noCap')}</p>
                  )}
                  <Link
                    to="/assistant/usage"
                    onClick={onNavigate}
                    className="tp-cost-usage"
                    style={{ blockSize: '40px', borderRadius: 'var(--tp-radius-panel)', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}
                  >
                    {tr('ws.owner.assistant.toolbar.usageLink')}
                  </Link>
                </div>
              </ToolbarPopover>
            )}
            {toolbarEnd}
          </div>
        </div>
      )}

      {/* In the drawer the panel is itself --tp-surface, so the thread gets the
          page ground as a well; otherwise the answer bubbles would vanish into it. */}
      <div
        ref={scroller}
        data-thread-scroll=""
        style={{
          flex: 1,
          minBlockSize: 0,
          overflowY: 'auto',
          // The start screen is a column whose footer sits at the foot.
          display: isNew ? 'flex' : 'grid',
          flexDirection: 'column',
          alignContent: 'start',
          ...(compact
            ? {
                background: 'var(--tp-bg)',
                borderRadius: 'var(--tp-radius-panel)',
                padding: 'var(--tp-sp-3)',
              }
            : { paddingInlineEnd: 'var(--tp-sp-1)' }),
        }}
      >
        {isNew ? (
          <StartScreen footer={startFooter} onAsk={askStarter} disabled={chat.streaming} compact={compact} />
        ) : (
          <div style={{ ...column, display: 'grid', gap: 'var(--tp-sp-4)', alignContent: 'start' }}>
            {conversationId && messages.isLoading && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  paddingBlock: 'var(--tp-sp-4)',
                }}
              >
                <Spinner size="md" />
              </div>
            )}
            {messages.isError && <ErrorText error={messages.error} />}
            {conversationId && conversation.isSuccess && conversation.data === null && <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.assistant.notFound')}</p>}
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

            {followUps.length > 0 && (
              <div data-follow-ups="" style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
                <span
                  style={{
                    fontSize: 'var(--tp-fs-xs)',
                    fontWeight: 600,
                    color: 'var(--tp-muted-fg)',
                  }}
                >
                  {tr('ws.owner.assistant.followUps.title')}
                </span>
                <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
                  {followUps.map((key) => (
                    <button
                      key={key}
                      type="button"
                      title={tr('ws.owner.assistant.followUps.hint')}
                      onClick={() => void chat.ask(tr(`ws.owner.assistant.followUps.${key}` as never))}
                      className="tp-follow-up"
                      style={{
                        minBlockSize: '2.375rem',
                        paddingInline: 'var(--tp-sp-4)',
                        borderRadius: 'var(--tp-radius-pill)',
                        cursor: 'pointer',
                      }}
                    >
                      {tr(`ws.owner.assistant.followUps.${key}` as never)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* At the foot in a new chat too (Sait, 2026-10-20): heading, cards, then the box. */}
      <div style={column}>{composer}</div>
    </div>
  );
}

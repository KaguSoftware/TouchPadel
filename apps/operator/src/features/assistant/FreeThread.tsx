/**
 * The free AI's chat (owner call 2026-10-16): every staff role's assistant in
 * the drawer, and the owner's when he picks "The free AI". It asks
 * `assistant-free` (Groq), which finds pages and explains how things work; it
 * reads no business data and stores nothing on the server. Since 2026-10-20
 * its chats are saved on this computer (freeChats.ts), listed apart from the
 * paid ones, and each question carries the open chat's last few turns.
 *
 * An answer's page routes become "Go to" buttons, but only for pages this
 * person may open (canAccess), so a cashier is never sent to an owner page.
 * Staff see a "Free" badge and nothing paid. For the owner the free AI is one
 * more button in the model row (2026-10-20): the same Model button sits under
 * the composer with Free AI pressed, and pressing Opus or Sonnet goes back to
 * the paid thread on that model; no separate bar or page to leave by.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../components/icons';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { FREE_ASSISTANT_FN, FREE_TEXT_MAX } from '@touch/core/assistant/free';
import { countPhrase } from '@touch/i18n';
import { canAccess, useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { streamEdge, type EdgeFunctionName } from '../../lib/edge';
import { Button, ErrorText, Spinner } from '../../components/ui';
import { StatusBadge } from '../../components/kit';
import { Composer } from './Composer';
import { Message, AssistantText } from './Message';
import { navItemFor, routesIn } from './pageLinks';
import { useAssistantMode } from './useAssistantMode';
import { MODEL_TRIGGER_STYLE, ModelSwitch, setPendingNewChatModel, setPendingQuestion } from './ModelSwitch';
import { ToolbarPopover } from './ToolbarPopover';
import { newChat, useFreeChats } from './freeChats';
import {
  FREE_TOPICS,
  applyFreeEvent,
  canRetry,
  freeErrorMessage,
  freeErrorOf,
  historyOf,
  needsData,
  newExchange,
  type FreeExchange,
} from './freeThreadLogic';

const FREE_FN = FREE_ASSISTANT_FN satisfies EdgeFunctionName;

function isAbort(err: unknown): boolean {
  return (err instanceof DOMException && err.name === 'AbortError') || (err instanceof Error && err.name === 'AbortError');
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `free-${Date.now().toString(36)}-${seq}`;
}

const TILE_TONES = ['teal', 'sky', 'violet', 'green', 'gold', 'rose'] as const;

/**
 * The pages an answer names that exist AND this person may open, as coloured
 * tiles (F1): the answer's way onward is the biggest thing on it.
 */
function FreePageLinks({ text, onNavigate, compact }: { text: string; onNavigate?: () => void; compact?: boolean }) {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const router = useRouter({ warn: false });
  const routes = useMemo(() => {
    if (!router) return [];
    const byPath = router.routesByPath as Record<string, unknown>;
    return routesIn(text, (path) => (path in byPath || `${path}/` in byPath) && canAccess(staff, path));
  }, [router, text, staff]);
  if (!router || routes.length === 0) return null;
  return (
    <div data-page-links="" style={{ display: 'grid', gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'repeat(auto-fill, minmax(14rem, 1fr))', gap: 'var(--tp-sp-2)' }}>
      {routes.map((path, i) => {
        const item = navItemFor(path);
        return (
          <button
            key={path}
            type="button"
            className="tp-starter tp-starter-tile"
            data-tone={TILE_TONES[i % TILE_TONES.length]}
            title={path}
            data-testid={`assistant.free.goto.${path}`}
            onClick={() => {
              void router.navigate({ to: path });
              onNavigate?.();
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2-5)', minBlockSize: '3rem', paddingInline: 'var(--tp-sp-3)', borderRadius: 'var(--tp-radius-panel)', fontWeight: 600, textAlign: 'start', cursor: 'pointer', font: 'inherit' }}
          >
            <Icon name={item?.icon ?? 'arrowUpRight'} size={18} />
            <span style={{ flex: 1, minInlineSize: 0 }}>{tr('ws.assistantFree.goTo', { page: item ? tr(`ws.shell.nav.${item.labelKey}`) : `⁨${path}⁩` })}</span>
            <Icon name="arrowEnd" size={16} />
          </button>
        );
      })}
    </div>
  );
}

function FreeAnswer({
  ex,
  streaming,
  compact,
  onNavigate,
  onRetry,
  onAskPaid,
}: {
  ex: FreeExchange;
  streaming: boolean;
  compact?: boolean;
  onNavigate?: () => void;
  onRetry: () => void;
  /** The owner only: take this question to the paid assistant. */
  onAskPaid?: () => void;
}) {
  const { tr, locale } = useLocale();
  const [copied, setCopied] = useState(false);
  const err = ex.error ? freeErrorMessage(ex.error) : null;
  const done = !streaming && ex.answer !== '';
  const showNeedsData = done && !!onAskPaid && needsData(ex.answer);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ex.answer);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no clipboard in this window */
    }
  };
  return (
    <div data-message-role="assistant" data-free-answer="" style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
      <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', fontWeight: 600, display: 'flex', gap: 'var(--tp-sp-1)', alignItems: 'center' }}>
        {tr('ws.assistantFree.assistant')}
        {streaming && <Spinner size="xs" />}
      </span>
      {(ex.answer !== '' || streaming) && (
        <div
          data-answer-bubble=""
          style={{
            display: 'grid',
            background: 'var(--tp-surface)',
            color: 'var(--tp-fg)',
            border: '1px solid var(--tp-border-strong, var(--tp-border))',
            borderRadius: 'calc(var(--tp-radius-panel) + 4px)',
            boxShadow: 'var(--tp-shadow-raised)',
            overflow: 'hidden',
            minInlineSize: 0,
          }}
        >
          <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', paddingBlock: 'var(--tp-sp-4)', paddingInline: 'calc(var(--tp-sp-4) + 2px)', lineHeight: 1.55 }}>
            {ex.answer !== '' ? (
              <AssistantText text={ex.answer} unverified={[]} />
            ) : (
              <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.assistantFree.thinking')}</p>
            )}
            {done && <FreePageLinks text={ex.answer} onNavigate={onNavigate} compact={compact} />}
          </div>
          {done && (
            <div data-answer-actions="" style={{ display: 'flex', gap: 'var(--tp-sp-1)', alignItems: 'center', background: 'var(--tp-surface-2)', borderBlockStart: '1px solid var(--tp-border)', paddingBlock: 'var(--tp-sp-1-5)', paddingInline: 'var(--tp-sp-2)' }}>
              <Button size="sm" kind="ghost" icon={copied ? 'check' : 'fileText'} onClick={() => void copy()}>
                {tr(copied ? 'ws.assistantFree.answer.copied' : 'ws.assistantFree.answer.copy')}
              </Button>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', paddingInlineEnd: 'var(--tp-sp-1)' }}>{tr('ws.assistantFree.answer.source')}</span>
            </div>
          )}
        </div>
      )}
      {showNeedsData && (
        <div
          data-needs-data=""
          className="tp-starter"
          data-tone="gold"
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', borderRadius: 'calc(var(--tp-radius-panel) + 4px)', paddingBlock: 'var(--tp-sp-3)', paddingInline: 'var(--tp-sp-4)' }}
        >
          <Icon name="lock" size={18} />
          <p style={{ margin: 0, flex: 1, minInlineSize: '12rem' }}>{tr('ws.assistantFree.needsData.text')}</p>
          <Button kind="primary" onClick={onAskPaid} data-testid="assistant.free.askPaid">
            {tr('ws.assistantFree.needsData.button')}
          </Button>
        </div>
      )}
      {ex.stopped && !ex.error && <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.assistantFree.stopped')}</p>}
      {ex.error && err && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', justifyItems: 'start' }}>
          <ErrorText
            error={ex.error}
            message={err.key === 'minute' ? countPhrase('ws.assistantFree.errors.minute', err.seconds ?? 0, locale) : tr(`ws.assistantFree.errors.${err.key}`)}
            style={{ marginBlock: 0 }}
          />
          {canRetry(ex.error) && (
            <Button size="sm" kind="soft" icon="refresh" onClick={onRetry} data-testid="assistant.free.retry">
              {tr('ws.assistantFree.retry')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function FreeThread({
  compact,
  autoFocus,
  onNavigate,
  headerEnd,
  toolbarStart,
}: {
  compact?: boolean;
  autoFocus?: boolean;
  onNavigate?: () => void;
  /** The caller's control at the header's end (the page's "Go to paid AI"). */
  headerEnd?: ReactNode;
  /** The page's Chats and New chat, in place of the thread's own New chat. */
  toolbarStart?: ReactNode;
}) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const { canUsePaid, setMode } = useAssistantMode();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const userId = staff?.id ?? '';

  // The saved chats (freeChats.ts, on this computer): the open one is the thread.
  const free = useFreeChats(userId);
  const { create, update, startNew } = free;
  const exchanges = useMemo(() => free.active?.exchanges ?? [], [free.active]);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const exchangesRef = useRef(exchanges);
  exchangesRef.current = exchanges;
  const activeRef = useRef(free.activeId);
  activeRef.current = free.activeId;
  const controller = useRef<AbortController | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  // A different person signed in on this station: stop what the last one asked.
  const userRef = useRef(userId);
  useEffect(() => {
    if (userRef.current === userId) return;
    userRef.current = userId;
    controller.current?.abort();
  }, [userId]);

  useEffect(() => () => controller.current?.abort(), []);

  const ask = useCallback(
    async (text: string, base?: FreeExchange[]) => {
      const question = text.trim().slice(0, FREE_TEXT_MAX);
      if (question === '' || controller.current) return;
      const before = base ?? exchangesRef.current;
      // The first question of a new chat makes the chat; later ones go to the open one.
      let chatId = activeRef.current;
      if (!chatId) {
        const chat = newChat(`free-chat-${nextId()}`, question, Date.now());
        create(chat);
        chatId = chat.id;
        activeRef.current = chatId;
      }
      const target = chatId;
      const ex = newExchange(nextId(), question);
      const ac = new AbortController();
      controller.current = ac;
      setStreamingId(ex.id);
      update(target, () => [...before, ex]);
      // Always the chat it was asked in, even if another is opened meanwhile.
      const patch = (fn: (cur: FreeExchange) => FreeExchange) => update(target, (all) => all.map((e) => (e.id === ex.id ? fn(e) : e)));
      try {
        await streamEdge(
          FREE_FN,
          { text: question, lang: locale, app: 'operator', route: pathRef.current, history: historyOf(before) },
          { signal: ac.signal, onEvent: (name, data) => patch((cur) => applyFreeEvent(cur, name, data)) },
        );
      } catch (err) {
        if (isAbort(err)) patch((cur) => ({ ...cur, done: true, stopped: true }));
        else patch((cur) => ({ ...cur, done: true, error: cur.error ?? freeErrorOf(err) }));
      } finally {
        if (controller.current === ac) controller.current = null;
        setStreamingId(null);
        patch((cur) => (cur.done ? cur : { ...cur, done: true }));
      }
    },
    [locale, create, update],
  );

  const stop = useCallback(() => controller.current?.abort(), []);

  const retry = (id: string) => {
    const all = exchangesRef.current;
    const failed = all.find((e) => e.id === id);
    if (!failed) return;
    void ask(failed.question, all.filter((e) => e.id !== id));
  };

  const clear = () => {
    controller.current?.abort();
    controller.current = null;
    setStreamingId(null);
    startNew();
  };

  // Keep the newest thing in view as it arrives.
  const scroller = useRef<HTMLDivElement>(null);
  const last = exchanges[exchanges.length - 1];
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [exchanges.length, last?.answer]);

  const streaming = streamingId !== null;
  const [modelOpen, setModelOpen] = useState(false);
  const modelButton = canUsePaid ? (
    <ToolbarPopover
      open={modelOpen}
      onOpenChange={setModelOpen}
      side="above"
      align="start"
      panelLabel={tr('ws.owner.assistant.model.title')}
      title={tr('ws.owner.assistant.model.title')}
      testId="assistant-model"
      // As wide as the model row, so Free AI never wraps under the Claude pair (Arabic is longer).
      panelStyle={{ inlineSize: 'max-content', maxInlineSize: 'calc(100vw - 2 * var(--tp-sp-4))' }}
      triggerStyle={MODEL_TRIGGER_STYLE}
      label={
        <>
          <Icon name="spark" size={14} />
          {tr('ws.owner.assistant.model.free')}
        </>
      }
    >
      <ModelSwitch
        compact
        freeActive
        conversationId={null}
        value={null}
        onChange={() => undefined}
        disabled={streaming}
        onChooseFree={() => undefined}
        onChoosePaid={(m) => {
          setPendingNewChatModel(m);
          setMode('paid');
        }}
      />
    </ToolbarPopover>
  ) : null;

  // F1 (2026-10-20): the paid assistant's C for a new chat, D for the rest.
  const isNew = exchanges.length === 0;
  const askPaid = (question: string) => {
    setPendingQuestion(question);
    setMode('paid');
  };
  const column = { inlineSize: '100%', maxInlineSize: '51.25rem', marginInline: 'auto' } as const;
  const composer = (
    <Composer
      onAsk={(q) => void ask(q)}
      onStop={stop}
      streaming={streaming}
      autoFocus={autoFocus}
      maxLength={FREE_TEXT_MAX}
      placeholder={tr('ws.assistantFree.composer.placeholder')}
      hint={tr('ws.assistantFree.composer.hint')}
      hideHint
      below={modelButton}
    />
  );
  const freePill = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', minBlockSize: '1.5rem', paddingInline: 'var(--tp-sp-2-5)', borderRadius: 'var(--tp-radius-pill)', background: 'var(--tp-card-1)', color: 'var(--tp-card-ink)', fontSize: 'var(--tp-fs-xs)', fontWeight: 700, whiteSpace: 'nowrap' }}>
      <Icon name="lock" size={12} />
      {isNew ? tr('ws.assistantFree.start.pill') : tr('ws.assistantFree.badge')}
    </span>
  );
  const title = free.active?.title ?? exchanges[0]?.question ?? '';

  return (
    <div data-free-thread="" data-testid="assistant.free" style={{ display: 'flex', flexDirection: 'column', minBlockSize: 0, blockSize: '100%', gap: 'var(--tp-sp-3)' }}>
      {isNew ? (
        (headerEnd || !canUsePaid) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
            {!canUsePaid && <StatusBadge tone="success" size="sm" icon="spark" label={tr('ws.assistantFree.badge')} />}
            <span style={{ flex: 1 }} />
            {headerEnd}
          </div>
        )
      ) : (
        <div
          role="toolbar"
          aria-label={tr('ws.owner.assistant.toolbar.label')}
          className="tp-assistant-toolbar"
          style={{ display: 'grid', // The subject centres in the room between the two ends, so its gaps match (Sait, 2026-10-20).
            gridTemplateColumns: 'auto minmax(0, 1fr) auto', alignItems: 'center', gap: 'var(--tp-sp-2-5)', borderRadius: 'var(--tp-radius-panel)', paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', minInlineSize: 0 }}>
            {toolbarStart ?? (
              <Button kind="primary" icon="plus" className="tp-assistant-green tp-assistant-new" onClick={clear} data-testid="assistant.free.newChat" style={{ fontWeight: 600 }}>
                {tr('ws.assistantFree.newChat')}
              </Button>
            )}
          </div>
          <h1 style={{ margin: 0, fontSize: compact ? 'var(--tp-fs-lg)' : 'var(--tp-fs-xl)', fontWeight: 700, minInlineSize: 0, display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', justifyContent: 'center' }}>
            <bdi style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minInlineSize: 0 }}>{title}</bdi>
            {freePill}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--tp-sp-2)', minInlineSize: 0 }}>{headerEnd}</div>
        </div>
      )}

      <div
        ref={scroller}
        data-thread-scroll=""
        style={{
          flex: 1,
          minBlockSize: 0,
          overflowY: 'auto',
          display: isNew ? 'flex' : 'grid',
          flexDirection: 'column',
          alignContent: 'start',
          ...(compact
            ? { background: 'var(--tp-bg)', borderRadius: 'var(--tp-radius-panel)', padding: 'var(--tp-sp-3)' }
            : { paddingInlineEnd: 'var(--tp-sp-1)' }),
        }}
      >
        {isNew ? (
          <div data-free-start="" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: compact ? 'var(--tp-sp-3)' : 'var(--tp-sp-5)', paddingBlockStart: compact ? 'var(--tp-sp-3)' : 'calc(var(--tp-sp-6) * 2)', paddingBlockEnd: 'var(--tp-sp-2)' }}>
            <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'center', textAlign: 'center', maxInlineSize: '40rem' }}>
              {freePill}
              {compact ? (
                <h2 style={{ margin: 0, fontSize: 'var(--tp-fs-xl)', fontWeight: 700 }}>{tr('ws.assistantFree.start.title')}</h2>
              ) : (
                <h1 style={{ margin: 0, fontSize: 'var(--tp-fs-3xl)', fontWeight: 700 }}>{tr('ws.assistantFree.start.title')}</h1>
              )}
              <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr('ws.assistantFree.start.lead')}</p>
            </div>
            <div style={{ inlineSize: '100%', maxInlineSize: '65rem', marginBlock: 'auto', display: 'grid', gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'repeat(auto-fit, minmax(17rem, 1fr))', gap: 'var(--tp-sp-3)' }}>
              {FREE_TOPICS.map((topic) => (
                <section key={topic.key} className="tp-breakdown-card" data-tone={topic.tone} aria-labelledby={`free-topic-${topic.key}`} style={{ borderRadius: 'var(--tp-radius-panel)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <h3 id={`free-topic-${topic.key}`} className="tp-breakdown-head" style={{ margin: 0, paddingBlock: 'var(--tp-sp-2-5)', paddingInline: 'var(--tp-sp-3)', fontSize: 'var(--tp-fs-lg)', fontWeight: 700 }}>
                    {tr(`ws.assistantFree.topics.${topic.key}.title`)}
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {topic.questions.map((q) => {
                      const question = tr(`ws.assistantFree.${q.key}` as never);
                      return (
                        <button key={q.id} type="button" className="tp-starter-row" disabled={streaming} onClick={() => void ask(question)} data-testid={`assistant.free.starter.${q.id}`}>
                          {question}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ ...column, display: 'grid', gap: 'var(--tp-sp-4)', alignContent: 'start' }}>
            {exchanges.map((ex) => (
              <div key={ex.id} style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
                <Message role="user" text={ex.question} compact={compact} />
                <FreeAnswer
                  ex={ex}
                  streaming={ex.id === streamingId}
                  compact={compact}
                  onNavigate={onNavigate}
                  onRetry={() => retry(ex.id)}
                  onAskPaid={canUsePaid ? () => askPaid(ex.question) : undefined}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* At the foot in a new chat too (Sait, 2026-10-20): heading, cards, then
          the box, the Free AI button, and under it, centred, where answers come from. */}
      <div style={{ ...column, display: 'grid', gap: 'var(--tp-sp-1)' }}>
        {composer}
        <p data-free-footer="" style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', textAlign: 'center' }}>
          {tr(canUsePaid ? 'ws.assistantFree.start.footerOwner' : 'ws.assistantFree.start.footerStaff')}
        </p>
      </div>
    </div>
  );
}

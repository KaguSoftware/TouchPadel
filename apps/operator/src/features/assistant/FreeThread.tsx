/**
 * The free AI's chat (owner call 2026-10-16): every staff role's assistant in
 * the drawer, and the owner's when he picks "The free AI". It asks
 * `assistant-free` (Groq), which finds pages and explains how things work; it
 * reads no business data and stores nothing, so the thread lives here
 * (freeThreadLogic.ts), mirrored to this tab's session, and each question carries
 * the last few turns.
 *
 * An answer's page routes become "Go to" buttons, but only for pages this
 * person may open (canAccess), so a cashier is never sent to an owner page.
 * Staff see a "Free" badge and nothing paid; the owner gets a way back to the
 * paid assistant.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  applyFreeEvent,
  canRetry,
  freeErrorMessage,
  freeErrorOf,
  historyOf,
  loadFreeThread,
  newExchange,
  saveFreeThread,
  type FreeExchange,
} from './freeThreadLogic';

const FREE_FN = FREE_ASSISTANT_FN satisfies EdgeFunctionName;
const STARTERS = ['tasks', 'break', 'incident'] as const;

function isAbort(err: unknown): boolean {
  return (err instanceof DOMException && err.name === 'AbortError') || (err instanceof Error && err.name === 'AbortError');
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `free-${Date.now().toString(36)}-${seq}`;
}

/** "Go to" buttons for the pages an answer names that exist AND this person may open. */
function FreePageLinks({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
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
    <div data-page-links="" style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
      {routes.map((path) => {
        const item = navItemFor(path);
        return (
          <Button
            key={path}
            kind="soft"
            size="sm"
            icon={item?.icon ?? 'arrowUpRight'}
            title={path}
            data-testid={`assistant.free.goto.${path}`}
            onClick={() => {
              void router.navigate({ to: path });
              onNavigate?.();
            }}
          >
            {tr('ws.assistantFree.goTo', { page: item ? tr(`ws.shell.nav.${item.labelKey}`) : `⁨${path}⁩` })}
          </Button>
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
}: {
  ex: FreeExchange;
  streaming: boolean;
  compact?: boolean;
  onNavigate?: () => void;
  onRetry: () => void;
}) {
  const { tr, locale } = useLocale();
  const err = ex.error ? freeErrorMessage(ex.error) : null;
  return (
    <div data-message-role="assistant" data-free-answer="" style={{ display: 'grid', gap: 'var(--tp-sp-2)', marginInlineEnd: compact ? 0 : '10%' }}>
      <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', fontWeight: 600, display: 'flex', gap: 'var(--tp-sp-1)', alignItems: 'center' }}>
        {tr('ws.assistantFree.assistant')}
        {streaming && <Spinner size="xs" />}
      </span>
      {(ex.answer !== '' || streaming) && (
        <div
          data-answer-bubble=""
          style={{
            display: 'grid',
            gap: 'var(--tp-sp-2)',
            background: 'var(--tp-surface)',
            color: 'var(--tp-fg)',
            border: '1px solid var(--tp-border-strong, var(--tp-border))',
            borderRadius: 'var(--tp-radius-panel)',
            boxShadow: 'var(--tp-shadow-raised)',
            paddingBlock: 'var(--tp-sp-3)',
            paddingInline: 'var(--tp-sp-4)',
            minInlineSize: 0,
          }}
        >
          {ex.answer !== '' ? (
            <AssistantText text={ex.answer} unverified={[]} />
          ) : (
            <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.assistantFree.thinking')}</p>
          )}
          {!streaming && ex.answer !== '' && <FreePageLinks text={ex.answer} onNavigate={onNavigate} />}
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

export function FreeThread({ compact, autoFocus, onNavigate }: { compact?: boolean; autoFocus?: boolean; onNavigate?: () => void }) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const { canUsePaid, setMode } = useAssistantMode();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const userId = staff?.id ?? '';

  const [exchanges, setExchanges] = useState<FreeExchange[]>(() => loadFreeThread(userId));
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const exchangesRef = useRef(exchanges);
  exchangesRef.current = exchanges;
  const controller = useRef<AbortController | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  // A different person signed in on this station: their own thread, not the last one's.
  const userRef = useRef(userId);
  useEffect(() => {
    if (userRef.current === userId) return;
    userRef.current = userId;
    controller.current?.abort();
    setExchanges(loadFreeThread(userId));
  }, [userId]);

  useEffect(() => saveFreeThread(userId, exchanges), [userId, exchanges]);
  useEffect(() => () => controller.current?.abort(), []);

  const ask = useCallback(
    async (text: string, base?: FreeExchange[]) => {
      const question = text.trim().slice(0, FREE_TEXT_MAX);
      if (question === '' || controller.current) return;
      const before = base ?? exchangesRef.current;
      const ex = newExchange(nextId(), question);
      const ac = new AbortController();
      controller.current = ac;
      setStreamingId(ex.id);
      setExchanges([...before, ex]);
      const patch = (fn: (cur: FreeExchange) => FreeExchange) => setExchanges((all) => all.map((e) => (e.id === ex.id ? fn(e) : e)));
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
    [locale],
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
    setExchanges([]);
  };

  // Keep the newest thing in view as it arrives.
  const scroller = useRef<HTMLDivElement>(null);
  const last = exchanges[exchanges.length - 1];
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [exchanges.length, last?.answer]);

  const streaming = streamingId !== null;

  return (
    <div data-free-thread="" data-testid="assistant.free" style={{ display: 'flex', flexDirection: 'column', minBlockSize: 0, blockSize: '100%', gap: 'var(--tp-sp-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
        <StatusBadge tone="success" size="sm" icon="spark" label={canUsePaid ? tr('ws.assistantFree.name') : tr('ws.assistantFree.badge')} />
        <span style={{ flex: 1 }} />
        {exchanges.length > 0 && (
          <Button size="sm" kind="ghost" icon="plus" onClick={clear} data-testid="assistant.free.newChat">
            {tr('ws.assistantFree.newChat')}
          </Button>
        )}
        {canUsePaid && (
          <Button size="sm" kind="soft" icon="sliders" onClick={() => setMode('paid')} disabled={streaming} data-testid="assistant.free.usePaid">
            {tr('ws.assistantFree.usePaid')}
          </Button>
        )}
      </div>

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
        {exchanges.length === 0 && (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', maxInlineSize: '60ch' }}>
            <p style={{ color: 'var(--tp-muted-fg)', margin: 0, lineHeight: 1.5 }}>{tr('ws.assistantFree.lead')}</p>
            <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', justifyItems: 'start' }}>
              <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', fontWeight: 600 }}>{tr('ws.assistantFree.starters.title')}</span>
              <div style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
                {STARTERS.map((k) => (
                  <Button key={k} size="sm" kind="soft" onClick={() => void ask(tr(`ws.assistantFree.starters.${k}`))} data-testid={`assistant.free.starter.${k}`}>
                    {tr(`ws.assistantFree.starters.${k}`)}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}

        {exchanges.map((ex) => (
          <div key={ex.id} style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
            <Message role="user" text={ex.question} compact={compact} />
            <FreeAnswer ex={ex} streaming={ex.id === streamingId} compact={compact} onNavigate={onNavigate} onRetry={() => retry(ex.id)} />
          </div>
        ))}
      </div>

      <div style={{ borderBlockStart: '1px solid var(--tp-border)', paddingBlockStart: 'var(--tp-sp-2)' }}>
        <Composer
          onAsk={(q) => void ask(q)}
          onStop={stop}
          streaming={streaming}
          autoFocus={autoFocus}
          maxLength={FREE_TEXT_MAX}
          placeholder={tr('ws.assistantFree.composer.placeholder')}
          hint={tr('ws.assistantFree.composer.hint')}
        />
      </div>
    </div>
  );
}

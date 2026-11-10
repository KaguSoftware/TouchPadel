/**
 * The streaming state machine behind Thread (plan §5.2, contracts §Lane C
 * event table). One question = one `LiveTurn`: the owner's bubble appears at
 * once, the assistant's text grows delta by delta, tool rows appear as
 * `tool_start`/`tool_end` arrive, then the gate marks, the usage footer and
 * any job estimate land, and `done` closes it. The stored rows replace the
 * live turn once the messages query has them (Thread does that matching), so
 * a turn that failed half-way stays on screen with its error sentence.
 *
 * The turn and its reducer (`applyEvent`) are @touch/core/assistant/client's,
 * shared with the phone; this hook is the I/O around them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AssistantScope } from '@touch/core/assistant/tools';
import {
  applyEvent,
  asAssistantErrorCode,
  emptyTurn,
  settleTools,
  type AssistantErrorCode,
  type DateRange,
  type LiveTurn,
} from '@touch/core/assistant/client';
import { EdgeError } from '../../lib/edge';
import { QK, sendMessage } from './api';

export interface UseAssistantChatOptions {
  conversationId: string | null;
  /** The server created a conversation for the first question. */
  onConversation: (id: string) => void;
  /** Scopes for a NEW conversation; an existing one carries its own. */
  scopes: readonly AssistantScope[];
  range?: DateRange;
  /** Model for a NEW conversation (null = venue default); an existing one carries its own row. */
  model?: string | null;
  lang: 'en' | 'ar';
}

export interface UseAssistantChat {
  live: LiveTurn | null;
  streaming: boolean;
  lastQuestion: string | null;
  /**
   * Ask a question. `scopes` replaces the checked set for a NEW chat (a
   * starter question carries its own); an existing chat keeps its row's. A new
   * chat with nothing checked sends nothing: the owner picks first.
   */
  ask: (text: string, opts?: { scopes?: readonly AssistantScope[] }) => Promise<void>;
  stop: () => void;
  dismissLive: () => void;
}

/** Map a thrown value to the error sentence's code. */
export function errorCodeOf(err: unknown): AssistantErrorCode {
  if (err instanceof EdgeError) {
    // The JSON refusal's own code (LLM_MONTHLY_CAP …) beats the HTTP class.
    const fromBody = asAssistantErrorCode(err.serverCode);
    if (fromBody !== 'UNKNOWN') return fromBody;
    return asAssistantErrorCode(err.kind);
  }
  return 'UNKNOWN';
}

function isAbort(err: unknown): boolean {
  return (err instanceof DOMException && err.name === 'AbortError') || (err instanceof Error && err.name === 'AbortError');
}

export function useAssistantChat(opts: UseAssistantChatOptions): UseAssistantChat {
  const qc = useQueryClient();
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  // The latest options, so an in-flight ask reads the conversation the
  // server just created without a stale closure.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Switching conversation drops a live turn that belongs to another one.
  useEffect(() => {
    // (The id the server assigns lands on the turn in the same batch as the
    // parent learns it, so a first question is not dropped here.)
    setLive((cur) => (cur && cur.conversationId !== opts.conversationId ? null : cur));
  }, [opts.conversationId]);

  useEffect(() => () => controller.current?.abort(), []);

  const stop = useCallback(() => {
    controller.current?.abort();
  }, []);

  const dismissLive = useCallback(() => setLive(null), []);

  const ask = useCallback(async (text: string, askOpts?: { scopes?: readonly AssistantScope[] }) => {
    const question = text.trim();
    if (question === '' || controller.current) return;
    const { conversationId, range, model, lang, onConversation } = optsRef.current;
    const scopes = askOpts?.scopes ?? optsRef.current.scopes;
    if (!conversationId && scopes.length === 0) return;
    const ac = new AbortController();
    controller.current = ac;
    setStreaming(true);
    setLastQuestion(question);
    setLive(emptyTurn(conversationId, question));

    let convId = conversationId;
    try {
      await sendMessage(
        {
          conversation_id: conversationId,
          text: question,
          lang,
          // A new chat carries its checked set and its model; an existing row already has both.
          ...(conversationId ? {} : { scopes: [...scopes], ...(model ? { model } : {}) }),
          ...(range ? { range } : {}),
        },
        {
          signal: ac.signal,
          onEvent: (name, data) => {
            const startedId = name === 'message_start' && typeof data === 'object' && data !== null ? (data as { conversation_id?: unknown }).conversation_id : null;
            if (typeof startedId === 'string' && startedId !== convId) {
              convId = startedId;
              onConversation(convId);
            }
            setLive((cur) => (cur ? applyEvent(cur, name, data) : cur));
          },
        },
      );
    } catch (err) {
      if (isAbort(err)) {
        setLive((cur) => (cur ? { ...cur, done: true, stopped: true, tools: settleTools(cur.tools) } : cur));
      } else {
        const code = errorCodeOf(err);
        const message = err instanceof Error ? err.message : '';
        setLive((cur) => (cur ? { ...cur, done: true, error: cur.error ?? { code, message } } : cur));
      }
    } finally {
      controller.current = null;
      setStreaming(false);
      setLive((cur) => (cur && !cur.done ? { ...cur, done: true } : cur));
      // Whatever happened, the stored rows are the record: refetch them so
      // the persisted turn replaces the live one (or shows what survived).
      if (convId) {
        void qc.invalidateQueries({ queryKey: QK.messages(convId) });
        void qc.invalidateQueries({ queryKey: QK.jobs(convId) });
      }
      void qc.invalidateQueries({ queryKey: QK.conversations });
      // The turn just spent tokens: the meter and the cap must move with it.
      void qc.invalidateQueries({ queryKey: ['assistant', 'usage'] });
    }
  }, [qc]);

  return { live, streaming, lastQuestion, ask, stop, dismissLive };
}

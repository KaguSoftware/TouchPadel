/**
 * The streaming state machine behind the chat screen. One question = one
 * `LiveTurn`: the owner's bubble appears at once, the answer grows delta by
 * delta, tool rows come and go, the gate marks land and `done` closes it. The
 * stored rows replace the live turn once the messages query has them (the
 * screen does that matching), so a turn that failed half-way stays on screen
 * with its error sentence. The operator's `useAssistantChat`, minus the usage
 * and model plumbing the phone does not show.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AssistantScope } from '@touch/core/assistant/tools';
import { captureException } from '../../lib/telemetry';
import { assistantKeys, sendMessage } from './api';
import {
  AssistantStreamError,
  applyEvent,
  emptyTurn,
  type AssistantErrorCode,
  type LiveTurn,
} from './chat';

export interface UseAssistantChatOptions {
  conversationId: string | null;
  /** The server created a conversation for the first question. */
  onConversation: (id: string) => void;
  /** Scopes for a NEW conversation; an existing one carries its own. */
  scopes: readonly AssistantScope[];
  /** Model for a NEW chat (null = venue default); an existing chat carries its own row. */
  model: string | null;
  venueId: string | null;
  lang: 'en' | 'ar';
}

export interface UseAssistantChat {
  live: LiveTurn | null;
  streaming: boolean;
  lastQuestion: string | null;
  /** `scopes` overrides the hook's set for this one question (a starter names what it needs). */
  ask: (text: string, scopes?: readonly AssistantScope[]) => Promise<void>;
  stop: () => void;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function codeOf(err: unknown): AssistantErrorCode {
  return err instanceof AssistantStreamError ? err.code : 'UNKNOWN';
}

export function useAssistantChat(opts: UseAssistantChatOptions): UseAssistantChat {
  const qc = useQueryClient();
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  // The latest options, so an in-flight ask reads the conversation the server
  // just created without a stale closure.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Switching conversation drops a live turn that belongs to another one. (The
  // id the server assigns lands on the turn in the same batch as the parent
  // learns it, so a first question is not dropped here.)
  useEffect(() => {
    setLive((cur) => (cur && cur.conversationId !== opts.conversationId ? null : cur));
  }, [opts.conversationId]);

  useEffect(() => () => controller.current?.abort(), []);

  const stop = useCallback(() => controller.current?.abort(), []);

  const ask = useCallback(
    async (text: string, scopesOverride?: readonly AssistantScope[]) => {
      const question = text.trim();
      if (question === '' || controller.current) return;
      const { conversationId, scopes, model, venueId, lang, onConversation } = optsRef.current;
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
            ...(conversationId
              ? {}
              : { scopes: [...(scopesOverride ?? scopes)], ...(model ? { model } : {}) }),
            ...(venueId ? { venue_scope: venueId } : {}),
          },
          {
            signal: ac.signal,
            onEvent: (name, data) => {
              if (
                name === 'message_start' &&
                typeof data === 'object' &&
                data !== null &&
                typeof (data as { conversation_id?: unknown }).conversation_id === 'string'
              ) {
                const id = (data as { conversation_id: string }).conversation_id;
                if (id !== convId) {
                  convId = id;
                  onConversation(id);
                }
              }
              setLive((cur) => (cur ? applyEvent(cur, name, data) : cur));
            },
          },
        );
      } catch (err) {
        if (isAbort(err)) {
          setLive((cur) =>
            cur
              ? { ...cur, done: true, stopped: true, tools: cur.tools.map((t) => ({ ...t, pending: false })) }
              : cur,
          );
        } else {
          // A refusal carries its code; a dropped connection is UNKNOWN, which
          // reads "ask again" and keeps the question on screen to do so.
          if (!(err instanceof AssistantStreamError)) captureException(err, { scope: 'assistant.ask' });
          const code = codeOf(err);
          setLive((cur) =>
            cur
              ? {
                  ...cur,
                  done: true,
                  // Only the code reaches the screen (staff.assistant.errors.<code>); the
                  // server's own words went to the tracker above, not into the state.
                  error: cur.error ?? { code, message: '' },
                  tools: cur.tools.map((t) => ({ ...t, pending: false })),
                }
              : cur,
          );
        }
      } finally {
        controller.current = null;
        setStreaming(false);
        setLive((cur) => (cur && !cur.done ? { ...cur, done: true } : cur));
        // Whatever happened, the stored rows are the record: refetch them so the
        // persisted turn replaces the live one (or shows what survived).
        if (convId) {
          void qc.invalidateQueries({ queryKey: assistantKeys.messages(convId) });
          // The row carries the chat's running spend (the settings sheet).
          void qc.invalidateQueries({ queryKey: assistantKeys.conversation(convId) });
        }
        void qc.invalidateQueries({ queryKey: assistantKeys.conversations });
        void qc.invalidateQueries({ queryKey: assistantKeys.usage });
      }
    },
    [qc],
  );

  return { live, streaming, lastQuestion, ask, stop };
}

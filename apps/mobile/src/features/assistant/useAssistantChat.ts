/**
 * The streaming state machine behind the chat screen. One question = one
 * `LiveTurn`: the owner's bubble appears at once, the answer grows delta by
 * delta, tool rows come and go, the gate marks land and `done` closes it. The
 * stored rows replace the live turn once the messages query has them (the
 * screen does that matching), so a turn that failed half-way stays on screen
 * with its error sentence. The operator's `useAssistantChat` on the phone's
 * fetch: the turn and its reducer are @touch/core/assistant/client's, so the
 * live turn carries everything the stream sends (scopes, model, usage, tool
 * stats, both message ids) even where the phone does not show it yet.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AssistantScope } from '@touch/core/assistant/tools';
import {
  applyEvent,
  emptyTurn,
  settleTools,
  type AssistantErrorCode,
} from '@touch/core/assistant/client';
import { captureException } from '../../lib/telemetry';
import { assistantKeys, sendMessage } from './api';
import { AssistantStreamError } from './chat';
import { NO_END, type LiveEnd, type PhoneLiveTurn } from './thread';
import { StreamLostError, ownerStopped } from './stream';

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
  live: PhoneLiveTurn | null;
  /** How the live turn ended beyond the reducer's state: `done`'s stop_reason, a lost stream. */
  end: LiveEnd;
  streaming: boolean;
  lastQuestion: string | null;
  /** `scopes` overrides the hook's set for this one question (a starter names what it needs). */
  ask: (text: string, scopes?: readonly AssistantScope[]) => Promise<void>;
  stop: () => void;
}

/**
 * How long after a Stop, a lost stream or leaving the screen the stored rows are read once more.
 * The server keeps going when the client lets go and writes the turn when it ends (50 s at most),
 * so the first refetch can come too early; this one picks up what it finished storing. The
 * operator's chatStreams.ts does the same.
 */
export const LATE_REFETCH_MS = 3000;

function codeOf(err: unknown): AssistantErrorCode {
  return err instanceof AssistantStreamError ? err.code : 'UNKNOWN';
}

export function useAssistantChat(opts: UseAssistantChatOptions): UseAssistantChat {
  const qc = useQueryClient();
  const [live, setLive] = useState<PhoneLiveTurn | null>(null);
  const [end, setEnd] = useState<LiveEnd>(NO_END);
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

  // Leaving the screen aborts the request (nothing streams in the background on the phone).
  // The server still finishes and stores the turn, so the late refetch below, and the stale
  // messages query, bring the answer back when the owner returns to the chat.
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
      setEnd(NO_END);
      // The ids this chat already had: a turn that ends before `message_start` is told
      // from its own stored rows by them (thread.ts mergeThread).
      const knownIds = conversationId
        ? (qc.getQueryData<{ id: string }[]>(assistantKeys.messages(conversationId)) ?? []).map((r) => r.id)
        : [];
      setLive({ ...emptyTurn(conversationId, question), knownIds });
      let lateRefetch = false;

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
              if (name === 'done' && typeof data === 'object' && data !== null) {
                const reason = (data as { stop_reason?: unknown }).stop_reason;
                if (typeof reason === 'string') setEnd((e) => ({ ...e, stopReason: reason }));
              }
              setLive((cur) => (cur ? applyEvent(cur, name, data) : cur));
            },
          },
        );
      } catch (err) {
        // The owner's Stop, read from the controller: expo/fetch reports a request
        // cancelled before its headers as a plain Error, not an AbortError. Never telemetry.
        if (ownerStopped(ac.signal)) {
          lateRefetch = true;
          setLive((cur) =>
            cur
              ? { ...cur, done: true, stopped: true, tools: settleTools(cur.tools) }
              : cur,
          );
        } else {
          // A refusal carries its code; a dropped connection is UNKNOWN, which
          // reads "ask again" and keeps the question on screen to do so.
          if (!(err instanceof AssistantStreamError)) captureException(err, { scope: 'assistant.ask' });
          if (err instanceof StreamLostError) {
            lateRefetch = true;
            setEnd((e) => ({ ...e, lost: true }));
          }
          const code = codeOf(err);
          setLive((cur) =>
            cur
              ? {
                  ...cur,
                  done: true,
                  // Only the code reaches the screen (staff.assistant.errors.<code>); the
                  // server's own words went to the tracker above, not into the state.
                  error: cur.error ?? { code, message: '' },
                  tools: settleTools(cur.tools),
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
        if (lateRefetch) {
          // Once, a little later: the server may still be storing the turn it was cut off from.
          const id = convId;
          setTimeout(() => {
            if (id) {
              void qc.invalidateQueries({ queryKey: assistantKeys.messages(id) });
              void qc.invalidateQueries({ queryKey: assistantKeys.conversation(id) });
            }
            void qc.invalidateQueries({ queryKey: assistantKeys.conversations });
            void qc.invalidateQueries({ queryKey: assistantKeys.usage });
          }, LATE_REFETCH_MS);
        }
      }
    },
    [qc],
  );

  return { live, end, streaming, lastQuestion, ask, stop };
}

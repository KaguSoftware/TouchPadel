/**
 * The streaming state machine behind Thread (plan §5.2, contracts §Lane C
 * event table). One question = one `LiveTurn`: the owner's bubble appears at
 * once, the assistant's text grows delta by delta, tool rows appear as
 * `tool_start`/`tool_end` arrive, then the gate marks, the usage footer and
 * any job estimate land, and `done` closes it. The stored rows replace the
 * live turn once the messages query has them (threadLogic.reconcileLive), so
 * a turn that failed before anything was stored stays on screen with its
 * error sentence.
 *
 * The turn and its reducer (`applyEvent`) are @touch/core/assistant/client's,
 * shared with the phone. The stream itself runs in chatStreams.ts, one per
 * conversation and above every screen, so closing the drawer or switching
 * chats neither aborts a paid answer nor blocks another chat's composer; this
 * hook is the view of the conversation it is given.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AssistantScope } from '@touch/core/assistant/tools';
import { asAssistantErrorCode, type DateRange } from '@touch/core/assistant/client';
import { EdgeError } from '../../lib/edge';
import { askInChat, chatEntry, followChat, keyOf, settleAlias, stopChat, subscribeChats } from './chatStreams';
import type { ChatErrorCode, ChatTurn } from './threadLogic';

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
  live: ChatTurn | null;
  /** This conversation is answering; another chat's stream never sets it. */
  streaming: boolean;
  lastQuestion: string | null;
  /**
   * Ask a question. `scopes` replaces the checked set for a NEW chat (a
   * starter question carries its own); an existing chat keeps its row's. A new
   * chat with nothing checked sends nothing: the owner picks first.
   */
  ask: (text: string, opts?: { scopes?: readonly AssistantScope[] }) => Promise<void>;
  stop: () => void;
}

/**
 * Map a thrown value to the error sentence's code. A refusal's own code wins;
 * anything else that is not a refusal is the connection: a fetch that failed,
 * a stream that went silent (StreamStalledError), a deadline (all TypeErrors).
 */
export function errorCodeOf(err: unknown): ChatErrorCode {
  if (err instanceof EdgeError) {
    // The JSON refusal's own code (LLM_MONTHLY_CAP …) beats the HTTP class.
    const fromBody = asAssistantErrorCode(err.serverCode);
    if (fromBody !== 'UNKNOWN') return fromBody;
    return asAssistantErrorCode(err.kind);
  }
  if (err instanceof TypeError) return 'CONNECTION';
  return 'UNKNOWN';
}

export function useAssistantChat(opts: UseAssistantChatOptions): UseAssistantChat {
  const qc = useQueryClient();
  const key = keyOf(opts.conversationId);
  const entry = useSyncExternalStore(subscribeChats, () => chatEntry(key));
  // The latest options, so an ask reads the current scopes and model without a stale closure.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // A view of a new chat follows it to the id its first question creates.
  useEffect(() => followChat(key, (id) => optsRef.current.onConversation(id)), [key]);
  // Once this view shows that id, the new-chat alias has done its job.
  useEffect(() => {
    if (opts.conversationId) settleAlias(opts.conversationId);
  }, [opts.conversationId, entry]);

  const stop = useCallback(() => stopChat(keyOf(optsRef.current.conversationId)), []);

  const ask = useCallback(
    async (text: string, askOpts?: { scopes?: readonly AssistantScope[] }) => {
      const { conversationId, range, model, lang } = optsRef.current;
      await askInChat({
        conversationId,
        question: text.trim(),
        scopes: askOpts?.scopes ?? optsRef.current.scopes,
        model,
        range,
        lang,
        qc,
        codeOf: errorCodeOf,
      });
    },
    [qc],
  );

  return { live: entry.live, streaming: entry.streaming, lastQuestion: entry.lastQuestion, ask, stop };
}

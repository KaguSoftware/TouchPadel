/**
 * The streaming state machine behind Thread (plan §5.2, contracts §Lane C
 * event table). One question = one `LiveTurn`: the owner's bubble appears at
 * once, the assistant's text grows delta by delta, tool rows appear as
 * `tool_start`/`tool_end` arrive, then the gate marks, the usage footer and
 * any job estimate land, and `done` closes it. The stored rows replace the
 * live turn once the messages query has them (Thread does that matching), so
 * a turn that failed half-way stays on screen with its error sentence.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AssistantScope } from '@touch/core/assistant/tools';
import { EdgeError } from '../../lib/edge';
import {
  QK,
  asAssistantErrorCode,
  sendMessage,
  type AssistantErrorCode,
  type DateRange,
  type GatePayload,
  type JobEstimate,
  type SourceItem,
  type UsagePayload,
} from './api';

export interface ToolRow extends SourceItem {
  pending: boolean;
}

export interface LiveTurn {
  conversationId: string | null;
  userText: string;
  userMessageId: string | null;
  assistantMessageId: string | null;
  text: string;
  tools: ToolRow[];
  scopes: string[] | null;
  /** The model answering this turn (`message_start`), confirmed by `usage`. */
  model: string | null;
  gate: GatePayload | null;
  usage: UsagePayload | null;
  jobEstimate: JobEstimate | null;
  done: boolean;
  stopped: boolean;
  error: { code: AssistantErrorCode; message: string } | null;
}

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
  ask: (text: string) => Promise<void>;
  stop: () => void;
  dismissLive: () => void;
}

function emptyTurn(conversationId: string | null, userText: string): LiveTurn {
  return {
    conversationId,
    userText,
    userMessageId: null,
    assistantMessageId: null,
    text: '',
    tools: [],
    scopes: null,
    model: null,
    gate: null,
    usage: null,
    jobEstimate: null,
    done: false,
    stopped: false,
    error: null,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Apply one SSE event to a turn. Pure, so the reducer is testable on its own. */
export function applyEvent(turn: LiveTurn, name: string, data: unknown): LiveTurn {
  const d = isRecord(data) ? data : {};
  switch (name) {
    case 'message_start':
      return {
        ...turn,
        conversationId: str(d.conversation_id) ?? turn.conversationId,
        userMessageId: str(d.user_message_id),
        assistantMessageId: str(d.assistant_message_id),
        scopes: Array.isArray(d.scopes) ? d.scopes.filter((s): s is string => typeof s === 'string') : turn.scopes,
        model: str(d.model) ?? turn.model,
      };
    case 'delta':
      // `reset: true` precedes a gate retry: the first answer is withdrawn and
      // re-streamed with only the figures the tools returned.
      if (d.reset === true) return { ...turn, text: str(d.text) ?? '' };
      return { ...turn, text: turn.text + (str(d.text) ?? '') };
    case 'tool_start': {
      const row: ToolRow = {
        call_id: str(d.call_id) ?? `call-${turn.tools.length}`,
        name: str(d.name) ?? '?',
        args: isRecord(d.args) ? d.args : {},
        row_count: null,
        ms: null,
        route: null,
        pending: true,
      };
      return { ...turn, tools: [...turn.tools, row] };
    }
    case 'tool_end': {
      const id = str(d.call_id);
      const patch = {
        row_count: num(d.row_count),
        ms: num(d.ms),
        route: str(d.route),
        error: str(d.error) ?? undefined,
        stats: isRecord(d.stats) ? d.stats : undefined,
        pending: false,
      };
      const idx = turn.tools.findIndex((t) => t.call_id === id);
      if (idx === -1) {
        return { ...turn, tools: [...turn.tools, { call_id: id ?? `call-${turn.tools.length}`, name: str(d.name) ?? '?', args: {}, ...patch }] };
      }
      const tools = turn.tools.slice();
      tools[idx] = { ...tools[idx]!, ...patch };
      return { ...turn, tools };
    }
    case 'sources': {
      const items = Array.isArray(d.items) ? (d.items as SourceItem[]) : null;
      const scopes = Array.isArray(d.scopes) ? d.scopes.filter((s): s is string => typeof s === 'string') : turn.scopes;
      if (!items) return { ...turn, scopes };
      // The summary is authoritative; a tool_end that never arrived is closed here.
      return { ...turn, scopes, tools: items.map((it) => ({ ...it, pending: false })) };
    }
    case 'gate':
      return { ...turn, gate: d as unknown as GatePayload };
    case 'usage':
      return { ...turn, usage: d as unknown as UsagePayload, model: str(d.model) ?? turn.model };
    case 'job_estimate':
      return { ...turn, jobEstimate: d as unknown as JobEstimate };
    case 'done':
      return { ...turn, done: true, assistantMessageId: str(d.message_id) ?? turn.assistantMessageId, tools: turn.tools.map((t) => ({ ...t, pending: false })) };
    case 'error':
      return {
        ...turn,
        done: true,
        error: { code: asAssistantErrorCode(d.code), message: str(d.message) ?? '' },
        tools: turn.tools.map((t) => ({ ...t, pending: false })),
      };
    default:
      return turn;
  }
}

/** Map a thrown value to the error sentence's code. */
export function errorCodeOf(err: unknown): AssistantErrorCode {
  if (err instanceof EdgeError) {
    // The JSON refusal's own code (LLM_MONTHLY_CAP …) beats the HTTP class.
    const detail = asAssistantErrorCode(err.detail);
    if (detail !== 'UNKNOWN') return detail;
    return asAssistantErrorCode(err.code);
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

  const ask = useCallback(async (text: string) => {
    const question = text.trim();
    if (question === '' || controller.current) return;
    const { conversationId, scopes, range, model, lang, onConversation } = optsRef.current;
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
            if (name === 'message_start' && isRecord(data) && typeof data.conversation_id === 'string' && data.conversation_id !== convId) {
              convId = data.conversation_id;
              onConversation(convId);
            }
            setLive((cur) => (cur ? applyEvent(cur, name, data) : cur));
          },
        },
      );
    } catch (err) {
      if (isAbort(err)) {
        setLive((cur) => (cur ? { ...cur, done: true, stopped: true, tools: cur.tools.map((t) => ({ ...t, pending: false })) } : cur));
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
    }
  }, [qc]);

  return { live, streaming, lastQuestion, ask, stop, dismissLive };
}

/**
 * The owner assistant's calls from the phone.
 *
 *  - Reads go straight through `supabase.from('assistant_*')` under RLS (owner
 *    only; the policies are the wall, migration 0108).
 *  - A scope change is the one RPC, `app.assistant_set_scopes`.
 *  - A question is `POST /functions/v1/assistant-chat`, answered as
 *    `text/event-stream`. React Native's own `fetch` buffers a whole response;
 *    `expo/fetch` streams the body, which is what lets the answer grow word by
 *    word. Same JWT header and refusal mapping as the operator's `streamEdge`;
 *    never cached, never retried (repeating a billed model call behind the
 *    owner's back is not a retry).
 *
 * No deadline: the Stop button is the deadline, and the function itself ends a
 * runaway turn at 50 s with an `error` event.
 */
import { fetch as streamingFetch } from 'expo/fetch';
import type { AssistantScope } from '@touch/core/assistant/tools';
import { supabase } from '../../lib/supabase';
import {
  AssistantStreamError,
  asModelsPayload,
  refusalCode,
  asUsageSummary,
  type ConversationRow,
  type ModelsPayload,
  type UsageSummary,
  type MessageRow,
} from './chat';
import { parseSseChunk, parseSseData } from './sse';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const assistantKeys = {
  all: ['assistant'] as const,
  conversations: ['assistant', 'conversations'] as const,
  conversation: (id: string) => ['assistant', 'conversation', id] as const,
  messages: (id: string) => ['assistant', 'messages', id] as const,
  models: ['assistant', 'models'] as const,
  usage: ['assistant', 'usage'] as const,
};

const CONVERSATION_COLUMNS = 'id, title, scopes, model, tokens, updated_at, created_at';

export async function fetchConversations(): Promise<ConversationRow[]> {
  const { data, error } = await supabase
    .from('assistant_conversations')
    .select(CONVERSATION_COLUMNS)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as ConversationRow[];
}

export async function fetchConversation(id: string): Promise<ConversationRow | null> {
  const { data, error } = await supabase
    .from('assistant_conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as ConversationRow | null;
}

export async function fetchMessages(conversationId: string): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from('assistant_messages')
    .select('id, conversation_id, seq, role, content, sources, gate, created_at')
    .eq('conversation_id', conversationId)
    .order('seq', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as MessageRow[];
}

/** `assistant_set_scopes` (0108): validates against the catalog and returns the row. */
export async function setScopes(
  conversationId: string,
  scopes: readonly AssistantScope[],
): Promise<void> {
  const { error } = await supabase
    .schema('app')
    .rpc('assistant_set_scopes', { p_id: conversationId, p_scopes: [...scopes] });
  if (error) throw error;
}

/** The venue default and every model with rates (0114). */
export async function fetchModels(): Promise<ModelsPayload> {
  const { data, error } = await supabase.schema('app').rpc('assistant_models');
  if (error) throw error;
  return asModelsPayload(data);
}

/** The month's spend so far and the cap (`assistant_usage`, owner only, read-only). */
export async function fetchUsage(): Promise<UsageSummary> {
  const { data, error } = await supabase.schema('app').rpc('assistant_usage', {});
  if (error) throw error;
  return asUsageSummary(data);
}

/** This chat's model; `null` follows the venue default. Refused with ASSISTANT_MODEL_NOT_PRICED when unpriced. */
export async function setModel(conversationId: string, model: string | null): Promise<void> {
  // The generated type says `string`; the function takes null as "follow the default" (0114).
  const { error } = await supabase
    .schema('app')
    .rpc('assistant_set_model', { p_id: conversationId, p_model: model as string });
  if (error) throw error;
}

export interface ChatRequest {
  conversation_id: string | null;
  text: string;
  lang: 'en' | 'ar';
  /** A new chat carries its checked set; an existing row already has its own. */
  scopes?: readonly AssistantScope[];
  /** A new chat carries its chosen model (null = venue default); an existing row has its own. */
  model?: string;
  /** The branch the owner is looking at (the staff venue picker); forwarded server to server. */
  venue_scope?: string;
}

export interface StreamOptions {
  /** Called once per SSE event, in order, with the JSON-parsed `data`. */
  onEvent: (name: string, data: unknown) => void;
  /** The Stop button: aborting rejects the fetch with an AbortError. */
  signal?: AbortSignal;
}

async function readJson(res: { text(): Promise<string> }): Promise<unknown> {
  const text = await res.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

/** One question. Events arrive through `onEvent`; resolves when the stream ends. */
export async function sendMessage(req: ChatRequest, opts: StreamOptions): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AssistantStreamError('AUTH_REQUIRED', 'no session');

  const res = await streamingFetch(`${supabaseUrl}/functions/v1/assistant-chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(req),
    signal: opts.signal,
  });

  if (!res.ok) {
    // Auth and quota refuse as plain JSON before the stream starts.
    throw new AssistantStreamError(refusalCode(res.status, await readJson(res)));
  }

  const emit = (events: readonly { event: string; data: string }[]) => {
    for (const ev of events) opts.onEvent(ev.event, parseSseData(ev.data));
  };

  if (!res.body) {
    const text = await res.text();
    emit(parseSseChunk(text.endsWith('\n\n') ? text : `${text}\n\n`).events);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseChunk(buffer);
    buffer = parsed.rest;
    emit(parsed.events);
  }
  // A last event the server did not end with a blank line.
  buffer += decoder.decode();
  if (buffer.trim() !== '') emit(parseSseChunk(`${buffer}\n\n`).events);
}

/**
 * The owner assistant's client contract, shared by the operator and the phone
 * (plan §5.2, contracts §Lane C event table): the stored rows and the payloads
 * the `assistant-chat` stream carries, the readers for a stored message, the
 * refusal codes, and the reducer that folds one question's events into a
 * `LiveTurn`. The apps keep the I/O (fetch, supabase, React state) and call in
 * here, so the two can no longer drift apart.
 *
 * The edge function is the source of truth for every name and shape below
 * (`AssistantEvent` in packages/db/supabase/functions/_shared/assistant/sse.ts,
 * the JSON refusals in assistant-chat/index.ts and assistant-job/index.ts);
 * the SQL migrations (0108–0114) for the rows. The edge function is also the
 * wall (`requireStaffRole(['owner'])`): nothing here decides who may ask.
 *
 * Pure: no imports, no DOM, no fetch, so vitest runs it under node.
 */

// ---------------------------------------------------------------------------
// Rows (0108) and payloads (assistant-chat SSE, estimate.ts)
// ---------------------------------------------------------------------------

export interface DateRange {
  from: string;
  to: string;
}

/** The four billed token kinds (the operator's `TokenKinds`, assistantPricing.ts). */
export interface AssistantTokenKinds {
  input: number;
  cache_write: number;
  cache_read: number;
  output: number;
}

export interface ConversationRow {
  id: string;
  owner_id: string;
  title: string | null;
  scopes: string[];
  range: DateRange | null;
  /** 0114: this chat's model, or null to follow the venue default. */
  model: string | null;
  /** The chat's running meter (assistant-chat sums every answer into it). */
  tokens: Partial<AssistantTokenKinds> & { cost_micros?: number; calls?: number; model?: string };
  created_at: string;
  updated_at: string | null;
  archived_at: string | null;
}

export interface SourceItem {
  call_id: string;
  name: string;
  args: Record<string, unknown>;
  row_count: number | null;
  ms: number | null;
  route: string | null;
  error?: string;
  stats?: Record<string, unknown>;
}

export interface GatePayload {
  status: 'ok' | 'unverified';
  unverified: { raw: string; value: number }[];
  checked: number;
  retried?: boolean;
  /** Every number the tools gave that turn — the re-check baseline (stored messages only). */
  numbers?: number[];
}

export interface UsagePayload extends AssistantTokenKinds {
  cost_micros: number;
  calls: number;
  model: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  seq: number;
  role: 'user' | 'assistant';
  /** Stored content blocks verbatim, or a bare string for a user turn. */
  content: unknown;
  sources: (SourceItem | { job_id: string })[] | { items?: SourceItem[]; scopes?: string[] } | null;
  gate: GatePayload | null;
  tokens: Partial<UsagePayload> | null;
  created_at: string;
}

export interface JobEstimateModes {
  aggregate: { calls: { tool: string; args: Record<string, unknown> }[]; tokens_est: number } | null;
  live: { allowed: boolean; reason?: string };
  batch: { allowed: true };
}

export type EstimateTokens = { input: number; cache_read: number; output: number; total: number };

/** One step of a job at one model (estimate.ts EstimateStep); `model: null` is the chat's own model. */
export interface JobEstimateStep {
  model: string | null;
  tokens: EstimateTokens;
  tokens_high: EstimateTokens;
}

export interface JobEstimate {
  job_id: string;
  rows: number;
  chunks: number;
  per_tool: { tool: string; rows: number; chunk_rows: number; tokens_per_row: number; measured: boolean }[];
  tokens: EstimateTokens;
  tokens_high: EstimateTokens;
  /**
   * The same tokens by step since 2026-10-08: the chunks are read by a cheaper
   * model (`extract.model`), the answer is written by the chat's (`reduce`).
   * Absent on older estimates; then `tokens` is priced at the chat's model.
   */
  by_step?: { extract: JobEstimateStep; reduce: JobEstimateStep };
  modes: JobEstimateModes;
  assumptions: string[];
  first_chunk_exact: number | null;
}

/** `assistant_models()` (0114): the venue default and every model the pricing table can bill, sorted. */
export interface ModelsPayload {
  default_model: string | null;
  models: string[];
}

export function asModelsPayload(raw: unknown): ModelsPayload {
  const r = (isRecord(raw) ? raw : {}) as Partial<Record<keyof ModelsPayload, unknown>>;
  return {
    default_model: typeof r.default_model === 'string' ? r.default_model : null,
    models: Array.isArray(r.models) ? r.models.filter((m): m is string => typeof m === 'string') : [],
  };
}

// ---------------------------------------------------------------------------
// Stored-row readers
// ---------------------------------------------------------------------------

/** The plain text of a stored message: a string, or its `text` blocks joined. */
export function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (b): b is { type: 'text'; text: string } =>
          typeof b === 'object' &&
          b !== null &&
          (b as { type?: unknown }).type === 'text' &&
          typeof (b as { text?: unknown }).text === 'string',
      )
      .map((b) => b.text)
      .join('\n\n')
      .trim();
  }
  if (content && typeof content === 'object' && typeof (content as { text?: unknown }).text === 'string') {
    return (content as { text: string }).text;
  }
  return '';
}

/** What a stored assistant message's `sources` say: the tool rows, the scopes it read, the jobs it grew into. */
export interface StoredSources {
  items: SourceItem[];
  scopes: string[];
  jobIds: string[];
}

/**
 * The tool rows of a stored assistant message, whichever of the two shapes it
 * was saved in: an array of rows (with `{job_id}` entries for a job), or the
 * `{items, scopes}` summary. Anything else reads as nothing.
 */
export function sourcesOf(sources: unknown): StoredSources {
  const out: StoredSources = { items: [], scopes: [], jobIds: [] };
  if (Array.isArray(sources)) {
    for (const item of sources) {
      if (!isRecord(item)) continue;
      if ('job_id' in item) {
        if (typeof item.job_id === 'string') out.jobIds.push(item.job_id);
      } else if (typeof item.name === 'string') {
        out.items.push(item as unknown as SourceItem);
      }
    }
    return out;
  }
  if (isRecord(sources)) {
    if (Array.isArray(sources.items)) out.items = sources.items.filter((i): i is SourceItem => isRecord(i));
    if (Array.isArray(sources.scopes)) out.scopes = sources.scopes.filter((s): s is string => typeof s === 'string');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Every code a question can end on: the stream's `error {code}`, or a JSON
 * refusal before it. NOT_FOUND (a chat or message that is gone or not the
 * owner's), INTERNAL (a database read the function could not make) and
 * INVALID_TRANSITION (a job accepted twice, assistant-job) are the server's
 * own codes; they used to collapse to UNKNOWN.
 */
export const ASSISTANT_ERROR_CODES = [
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'NOT_CONFIGURED',
  'LLM_DAILY_QUOTA',
  'LLM_MONTHLY_CAP',
  'RATE_LIMITED',
  'UPSTREAM',
  'TIMEOUT',
  'INVALID_REQUEST',
  'ASSISTANT_MODEL_NOT_PRICED',
  'NOT_FOUND',
  'INTERNAL',
  'INVALID_TRANSITION',
  'UNKNOWN',
] as const;
export type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[number];

export function asAssistantErrorCode(code: unknown): AssistantErrorCode {
  return typeof code === 'string' && (ASSISTANT_ERROR_CODES as readonly string[]).includes(code)
    ? (code as AssistantErrorCode)
    : 'UNKNOWN';
}

/** The `code` (or an upper-snake `error`) of an edge refusal's JSON body. */
export function bodyCode(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  if (typeof body.code === 'string') return body.code;
  if (typeof body.error === 'string' && /^[A-Z][A-Z0-9_]*$/.test(body.error)) return body.error;
  return undefined;
}

/**
 * A non-2xx answer before the stream starts (auth and quota refuse as plain
 * JSON): the body's own code wins (LLM_MONTHLY_CAP …), then the HTTP class.
 */
export function refusalCode(status: number, body: unknown): AssistantErrorCode {
  const own = asAssistantErrorCode(bodyCode(body));
  if (own !== 'UNKNOWN') return own;
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'UPSTREAM';
  return 'UNKNOWN';
}

/** The codes with a sentence of their own (`ws.owner.assistant.message.errors.*`, `staff.assistant.errors.*`). */
export type AssistantSentenceCode = Exclude<AssistantErrorCode, 'NOT_FOUND' | 'INTERNAL' | 'INVALID_TRANSITION'>;

/**
 * The sentence a code is shown with. The three codes the catalogs do not word
 * read the generic "could not answer, ask again": none of them is something
 * the owner can fix, and the code itself stays on the turn for whoever looks.
 */
export function assistantErrorSentence(code: AssistantErrorCode): AssistantSentenceCode {
  switch (code) {
    case 'NOT_FOUND':
    case 'INTERNAL':
    case 'INVALID_TRANSITION':
      return 'UNKNOWN';
    default:
      return code;
  }
}

// ---------------------------------------------------------------------------
// The live turn
// ---------------------------------------------------------------------------

export interface ToolRow extends SourceItem {
  pending: boolean;
}

/**
 * One question = one `LiveTurn`: the owner's bubble appears at once, the
 * assistant's text grows delta by delta, tool rows appear as
 * `tool_start`/`tool_end` arrive, then the gate marks, the usage footer and
 * any job estimate land, and `done` closes it.
 */
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
  /** A `propose_job` ended the turn with this estimate. */
  jobEstimate: JobEstimate | null;
  done: boolean;
  stopped: boolean;
  error: { code: AssistantErrorCode; message: string } | null;
}

export function emptyTurn(conversationId: string | null, userText: string): LiveTurn {
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

/** Every tool row closed: the turn ended, whatever was still running. */
export function settleTools(tools: readonly ToolRow[]): ToolRow[] {
  return tools.map((t) => ({ ...t, pending: false }));
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
      return { ...turn, done: true, assistantMessageId: str(d.message_id) ?? turn.assistantMessageId, tools: settleTools(turn.tools) };
    case 'error':
      return {
        ...turn,
        done: true,
        error: { code: asAssistantErrorCode(d.code), message: str(d.message) ?? '' },
        tools: settleTools(turn.tools),
      };
    default:
      return turn;
  }
}

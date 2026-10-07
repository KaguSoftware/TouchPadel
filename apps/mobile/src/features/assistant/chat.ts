/**
 * The owner's assistant on the phone, as pure logic (vitest): the event table
 * the edge function streams, the reducer that folds it into one live turn, the
 * stored-row readers, the scopes a phone offers and the sentence a refusal
 * lands on. The reducer is the operator's (`useAssistantChat.ts`
 * `applyEvent`), reduced to what the phone shows: no usage meter, no model
 * switch, no re-check or pin yet.
 *
 * The edge function is the wall (`requireStaffRole(['owner'])`); nothing here
 * decides who may ask.
 */
import { ASSISTANT_SCOPES, type AssistantScope } from '@touch/core/assistant/tools';

// ── Rows ────────────────────────────────────────────────────────────────────

export interface SourceItem {
  call_id: string;
  name: string;
  args: Record<string, unknown>;
  row_count: number | null;
  ms: number | null;
  route: string | null;
  error?: string;
}

export interface GatePayload {
  status: 'ok' | 'unverified';
  unverified: { raw: string; value: number }[];
  checked: number;
  retried?: boolean;
}

export interface ConversationRow {
  id: string;
  title: string | null;
  scopes: string[];
  /** This chat's model, or null to follow the venue default. */
  model: string | null;
  /** The chat's running meter (assistant-chat sums every answer into it); only `cost_micros` is read. */
  tokens?: { cost_micros?: unknown } | null;
  updated_at: string | null;
  created_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  seq: number;
  role: 'user' | 'assistant';
  /** Stored content blocks verbatim, or a bare string for a user turn. */
  content: unknown;
  sources: unknown;
  gate: GatePayload | null;
  created_at: string;
}

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

/** The tool rows of a stored assistant message, whichever of the two shapes it was saved in. */
export function sourcesOf(sources: unknown): { items: SourceItem[]; hasJob: boolean } {
  const out = { items: [] as SourceItem[], hasJob: false };
  if (Array.isArray(sources)) {
    for (const item of sources) {
      if (item && typeof item === 'object' && 'job_id' in item) out.hasJob = true;
      else if (item && typeof item === 'object' && typeof (item as SourceItem).name === 'string') {
        out.items.push(item as SourceItem);
      }
    }
    return out;
  }
  if (sources && typeof sources === 'object') {
    const items = (sources as { items?: unknown }).items;
    if (Array.isArray(items)) out.items = items.filter((i): i is SourceItem => !!i && typeof i === 'object');
  }
  return out;
}

// ── Errors ──────────────────────────────────────────────────────────────────

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
  if (body === null || typeof body !== 'object') return undefined;
  const b = body as { code?: unknown; error?: unknown };
  if (typeof b.code === 'string') return b.code;
  if (typeof b.error === 'string' && /^[A-Z][A-Z0-9_]*$/.test(b.error)) return b.error;
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

/** A refusal that arrives as a thrown value (the fetch itself, or ours). */
export class AssistantStreamError extends Error {
  readonly code: AssistantErrorCode;
  constructor(code: AssistantErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AssistantStreamError';
    this.code = code;
  }
}

// ── Models ──────────────────────────────────────────────────────────────────

/** `assistant_models()` (0114): the venue default and every model the pricing table can bill. */
export interface ModelsPayload {
  default_model: string | null;
  models: string[];
}

export function asModelsPayload(raw: unknown): ModelsPayload {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<ModelsPayload>;
  return {
    default_model: typeof r.default_model === 'string' ? r.default_model : null,
    models: Array.isArray(r.models) ? r.models.filter((m): m is string => typeof m === 'string') : [],
  };
}

/** Model ids with a spoken name; anything else prints as its id. */
const MODEL_NAMES: Readonly<Record<string, string>> = {
  'claude-opus-5-5': 'Opus 5.5',
  'claude-sonnet-5-5': 'Sonnet 5.5',
};

export function modelName(id: string): string {
  return MODEL_NAMES[id] ?? id;
}

/** The segmented control's value for "follow the venue default" (a model id never looks like this). */
export const DEFAULT_MODEL_VALUE = '__default__';

// ── Spend ───────────────────────────────────────────────────────────────────

/** What the settings sheet shows from `assistant_usage()` (0111, 0207): the month so far and the cap. */
export interface UsageSummary {
  monthMicros: number;
  capMicros: number | null;
}

const micros = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

export function asUsageSummary(raw: unknown): UsageSummary {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    month?: { cost_micros?: unknown };
    cap?: { monthly_cap_micros?: unknown };
  };
  return {
    monthMicros: micros(r.month?.cost_micros) ?? 0,
    capMicros: micros(r.cap?.monthly_cap_micros),
  };
}

/** This chat's spend so far; a chat with no row or no answer yet has spent nothing. */
export function chatCostMicros(row: Pick<ConversationRow, 'tokens'> | null | undefined): number {
  return micros(row?.tokens?.cost_micros) ?? 0;
}

/** USD micros as dollars with cents ("$1.24"); a cost under a cent but above zero says so. */
export function formatUsd(value: number): string {
  const dollars = value / 1_000_000;
  if (dollars > 0 && dollars < 0.005) return '<$0.01';
  return `$${dollars.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** True when a refusal says the model has no rates in the pricing table. */
export function isModelNotPriced(err: unknown): boolean {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown; message?: unknown }) : {};
  return (
    code.code === 'ASSISTANT_MODEL_NOT_PRICED' ||
    (typeof code.message === 'string' && code.message.includes('ASSISTANT_MODEL_NOT_PRICED'))
  );
}

// ── The live turn ───────────────────────────────────────────────────────────

export interface ToolRow extends SourceItem {
  pending: boolean;
}

export interface LiveTurn {
  conversationId: string | null;
  userText: string;
  assistantMessageId: string | null;
  text: string;
  tools: ToolRow[];
  gate: GatePayload | null;
  /** A `propose_job` ended the turn: the estimate card lives on the desktop. */
  jobProposed: boolean;
  done: boolean;
  stopped: boolean;
  error: { code: AssistantErrorCode; message: string } | null;
}

export function emptyTurn(conversationId: string | null, userText: string): LiveTurn {
  return {
    conversationId,
    userText,
    assistantMessageId: null,
    text: '',
    tools: [],
    gate: null,
    jobProposed: false,
    done: false,
    stopped: false,
    error: null,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Apply one SSE event to a turn (event table: build-contracts Lane C). */
export function applyEvent(turn: LiveTurn, name: string, data: unknown): LiveTurn {
  const d = isRecord(data) ? data : {};
  const settle = (tools: ToolRow[]) => tools.map((t) => ({ ...t, pending: false }));
  switch (name) {
    case 'message_start':
      return {
        ...turn,
        conversationId: str(d.conversation_id) ?? turn.conversationId,
        assistantMessageId: str(d.assistant_message_id),
      };
    case 'delta':
      // `reset: true` precedes a gate retry: the first answer is withdrawn and re-streamed.
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
        pending: false,
      };
      const idx = turn.tools.findIndex((t) => t.call_id === id);
      if (idx === -1) {
        const row: ToolRow = {
          call_id: id ?? `call-${turn.tools.length}`,
          name: str(d.name) ?? '?',
          args: {},
          ...patch,
        };
        return { ...turn, tools: [...turn.tools, row] };
      }
      const tools = turn.tools.slice();
      tools[idx] = { ...tools[idx]!, ...patch };
      return { ...turn, tools };
    }
    case 'sources': {
      const items = Array.isArray(d.items) ? (d.items as SourceItem[]) : null;
      // The summary is authoritative; a tool_end that never arrived is closed here.
      return items ? { ...turn, tools: items.map((it) => ({ ...it, pending: false })) } : turn;
    }
    case 'gate':
      return { ...turn, gate: d as unknown as GatePayload };
    case 'job_estimate':
      return { ...turn, jobProposed: true };
    case 'done':
      return {
        ...turn,
        done: true,
        assistantMessageId: str(d.message_id) ?? turn.assistantMessageId,
        tools: settle(turn.tools),
      };
    case 'error':
      return {
        ...turn,
        done: true,
        error: { code: asAssistantErrorCode(d.code), message: str(d.message) ?? '' },
        tools: settle(turn.tools),
      };
    default:
      return turn;
  }
}

// ── Scopes ──────────────────────────────────────────────────────────────────

/**
 * What a thumb is offered. `docs`, `audit`, `engagement` and `tables` stay on
 * the desktop; a chat that already carries one keeps it (toggling rebuilds the
 * set from the stored one, so a hidden scope is never dropped by a tap).
 */
export const PHONE_SCOPES: readonly AssistantScope[] = [
  'money',
  'courts',
  'cafe',
  'stock',
  'staff',
  'customers',
  'marketing',
  'settings',
  'system',
  'howto',
];

export function isScope(value: unknown): value is AssistantScope {
  return typeof value === 'string' && (ASSISTANT_SCOPES as readonly string[]).includes(value);
}

/** Catalog order, so two equal sets print the same way. */
export function normaliseScopes(scopes: Iterable<string>): AssistantScope[] {
  const set = new Set<string>(scopes);
  return ASSISTANT_SCOPES.filter((s) => set.has(s));
}

/** `scopes` with `scope` flipped. Never empties the set: a chat with nothing on can read nothing. */
export function toggleScope(scopes: readonly string[], scope: AssistantScope): AssistantScope[] {
  const on = scopes.includes(scope);
  const next = on ? scopes.filter((s) => s !== scope) : [...scopes, scope];
  return normaliseScopes(next.length === 0 ? ['howto'] : next);
}

/** The tool error the edge function writes: `Scope "cafe" is off for this chat`. */
const TOOL_ERROR = /Scope\s+"([a-z]+)"\s+is off/i;

/** Scopes the turn's tool errors say are off, that are not on yet. */
export function refusedScopes(
  toolErrors: readonly (string | undefined)[],
  current: readonly string[],
): AssistantScope[] {
  const found = new Set<AssistantScope>();
  for (const err of toolErrors) {
    const m = err ? TOOL_ERROR.exec(err) : null;
    if (m && isScope(m[1])) found.add(m[1]);
  }
  return normaliseScopes(found).filter((s) => !current.includes(s));
}

// ── Starting questions ──────────────────────────────────────────────────────

export interface Suggestion {
  id: 'yesterday' | 'stock' | 'courts' | 'staff';
  /** The scopes the question needs; asking it turns them on for the new chat. */
  scopes: readonly AssistantScope[];
}

/** Each starter names what it needs, so tapping one is one honest step, not a scope hunt. */
export const SUGGESTIONS: readonly Suggestion[] = [
  { id: 'yesterday', scopes: ['money', 'cafe', 'courts'] },
  { id: 'stock', scopes: ['stock'] },
  { id: 'courts', scopes: ['courts'] },
  { id: 'staff', scopes: ['staff'] },
];

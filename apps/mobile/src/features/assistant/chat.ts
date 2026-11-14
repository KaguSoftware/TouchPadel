/**
 * The owner's assistant on the phone, as pure logic (vitest): the stored-row
 * shapes this phone reads, the scopes a phone offers, the model names and the
 * spend it shows, and the error a refusal throws. The event table, the reducer
 * that folds it into one live turn, the row readers and the refusal codes are
 * @touch/core/assistant/client's, shared with the operator (re-exported here so
 * the screens keep one import); the phone shows less of the turn than the
 * desktop does (no usage meter or re-check yet), but it holds all of it.
 *
 * The edge function is the wall (`requireStaffRole(['owner'])`); nothing here
 * decides who may ask.
 */
import { ASSISTANT_SCOPES, type AssistantScope } from '@touch/core/assistant/tools';
import type {
  AssistantErrorCode,
  ConversationRow as StoredConversationRow,
  MessageRow as StoredMessageRow,
} from '@touch/core/assistant/client';

export { assistantErrorSentence, sourcesOf, textOfContent } from '@touch/core/assistant/client';
export type { AssistantErrorCode, GatePayload, SourceItem } from '@touch/core/assistant/client';

// ── Rows ────────────────────────────────────────────────────────────────────

/**
 * The columns `fetchConversations` reads (api.ts CONVERSATION_COLUMNS). The
 * running meter may be missing on a row the phone built itself; only
 * `cost_micros` is read.
 */
export type ConversationRow = Pick<StoredConversationRow, 'id' | 'title' | 'scopes' | 'model' | 'updated_at' | 'created_at'> & {
  tokens?: { cost_micros?: unknown } | null;
};

/**
 * The columns `fetchMessages` reads. `tokens` carries how an answer ended
 * (`stop_reason`, `error_code`; read through `turnOutcome`), so it is `unknown`
 * here and optional: a row the phone builds itself has none.
 */
export type MessageRow = Omit<StoredMessageRow, 'tokens'> & { tokens?: unknown };

// ── Errors ──────────────────────────────────────────────────────────────────

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

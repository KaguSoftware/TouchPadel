/**
 * Scopes at the edge (plan §5.5, contracts "assistant-chat" context packs):
 * the tool plan each checkbox runs for its context pack, the search kinds a
 * chat may see, and the refusal text for a tool outside the active scopes.
 *
 * Pure: imports only the catalog.
 */
import {
  ASSISTANT_SCOPES,
  DEFAULT_SCOPES,
  isToolAllowed,
  SCOPE_CHUNK_KINDS,
  toolByName,
  type AssistantScope,
} from './tools.ts';

export interface DateRange {
  from: string;
  to: string;
}

/** Business days the default tool range covers (today inclusive). */
export const DEFAULT_RANGE_DAYS = 7;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The date in `tz` for an instant, as YYYY-MM-DD. `Intl` handles the zone; the
 * business-day boundary itself lives in `app.business_date` and is not
 * re-implemented here — the packs use calendar days in venue time.
 */
export function localDate(now: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return ymd(now);
  }
}

/** The last DEFAULT_RANGE_DAYS days ending today (venue time). */
export function defaultRange(today: string): DateRange {
  const to = new Date(`${today}T00:00:00Z`);
  const from = new Date(to.getTime() - (DEFAULT_RANGE_DAYS - 1) * 86_400_000);
  return { from: ymd(from), to: ymd(to) };
}

/** True for a well-formed `{from, to}` with from ≤ to. */
export function isRange(v: unknown): v is DateRange {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.from === 'string' && typeof r.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.from) && /^\d{4}-\d{2}-\d{2}$/.test(r.to) && r.from <= r.to;
}

/** Validate a scopes array from the request; unknown names are dropped, empty → defaults. */
export function normaliseScopes(input: unknown): AssistantScope[] {
  if (!Array.isArray(input)) return [...DEFAULT_SCOPES];
  const known = new Set<string>(ASSISTANT_SCOPES);
  const out: AssistantScope[] = [];
  for (const s of input) if (typeof s === 'string' && known.has(s) && !out.includes(s as AssistantScope)) out.push(s as AssistantScope);
  return out.length ? out : [...DEFAULT_SCOPES];
}

export type ScopeCheck = { ok: true } | { ok: false; scope: AssistantScope | null; message: string };

/** The refusal text is fixed so the model learns the phrase and the UI can offer "Turn on <scope>". */
export function scopeOffMessage(scope: string): string {
  return `Scope "${scope}" is off for this chat`;
}

/** Wraps `isToolAllowed` with the message the tool_result carries when refused. */
export function checkScope(toolName: string, scopes: readonly AssistantScope[]): ScopeCheck {
  if (isToolAllowed(toolName, scopes)) return { ok: true };
  const spec = toolByName(toolName);
  if (!spec) return { ok: false, scope: null, message: `Unknown tool ${toolName}` };
  return { ok: false, scope: spec.scope, message: scopeOffMessage(spec.scope) };
}

/**
 * The chunk kinds `search` may return: the union over active scopes,
 * intersected with what the model asked for. Empty means "nothing is
 * searchable in this chat" and the function answers so without a query.
 */
export function searchKindsFor(scopes: readonly AssistantScope[], requested?: readonly string[] | null): string[] {
  const allowed = new Set<string>();
  for (const s of scopes) for (const k of SCOPE_CHUNK_KINDS[s] ?? []) allowed.add(k);
  if (requested && requested.length) return requested.filter((k) => allowed.has(k));
  return [...allowed].sort();
}

/** Scopes NOT on, for the "context is off" line of the first user turn. */
export function offScopes(scopes: readonly AssistantScope[]): AssistantScope[] {
  const on = new Set<string>(scopes);
  return ASSISTANT_SCOPES.filter((s) => !on.has(s));
}

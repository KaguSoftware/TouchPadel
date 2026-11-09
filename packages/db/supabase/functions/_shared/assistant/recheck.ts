/**
 * Re-check (plan §3.5, DECIDE 10): the owner presses a button on a saved
 * answer, the chat function re-runs that message's tool calls against live
 * data with the same arguments, and this module says which of the figures the
 * answer printed are no longer in the data. No model is involved: the diff is
 * pure arithmetic over three number sets.
 *
 *   then   every number the tools returned when the answer was written
 *          (persisted as `gate.numbers` on the assistant message);
 *   now    every number the same tool calls return today;
 *   shown  every number in the answer text (gate.ts `numbersIn`).
 *
 * Only figures that were BOTH shown and given by a tool then are compared —
 * a number the owner typed, a small count, or a figure the gate already
 * flagged as unverified is not a "then" figure and is left alone. A figure
 * holds when the same value is in `now`; otherwise it changed, and the
 * nearest value that is new today (in `now`, not in `then`) is offered as
 * what likely replaced it, when one sits close enough.
 *
 * The handler half (below `diffNumbers`, moved out of assistant-chat on
 * 2026-11-09): `rerunStored` runs a stored message's tool calls again, and
 * `recheckMessage` answers the re-check request. Everything that touches the
 * database is injected (RecheckIo; the chat passes its owner-bound client's
 * reads and runners.ts runStoredTool), as turn.ts takes its provider.
 *
 * Pure: imports only pure modules (clean, gate, handles, scopes, tools, turn,
 * http). No Deno, no npm, no supabase-js.
 */
import { json, isUuid, logError } from '../http.ts';
import { CleanError, cleanedNotice } from './clean.ts';
import { numbersIn } from './gate.ts';
import { newHandleTable, type HandleTable } from './handles.ts';
import { checkScope, normaliseScopes } from './scopes.ts';
import { toolByName, validateToolInput, type AssistantScope, type ToolSpec } from './tools.ts';
import { errorText, resolveArgs, type Dispatched, type SourceItem } from './turn.ts';

export interface NumberChange {
  /** The figure as the answer printed it. */
  value_then: number;
  /** The nearest new live value, when one is close enough to be its successor. */
  value_now?: number;
}

export interface NumberDiff {
  changed: NumberChange[];
  /** Figures that were in the data then and still are. */
  unchanged: number;
}

/** Two numbers are the same figure when they differ by less than this (the values are normalised the same way both times). */
export const SAME_EPS = 1e-6;
/** A replacement is offered only within this share of the old value (never less than one unit). */
export const NEAREST_MAX_RATIO = 0.5;

function dedupe(values: readonly number[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (!out.some((x) => Math.abs(x - v) <= SAME_EPS)) out.push(v);
  }
  return out.sort((a, b) => a - b);
}

function has(sorted: readonly number[], v: number): boolean {
  return sorted.some((x) => Math.abs(x - v) <= SAME_EPS);
}

/** The value in `pool` closest to `v`, when within NEAREST_MAX_RATIO of it (or within 1). */
export function nearestOf(pool: readonly number[], v: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const x of pool) {
    const d = Math.abs(x - v);
    if (d < bestDist) {
      best = x;
      bestDist = d;
    }
  }
  if (best === null) return null;
  const limit = Math.max(1, Math.abs(v) * NEAREST_MAX_RATIO);
  return bestDist <= limit + SAME_EPS ? best : null;
}

/**
 * Compare the figures an answer printed with what the same tools return now.
 * Returns each shown-and-given figure that is no longer in the live set, with
 * a likely replacement where one exists, and the count of those that hold.
 */
export function diffNumbers(then: readonly number[], now: readonly number[], shown: readonly number[]): NumberDiff {
  const thenSet = dedupe(then);
  const nowSet = dedupe(now);
  const candidates = dedupe(shown).filter((v) => has(thenSet, v));
  const fresh = nowSet.filter((v) => !has(thenSet, v));
  const changed: NumberChange[] = [];
  let unchanged = 0;
  for (const v of candidates) {
    if (has(nowSet, v)) {
      unchanged += 1;
      continue;
    }
    const near = nearestOf(fresh, v);
    changed.push(near === null ? { value_then: v } : { value_then: v, value_now: near });
  }
  return { changed, unchanged };
}

// ---------------------------------------------------------------------------
// The handler half: the stored tool calls again, no model
// ---------------------------------------------------------------------------
/** The re-check's own time box: tools only, no model, so shorter. */
export const RECHECK_WALL_MS = 30_000;

/** What a re-run needs of the chat's dispatch context (runners.ts DispatchCtx has it all). */
export interface RerunCtx {
  scopes: readonly AssistantScope[];
  handles: HandleTable;
  signal?: AbortSignal;
}

export interface RecheckTool {
  name: string;
  args: Record<string, unknown>;
  row_count: number | null;
  ms: number;
  error?: string;
}

/** The tool rows of a stored `sources` column, whichever of the two shapes it was saved in. */
export function storedSourceItems(sources: unknown): SourceItem[] {
  const list = Array.isArray(sources) ? sources : sources && typeof sources === 'object' && Array.isArray((sources as { items?: unknown }).items) ? (sources as { items: unknown[] }).items : [];
  return list.filter((x): x is SourceItem => !!x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string' && !('job_id' in (x as object)));
}

export function storedText(content: unknown): string {
  const blocks = Array.isArray(content) ? (content as { type?: string; text?: string }[]) : [];
  return blocks.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join('\n');
}

/** The re-check's own time box ran out: its message is ours, safe to show. */
export class RecheckDeadline extends Error {}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new RecheckDeadline(`not finished inside the ${RECHECK_WALL_MS / 1000} s time box`)), Math.max(0, ms));
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * The stored tool calls again as the owner, no model (the re-check and the
 * answer reuse share it): each call is validated, scope-checked, handle-
 * resolved and run through the same dispatch as a live turn, inside `wallMs`
 * counted from `started`. `live` is every figure the runs returned. `run` is
 * the chat's runner for a stored call (runners.ts runStoredTool: posthog,
 * file_read, else the RPC dispatcher).
 */
export async function rerunStored<C extends RerunCtx>(
  ctx: C,
  items: readonly { name: string; args: Record<string, unknown> }[],
  started: number,
  wallMs: number,
  run: (ctx: C, spec: ToolSpec, resolved: Record<string, unknown>) => Promise<Dispatched>,
): Promise<{ tools: RecheckTool[]; live: number[] }> {
  const tools: RecheckTool[] = [];
  const live: number[] = [];
  for (const item of items) {
    const spec = toolByName(item.name);
    if (!spec) continue;
    const args = item.args;
    const out: RecheckTool = { name: spec.name, args, row_count: null, ms: 0 };
    const remaining = wallMs - (Date.now() - started);
    if (remaining <= 0) {
      out.error = `not re-run: the ${wallMs / 1000} s time box is used up`;
      tools.push(out);
      continue;
    }
    const t0 = Date.now();
    try {
      const problems = validateToolInput(spec, args);
      const scope = checkScope(spec.name, ctx.scopes);
      let r: Dispatched;
      if (problems.length) r = { cleaned: cleanedNotice(problems.join('; ')), isError: true, row_count: null };
      else if (!scope.ok) r = { cleaned: cleanedNotice(scope.message), isError: true, row_count: null };
      else {
        const resolved = resolveArgs(spec, args, ctx.handles);
        if (typeof resolved === 'string') r = { cleaned: cleanedNotice(resolved), isError: true, row_count: null };
        else r = await withDeadline(run(ctx, spec, resolved), remaining);
      }
      out.row_count = r.row_count;
      if (r.isError) out.error = r.cleaned.text.slice(0, 300);
      else live.push(...r.cleaned.numbers);
    } catch (e) {
      // Ours (a clean refusal, the time box) is shown; anything else is logged.
      if (e instanceof CleanError || e instanceof RecheckDeadline) out.error = errorText(e).slice(0, 300);
      else {
        logError('assistant-chat', e, `recheck ${spec.name} failed`);
        out.error = 'the tool failed';
      }
    }
    out.ms = Date.now() - t0;
    tools.push(out);
  }
  return { tools, live };
}

/**
 * The re-check's reads and runner, injected by assistant-chat: both reads go
 * through the caller's JWT (RLS, 0108/0234, admits only an owner), the
 * context carries the time box's signal (RECHECK_WALL_MS) on every RPC.
 */
export interface RecheckIo<C extends RerunCtx> {
  /** assistant_messages `id, conversation_id, role, content, sources, gate` by id. */
  readMessage(id: string): PromiseLike<{ data: unknown; error: unknown }>;
  /** assistant_conversations `id, owner_id, scopes, handles` by id. */
  readConversation(id: string): PromiseLike<{ data: unknown; error: unknown }>;
  timezone(): Promise<string>;
  context(scopes: AssistantScope[], handles: HandleTable, tz: string): C;
  run(ctx: C, spec: ToolSpec, resolved: Record<string, unknown>): Promise<Dispatched>;
}

/**
 * POST { recheck: { message_id } }: the stored assistant message's data tools
 * again as the owner (knowledge and meta skipped, handles from a scratch copy
 * of the chat's table, nothing minted or persisted), then the printed figures
 * against the live set. 404 for a message that is not an assistant turn of the
 * caller's, 403 for another owner's; `baseline: false` for a message saved
 * before gate.numbers was stored.
 */
export async function recheckMessage<C extends RerunCtx>(io: RecheckIo<C>, ownerId: string, recheck: unknown): Promise<Response> {
  const started = Date.now();
  const messageId = recheck && typeof recheck === 'object' ? String((recheck as { message_id?: unknown }).message_id ?? '') : '';
  if (!isUuid(messageId)) return json({ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: 'recheck.message_id must be a uuid' }, 400);

  // Read as the owner (F1, item 7): RLS (0108/0234) admits only an owner, and
  // the owner_id comparison below still separates one owner from another.
  const { data: msg, error } = await io.readMessage(messageId);
  if (error) {
    logError('assistant-chat', error, 'recheck message read failed');
    return json({ error: 'INTERNAL', code: 'INTERNAL' }, 500);
  }
  const row = msg as { id: string; conversation_id: string; role: string; content: unknown; sources: unknown; gate: { numbers?: unknown } | null } | null;
  if (!row || row.role !== 'assistant') return json({ error: 'NOT_FOUND', code: 'NOT_FOUND', message: 'assistant message not found' }, 404);
  // The conversation and the timezone together: both are reads, and nothing
  // runs or is returned before the ownership check below.
  const [{ data: conv, error: convErr }, tz] = await Promise.all([
    io.readConversation(row.conversation_id),
    io.timezone(),
  ]);
  if (convErr) {
    logError('assistant-chat', convErr, 'recheck conversation read failed');
    return json({ error: 'INTERNAL', code: 'INTERNAL' }, 500);
  }
  const c = conv as { owner_id: string; scopes: unknown; handles: unknown } | null;
  if (!c) return json({ error: 'NOT_FOUND', code: 'NOT_FOUND', message: 'conversation not found' }, 404);
  if (c.owner_id !== ownerId) return json({ error: 'FORBIDDEN', code: 'FORBIDDEN', message: 'not your conversation' }, 403);

  const scopes = normaliseScopes(c.scopes);
  // A scratch handle table: the re-check must not mint handles or write the conversation.
  const handles = newHandleTable(c.handles);
  // The time box's signal rides on every RPC, so a re-run past it is cancelled, not only abandoned.
  const ctx = io.context(scopes, handles, tz);

  const items = storedSourceItems(row.sources)
    // Knowledge and meta tools carry no business figures; a call that failed then gave none either.
    .filter((item) => {
      const spec = toolByName(item.name);
      return !!spec && spec.kind !== 'knowledge' && spec.kind !== 'meta' && !item.error;
    })
    .map((item) => ({ name: item.name, args: item.args && typeof item.args === 'object' ? item.args : {} }));
  const { tools, live } = await rerunStored(ctx, items, started, RECHECK_WALL_MS, io.run);

  const baseline = Array.isArray(row.gate?.numbers);
  const then = baseline ? (row.gate!.numbers as unknown[]).filter((n): n is number => typeof n === 'number') : [];
  const diff = diffNumbers(then, live, numbersIn(storedText(row.content)));
  return json({ message_id: row.id, checked_at: new Date().toISOString(), tools, changed: diff.changed, unchanged: diff.unchanged, baseline });
}
